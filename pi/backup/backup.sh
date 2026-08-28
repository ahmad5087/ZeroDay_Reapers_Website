#!/usr/bin/env bash
# backup.sh — encrypted, versioned backups of Supabase (pg_dump) + Cloudflare R2 -> /srv/backups.
# Runs as zdrops from a systemd timer. restic gives native encryption + dedup. Alerts Discord on failure.
set -euo pipefail
source /srv/ops/backup.env   # RESTIC_REPOSITORY, RESTIC_PASSWORD, DATABASE_URL, RCLONE_REMOTE, R2_BUCKET, DISCORD_WEBHOOK

notify() { curl -fsS -X POST "$DISCORD_WEBHOOK" -H 'Content-Type: application/json' -d "{\"content\":\"$1\"}" >/dev/null 2>&1 || true; }
fail()   { notify "🔴 zdr-ops backup FAILED at line ${1:-?}"; exit 1; }
trap 'fail "$LINENO"' ERR

STAGE=/srv/ops/restic-stage
mkdir -p "$STAGE/r2"

# init the repo once (idempotent)
restic cat config >/dev/null 2>&1 || restic init

# 1) Supabase Postgres -> restic, streamed (never lands on disk unencrypted)
pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip | \
  restic backup --stdin --stdin-filename "supabase-db.sql.gz" --tag supabase

# Optional Umami PostgreSQL backup. The service remains a no-op until Umami is configured.
if [[ -r /srv/ops/umami.env ]]; then
  (
    # Parse without sourcing because PostgreSQL URLs may contain shell metacharacters such as '&'.
    UMAMI_DATABASE_URL="$(sed -n 's/^DIRECT_DATABASE_URL=//p' /srv/ops/umami.env | tail -n 1 | tr -d '\r')"
    if [[ -z "$UMAMI_DATABASE_URL" ]]; then
      UMAMI_DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' /srv/ops/umami.env | tail -n 1 | tr -d '\r')"
    fi
    : "${UMAMI_DATABASE_URL:?DATABASE_URL missing from /srv/ops/umami.env}"
    pg_dump "$UMAMI_DATABASE_URL" --no-owner --no-privileges | gzip | \
      restic backup --stdin --stdin-filename "umami-db.sql.gz" --tag umami-db
  )
fi

# 2) R2 objects -> local stage -> restic (dedup makes runs after the first cheap)
rclone sync "${RCLONE_REMOTE}:${R2_BUCKET}" "$STAGE/r2" --fast-list --transfers 4
restic backup "$STAGE/r2" --tag r2

# 3) retention + prune
restic forget --prune --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --tag supabase --tag r2 --tag umami-db

# 4) cheap integrity spot-check
restic check --read-data-subset=2% >/dev/null

notify "🟢 zdr-ops backup OK $(date -u +%FT%TZ) — $(restic snapshots --json | jq 'length') snapshots"
