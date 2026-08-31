#!/usr/bin/env bash
# Safe routed Discord sender with a protected retry spool.
set -Eeuo pipefail

NOTIFICATION_ENV="${NOTIFICATION_ENV:-/srv/ops/notifications.env}"
MONITORING_ENV="${MONITORING_ENV:-/srv/ops/monitoring.env}"
QUEUE_ROOT="${DISCORD_QUEUE_ROOT:-/var/lib/zdr-discord-queue}"
PENDING_DIR="$QUEUE_ROOT/pending"
BAD_DIR="$QUEUE_ROOT/bad"
MAX_PENDING="${DISCORD_MAX_PENDING:-500}"

[[ -r "$NOTIFICATION_ENV" ]] && source "$NOTIFICATION_ENV"
[[ -r "$MONITORING_ENV" ]] && source "$MONITORING_ENV"

route_webhook() {
  case "$1" in
    website) printf '%s' "${DISCORD_GATUS_WEBSITE_WEBHOOK:-}" ;;
    portal) printf '%s' "${DISCORD_GATUS_PORTAL_WEBHOOK:-}" ;;
    login) printf '%s' "${DISCORD_GATUS_LOGIN_WEBHOOK:-}" ;;
    app-health) printf '%s' "${DISCORD_GATUS_APP_HEALTH_WEBHOOK:-}" ;;
    supabase) printf '%s' "${DISCORD_GATUS_SUPABASE_WEBHOOK:-}" ;;
    r2) printf '%s' "${DISCORD_GATUS_R2_WEBHOOK:-}" ;;
    backup) printf '%s' "${DISCORD_BACKUP_WEBHOOK:-}" ;;
    config-backup) printf '%s' "${DISCORD_CONFIG_BACKUP_WEBHOOK:-}" ;;
    offsite-copy) printf '%s' "${DISCORD_OFFSITE_COPY_WEBHOOK:-}" ;;
    restore-drill) printf '%s' "${DISCORD_RESTORE_DRILL_WEBHOOK:-}" ;;
    guardian) printf '%s' "${DISCORD_GUARDIAN_WEBHOOK:-}" ;;
    capacity) printf '%s' "${DISCORD_CAPACITY_WEBHOOK:-}" ;;
    weekly-ops) printf '%s' "${DISCORD_WEEKLY_OPS_WEBHOOK:-}" ;;
    umami) printf '%s' "${DISCORD_WEEKLY_UMAMI_WEBHOOK:-}" ;;
    monthly) printf '%s' "${DISCORD_MONTHLY_WEBHOOK:-}" ;;
    pi-performance) printf '%s' "${DISCORD_PI_PERFORMANCE_WEBHOOK:-}" ;;
    disk-health) printf '%s' "${DISCORD_DISK_HEALTH_WEBHOOK:-}" ;;
    security-report) printf '%s' "${DISCORD_SECURITY_REPORT_WEBHOOK:-}" ;;
    slo-report) printf '%s' "${DISCORD_SLO_REPORT_WEBHOOK:-}" ;;
    domain-monitor) printf '%s' "${DISCORD_DOMAIN_MONITOR_WEBHOOK:-}" ;;
    alert-delivery) printf '%s' "${DISCORD_ALERT_DELIVERY_WEBHOOK:-}" ;;
    config-integrity) printf '%s' "${DISCORD_CONFIG_INTEGRITY_WEBHOOK:-}" ;;
    saas-config-backup) printf '%s' "${DISCORD_SAAS_CONFIG_BACKUP_WEBHOOK:-}" ;;
    synthetic-login) printf '%s' "${DISCORD_SYNTHETIC_LOGIN_WEBHOOK:-}" ;;
    tailscale) printf '%s' "${DISCORD_TAILSCALE_WEBHOOK:-}" ;;
    container-updates) printf '%s' "${DISCORD_CONTAINER_UPDATES_WEBHOOK:-}" ;;
    email-inbox) printf '%s' "${DISCORD_EMAIL_INBOX_WEBHOOK:-}" ;;
    *) return 2 ;;
  esac
}

validate_message() {
  local message="$1"
  [[ -n "$message" ]] || { echo 'Discord message is empty' >&2; return 2; }
  (( ${#message} <= 1800 )) || { echo 'Discord message exceeds 1800 characters' >&2; return 2; }
}

send_now() {
  local route="$1" message="$2" webhook payload
  validate_message "$message"
  webhook="$(route_webhook "$route")" || {
    echo "Unknown Discord route: $route" >&2
    return 2
  }
  [[ "$webhook" == https://discord.com/api/webhooks/* && "$webhook" != *CHANGE_ME* ]] || {
    echo "Discord route is not configured: $route" >&2
    return 2
  }
  payload="$(jq -n --arg content "$message" '{content:$content,allowed_mentions:{parse:[]}}')"
  curl -fsS --connect-timeout 5 --max-time 20 -X POST "$webhook" \
    -H 'Content-Type: application/json' -d "$payload" >/dev/null
}

queue_message() {
  local route="$1" message="$2" count tmp target
  install -d -o root -g root -m 0700 "$PENDING_DIR" "$BAD_DIR"
  count="$(find "$PENDING_DIR" -maxdepth 1 -type f -name '*.json' -printf . | wc -c)"
  (( count < MAX_PENDING )) || {
    echo "Discord queue limit reached (${MAX_PENDING}); refusing to discard alerts" >&2
    return 1
  }
  tmp="$(mktemp "$QUEUE_ROOT/.message.XXXXXX")"
  target="$PENDING_DIR/$(date -u +%s%N)-$$-${RANDOM}.json"
  jq -n --arg route "$route" --arg message "$message" --arg queued_at "$(date -u +%FT%TZ)" \
    '{route:$route,message:$message,queued_at:$queued_at}' >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$target"
  echo "Discord delivery queued for route $route" >&2
}

flush_queue() {
  local file route message queued_at sent=0 oldest=''
  install -d -o root -g root -m 0700 "$PENDING_DIR" "$BAD_DIR"
  while IFS= read -r -d '' file; do
    if ! route="$(jq -er '.route' "$file" 2>/dev/null)" \
      || ! message="$(jq -er '.message' "$file" 2>/dev/null)" \
      || ! queued_at="$(jq -er '.queued_at' "$file" 2>/dev/null)"; then
      mv "$file" "$BAD_DIR/$(basename "$file")"
      echo "Moved malformed Discord queue file to bad/: $(basename "$file")" >&2
      continue
    fi
    [[ -n "$oldest" ]] || oldest="$queued_at"
    if send_now "$route" "$message"; then
      rm -f -- "$file"
      sent=$((sent + 1))
    else
      echo "Discord queue flush stopped at route $route" >&2
      break
    fi
  done < <(find "$PENDING_DIR" -maxdepth 1 -type f -name '*.json' -print0 | sort -z)

  if (( sent > 0 )); then
    recovery="[RESOLVED] zdr-ops Discord delivery recovered $(date -u +%FT%TZ)"$'\n'
    recovery+="Flushed ${sent} queued message(s); oldest was ${oldest}."
    send_now alert-delivery "$recovery" || queue_message alert-delivery "$recovery"
  fi
}

case "${1:-}" in
  --flush)
    [[ $# -eq 1 ]] || { echo 'usage: discord-send.sh --flush' >&2; exit 2; }
    flush_queue
    ;;
  --queue-test)
    [[ $# -eq 3 ]] || { echo 'usage: discord-send.sh --queue-test ROUTE MESSAGE' >&2; exit 2; }
    route_webhook "$2" >/dev/null || { echo "Unknown Discord route: $2" >&2; exit 2; }
    validate_message "$3"
    queue_message "$2" "$3"
    ;;
  --test)
    [[ $# -eq 2 ]] || { echo 'usage: discord-send.sh --test ROUTE' >&2; exit 2; }
    send_now "$2" "[TEST] zdr-ops route ${2} $(date -u +%FT%TZ)"
    ;;
  *)
    [[ $# -eq 2 ]] || { echo 'usage: discord-send.sh ROUTE MESSAGE' >&2; exit 2; }
    if ! send_now "$1" "$2"; then
      queue_message "$1" "$2"
    fi
    ;;
esac
