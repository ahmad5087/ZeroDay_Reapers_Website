#!/usr/bin/env bash
# config-backup.sh - encrypt the Pi's recovery-critical configuration into the local restic repository.
set -euo pipefail
source /srv/ops/backup.env

notify() {
  local message="$1" payload
  payload="$(jq -n --arg content "$message" '{content: $content}')"
  curl -fsS -m 15 -X POST "$DISCORD_WEBHOOK" -H 'Content-Type: application/json' -d "$payload" >/dev/null 2>&1 || true
}
fail() { notify "[FAIL] zdr-ops config backup failed at line ${1:-?}"; exit 1; }
trap 'fail "$LINENO"' ERR

paths=()
for path in \
  /etc/systemd/system \
  /etc/nftables.conf \
  /etc/ssh/sshd_config \
  /etc/ssh/sshd_config.d \
  /etc/docker/daemon.json \
  /srv/ops; do
  [[ -e "$path" ]] && paths+=("$path")
done

(( ${#paths[@]} > 0 )) || { echo "no configuration paths found" >&2; exit 1; }

# Root reads protected system files and secrets, but the restic process runs as zdrops. This prevents
# root-owned pack/lock files from breaking the normal backup job. The tar stream never lands on disk.
tar --create --absolute-names --numeric-owner \
  --exclude=/srv/ops/restic-stage \
  --exclude=/srv/ops/restic-cache \
  --exclude=/srv/ops/gatus/gatus.db \
  --exclude=/srv/ops/gatus-public/gatus.db \
  "${paths[@]}" | \
  runuser -u zdrops -- bash -c \
    'source /srv/ops/backup.env && restic backup --stdin --stdin-filename pi-config.tar --tag pi-config'

# Forget old config snapshots now; the next main backup performs the repository prune.
runuser -u zdrops -- bash -c \
  'source /srv/ops/backup.env && restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --tag pi-config'

notify "[OK] zdr-ops encrypted config backup completed $(date -u +%FT%TZ)"
