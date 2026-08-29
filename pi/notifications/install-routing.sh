#!/usr/bin/env bash
# Installs a complete notifications.env from stdin and mirrors Gatus routes atomically.
# Run as root:  cat notifications.env | sudo bash install-routing.sh
set -Eeuo pipefail

[[ "$(id -u)" -eq 0 ]] || { echo "install-routing.sh must run as root" >&2; exit 1; }

NOTIFICATION_ENV="${NOTIFICATION_ENV:-/srv/ops/notifications.env}"
GATUS_ENV="${GATUS_ENV:-/srv/ops/gatus/gatus.env}"
notification_dir="$(dirname "$NOTIFICATION_ENV")"
gatus_dir="$(dirname "$GATUS_ENV")"
notification_tmp="$(mktemp "$notification_dir/.notifications.env.XXXXXX")"
gatus_tmp=""

cleanup() {
  rm -f "$notification_tmp"
  [[ -z "$gatus_tmp" ]] || rm -f "$gatus_tmp"
}
trap cleanup EXIT

cat >"$notification_tmp"
chmod 600 "$notification_tmp"

# The file is sourced only after every non-comment line matches the generated, quoted export format.
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" =~ ^export\ DISCORD_[A-Z0-9_]+_WEBHOOK=\'https://discord\.com/api/webhooks/[0-9]+/[A-Za-z0-9._-]+\'$ ]] || {
    echo "notifications input contains an invalid line" >&2
    exit 1
  }
done <"$notification_tmp"

# shellcheck disable=SC1090
source "$notification_tmp"
required_routes=(
  DISCORD_GATUS_WEBSITE_WEBHOOK
  DISCORD_GATUS_PORTAL_WEBHOOK
  DISCORD_GATUS_LOGIN_WEBHOOK
  DISCORD_GATUS_APP_HEALTH_WEBHOOK
  DISCORD_GATUS_SUPABASE_WEBHOOK
  DISCORD_GATUS_R2_WEBHOOK
  DISCORD_BACKUP_WEBHOOK
  DISCORD_CONFIG_BACKUP_WEBHOOK
  DISCORD_OFFSITE_COPY_WEBHOOK
  DISCORD_RESTORE_DRILL_WEBHOOK
  DISCORD_GUARDIAN_WEBHOOK
  DISCORD_CAPACITY_WEBHOOK
  DISCORD_WEEKLY_OPS_WEBHOOK
  DISCORD_WEEKLY_UMAMI_WEBHOOK
  DISCORD_MONTHLY_WEBHOOK
)
for key in "${required_routes[@]}"; do
  [[ -n "${!key:-}" && "${!key}" != CHANGE_ME ]] || {
    echo "missing or placeholder route: $key" >&2
    exit 1
  }
done

[[ -s "$GATUS_ENV" ]] || { echo "$GATUS_ENV is missing or empty" >&2; exit 1; }
gatus_tmp="$(mktemp "$gatus_dir/.gatus.env.XXXXXX")"
grep -Ev '^DISCORD_GATUS_(WEBSITE|PORTAL|LOGIN|APP_HEALTH|SUPABASE|R2)_WEBHOOK=' \
  "$GATUS_ENV" >"$gatus_tmp" || true
for key in "${required_routes[@]:0:6}"; do
  printf '%s=%s\n' "$key" "${!key}" >>"$gatus_tmp"
done

gatus_owner="$(stat -c '%u:%g' "$GATUS_ENV")"
gatus_mode="$(stat -c '%a' "$GATUS_ENV")"
chown "$gatus_owner" "$gatus_tmp"
chmod "$gatus_mode" "$gatus_tmp"
mv -f "$gatus_tmp" "$GATUS_ENV"
gatus_tmp=""

chown zdrops:zdrops "$notification_tmp"
mv -f "$notification_tmp" "$NOTIFICATION_ENV"
notification_tmp=""
echo "Discord routing installed: 15 Pi routes and 6 Gatus endpoint overrides"
