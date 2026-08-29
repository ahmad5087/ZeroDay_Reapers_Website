#!/usr/bin/env bash
# restore-drill.sh — periodic PROOF that the latest backup is actually restorable (Phase 15 reliability).
# Restores the latest SUPABASE snapshot to a throwaway dir and verifies the dump is a valid, well-formed
# SQL gzip. It deliberately does NOT spin up a Postgres to import into — the 1 GB Pi can't spare the RAM
# alongside Docker/gatus/restic, and a streaming gzip+SQL-marker check gives the same "is it restorable?"
# confidence with a tiny footprint. Runs as zdrops from a systemd timer (every 3 days). Alerts Discord.
set -euo pipefail
source /srv/ops/backup.env   # RESTIC_REPOSITORY, RESTIC_PASSWORD, DISCORD_WEBHOOK (+ RESTIC_CACHE_DIR)
NOTIFICATION_ENV="${NOTIFICATION_ENV:-/srv/ops/notifications.env}"
[[ ! -r "$NOTIFICATION_ENV" ]] || source "$NOTIFICATION_ENV"
RESTORE_DRILL_WEBHOOK="${DISCORD_RESTORE_DRILL_WEBHOOK:-${DISCORD_WEBHOOK:-}}"
: "${RESTORE_DRILL_WEBHOOK:?set DISCORD_RESTORE_DRILL_WEBHOOK in $NOTIFICATION_ENV}"

notify() {
  local message="$1" payload
  payload="$(jq -n --arg content "$message" '{content: $content, allowed_mentions: {parse: []}}')"
  curl -fsS -m 15 -X POST "$RESTORE_DRILL_WEBHOOK" -H 'Content-Type: application/json' -d "$payload" >/dev/null 2>&1 || true
}
cleanup() { rm -rf "${TARGET:-}" 2>/dev/null || true; }
fail()  { cleanup; notify "[FAIL] zdr-ops restore drill failed at line ${1:-?}"; exit 1; }
trap 'fail "$LINENO"' ERR

notify "[START] zdr-ops restore drill started $(date -u +%FT%TZ)"

TARGET="$(mktemp -d /srv/ops/restic-stage/restore-drill.XXXXXX)"

# 1) Restore ONLY the latest supabase-tagged snapshot (plain 'latest' could grab the newer r2 snapshot).
restic restore latest --tag supabase --target "$TARGET"

DUMP="$TARGET/supabase-db.sql.gz"
[ -s "$DUMP" ] || fail "$LINENO"      # restored file missing or empty

# 2) Valid gzip? (streaming — negligible memory)
gzip -t "$DUMP"

# 3) Does the decompressed head look like a real pg_dump? (stream the first ~400 KB only)
if ! zcat "$DUMP" | head -c 400000 | grep -qiE 'PostgreSQL database dump|CREATE TABLE|COPY public\.'; then
  fail "$LINENO"                       # gzip valid but not a recognizable SQL dump
fi

SIZE="$(du -h "$DUMP" | cut -f1)"
cleanup
notify "[OK] zdr-ops restore drill completed $(date -u +%FT%TZ) - latest Supabase backup restored and verified (${SIZE} gzip)"
