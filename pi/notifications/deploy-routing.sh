#!/usr/bin/env bash
# Installs the per-service routing scripts/config after install-routing.sh has provisioned secrets.
set -Eeuo pipefail

[[ "$(id -u)" -eq 0 ]] || { echo "deploy-routing.sh must run as root" >&2; exit 1; }

STAGING_ROOT="${STAGING_ROOT:-/home/zdradmin/pi}"

for unit in backup.service config-backup.service offsite-copy.service restore-drill.service; do
  if systemctl is-active --quiet "$unit"; then
    echo "refusing deployment while $unit is active" >&2
    exit 1
  fi
done

backup_once() {
  local target="$1" rollback="${1}.pre-discord-routing"
  [[ ! -e "$target" || -e "$rollback" ]] || cp -a "$target" "$rollback"
}

install_script() {
  local source="$1" target="$2" owner="$3" group="$4" mode="$5" tmp
  [[ -s "$source" ]] || { echo "missing staged file: $source" >&2; return 1; }
  tmp="$(mktemp "$(dirname "$target")/.$(basename "$target").XXXXXX")"
  tr -d '\r' <"$source" >"$tmp"
  bash -n "$tmp"
  chown "$owner:$group" "$tmp"
  chmod "$mode" "$tmp"
  mv -f "$tmp" "$target"
}

for target in /srv/ops/backup.sh /srv/ops/config-backup.sh /srv/ops/offsite-copy.sh \
  /srv/ops/restore-drill.sh /srv/ops/guardian.sh /srv/ops/ops-report.sh \
  /srv/ops/gatus/gatus.yaml; do
  backup_once "$target"
done

install_script "$STAGING_ROOT/backup/backup.sh" /srv/ops/backup.sh zdrops zdrops 750
install_script "$STAGING_ROOT/backup/config-backup.sh" /srv/ops/config-backup.sh root root 750
install_script "$STAGING_ROOT/backup/offsite-copy.sh" /srv/ops/offsite-copy.sh zdrops zdrops 750
install_script "$STAGING_ROOT/backup/restore-drill.sh" /srv/ops/restore-drill.sh zdrops zdrops 750
install_script "$STAGING_ROOT/guardian/guardian.sh" /srv/ops/guardian.sh root root 750
install_script "$STAGING_ROOT/reports/ops-report.sh" /srv/ops/ops-report.sh root root 750

gatus_owner="$(stat -c %U /srv/ops/gatus/gatus.yaml)"
gatus_group="$(stat -c %G /srv/ops/gatus/gatus.yaml)"
gatus_mode="$(stat -c %a /srv/ops/gatus/gatus.yaml)"
install_script "$STAGING_ROOT/monitor/gatus.yaml" /srv/ops/gatus/gatus.yaml \
  "$gatus_owner" "$gatus_group" "$gatus_mode"

systemctl restart gatus.service
gatus_ready=false
for _ in {1..15}; do
  statuses="$(curl -fsS -m 3 http://127.0.0.1:8080/api/v1/endpoints/statuses 2>/dev/null || true)"
  if systemctl is-active --quiet gatus.service \
    && jq -e 'length == 6 and all(.[]; (.results[-1].success // false) == true)' \
      <<<"$statuses" >/dev/null 2>&1; then
    gatus_ready=true
    break
  fi
  sleep 1
done

if [[ "$gatus_ready" != true ]]; then
  echo "new Gatus routing failed health validation; restoring previous configuration" >&2
  cp -a /srv/ops/gatus/gatus.yaml.pre-discord-routing /srv/ops/gatus/gatus.yaml
  systemctl restart gatus.service
  exit 1
fi

systemctl start guardian.service
echo "Per-service routing deployed; Gatus and Guardian are healthy"
