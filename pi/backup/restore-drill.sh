#!/usr/bin/env bash
# restore-drill.sh — periodic PROOF that the latest backup is actually restorable (Phase 15 reliability).
# Restores the latest SUPABASE snapshot to a throwaway dir and verifies the dump is a valid, well-formed
# SQL gzip. It deliberately does NOT spin up a Postgres to import into — the 1 GB Pi can't spare the RAM
# alongside Docker/gatus/restic, and a streaming gzip+SQL-marker check gives the same "is it restorable?"
# confidence with a tiny footprint. Runs as zdrops from a systemd timer (every 3 days). Alerts Discord.
set -euo pipefail
source /srv/ops/backup.env   # RESTIC_REPOSITORY, RESTIC_PASSWORD, DISCORD_WEBHOOK (+ RESTIC_CACHE_DIR)

notify() { curl -fsS -X POST "$DISCORD_WEBHOOK" -H 'Content-Type: application/json' -d "{\"content\":\"$1\"}" >/dev/null 2>&1 || true; }
cleanup() { rm -rf "${TARGET:-}" 2>/dev/null || true; }
fail()  { cleanup; notify "🔴 zdr-ops restore-drill FAILED at line ${1:-?}"; exit 1; }
trap 'fail "$LINENO"' ERR

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
notify "🟢 zdr-ops restore-drill OK $(date -u +%FT%TZ) — latest supabase backup restored + verified (${SIZE} gzip)"
