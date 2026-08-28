#!/usr/bin/env bash
# offsite-copy.sh - copy local encrypted restic snapshots to an independent remote repository.
set -euo pipefail
source /srv/ops/backup.env
source /srv/ops/offsite.env

: "${RESTIC_OFFSITE_REPOSITORY:?set RESTIC_OFFSITE_REPOSITORY in /srv/ops/offsite.env}"
: "${RESTIC_OFFSITE_PASSWORD:?set RESTIC_OFFSITE_PASSWORD in /srv/ops/offsite.env}"

notify() {
  local message="$1" payload
  payload="$(jq -n --arg content "$message" '{content: $content}')"
  curl -fsS -m 15 -X POST "$DISCORD_WEBHOOK" -H 'Content-Type: application/json' -d "$payload" >/dev/null 2>&1 || true
}
fail() { notify "[FAIL] zdr-ops off-site restic copy failed at line ${1:-?}"; exit 1; }
trap 'fail "$LINENO"' ERR

LOCAL_REPOSITORY="$RESTIC_REPOSITORY"
LOCAL_PASSWORD="$RESTIC_PASSWORD"

# restic copy treats the normal repository as the destination and RESTIC_FROM_* as the source.
export RESTIC_FROM_REPOSITORY="$LOCAL_REPOSITORY"
export RESTIC_FROM_PASSWORD="$LOCAL_PASSWORD"
export RESTIC_REPOSITORY="$RESTIC_OFFSITE_REPOSITORY"
export RESTIC_PASSWORD="$RESTIC_OFFSITE_PASSWORD"

# Initialization is deliberately manual so a typo cannot create a repository in the wrong location.
restic cat config >/dev/null
restic copy --from-repo "$RESTIC_FROM_REPOSITORY"
restic forget --keep-daily 14 --keep-weekly 8 --keep-monthly 12

# Prune only on the first weekly run of each month; remote prune can be I/O and bandwidth intensive.
if (( 10#$(date +%d) <= 7 )); then
  restic prune
fi

restic check
notify "[OK] zdr-ops off-site restic copy completed $(date -u +%FT%TZ)"
