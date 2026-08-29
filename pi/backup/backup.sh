#!/usr/bin/env bash
# backup.sh — encrypted, versioned backups of Supabase (pg_dump) + Cloudflare R2 -> /srv/backups.
# Runs as zdrops from a systemd timer. restic gives native encryption + dedup. Alerts Discord on failure.
set -euo pipefail
source /srv/ops/backup.env   # RESTIC_REPOSITORY, RESTIC_PASSWORD, DATABASE_URL, RCLONE_REMOTE, R2_BUCKET, DISCORD_WEBHOOK

notify() {
  local message="$1" payload
  payload="$(jq -n --arg content "$message" '{content: $content, allowed_mentions: {parse: []}}')"
  curl -fsS -m 15 -X POST "$DISCORD_WEBHOOK" -H 'Content-Type: application/json' -d "$payload" >/dev/null 2>&1 || true
}
fail()   { notify "[FAIL] zdr-ops daily backup failed at line ${1:-?}"; exit 1; }
trap 'fail "$LINENO"' ERR

notify "[START] zdr-ops daily backup started $(date -u +%FT%TZ)"

STAGE=/srv/ops/restic-stage
mkdir -p "$STAGE/r2"

# init the repo once (idempotent)
restic cat config >/dev/null 2>&1 || restic init

# 1) Supabase Postgres -> restic, streamed (never lands on disk unencrypted).
# --stdin-from-command prevents restic from committing a snapshot if pg_dump or gzip fails.
export DATABASE_URL
restic backup --stdin-from-command --stdin-filename "supabase-db.sql.gz" --tag supabase -- \
  bash -o pipefail -c 'pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip'

# Optional Umami PostgreSQL backup. The service remains a no-op until Umami is configured.
if [[ -r /srv/ops/umami.env ]]; then
  (
    # Parse without sourcing because PostgreSQL URLs may contain shell metacharacters such as '&'.
    UMAMI_DATABASE_URL="$(sed -n 's/^DIRECT_DATABASE_URL=//p' /srv/ops/umami.env | tail -n 1 | tr -d '\r')"
    if [[ -z "$UMAMI_DATABASE_URL" ]]; then
      UMAMI_DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' /srv/ops/umami.env | tail -n 1 | tr -d '\r')"
    fi
    : "${UMAMI_DATABASE_URL:?DATABASE_URL missing from /srv/ops/umami.env}"
    UMAMI_PG_DUMP_BIN="${UMAMI_PG_DUMP_BIN:-/usr/lib/postgresql/18/bin/pg_dump}"
    [[ -x "$UMAMI_PG_DUMP_BIN" ]] || {
      echo "PostgreSQL 18 pg_dump is required at $UMAMI_PG_DUMP_BIN" >&2
      exit 1
    }
    # Use Debian's CA bundle and skip the optional ~/.postgresql client-certificate probe; systemd
    # intentionally hides /home from this service. Server verification and channel binding remain active.
    export UMAMI_DATABASE_URL UMAMI_PG_DUMP_BIN
    restic backup --stdin-from-command --stdin-filename "umami-db.sql.gz" --tag umami-db -- \
      bash -o pipefail -c \
        'PGSSLROOTCERT=system PGSSLCERTMODE=disable "$UMAMI_PG_DUMP_BIN" "$UMAMI_DATABASE_URL" --no-owner --no-privileges | gzip'
  )
fi

# 2) R2 objects -> local stage -> restic (dedup makes runs after the first cheap)
rclone sync "${RCLONE_REMOTE}:${R2_BUCKET}" "$STAGE/r2" --fast-list --transfers 4
restic backup "$STAGE/r2" --tag r2

# 3) retention + prune
restic forget --prune --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --tag supabase --tag r2 --tag umami-db

# 4) cheap integrity spot-check
restic check --read-data-subset=2% >/dev/null

notify "[OK] zdr-ops daily backup completed $(date -u +%FT%TZ) - $(restic snapshots --json | jq 'length') snapshots"
