#!/usr/bin/env bash
# guardian.sh - lightweight host/portal watchdog for the zdr-ops Raspberry Pi.
# Runs from guardian.timer and sends Discord only when a new failure set appears.
set -uo pipefail

BACKUP_ENV="${GUARDIAN_BACKUP_ENV:-/srv/ops/backup.env}"
NOTIFICATION_ENV="${GUARDIAN_NOTIFICATION_ENV:-/srv/ops/notifications.env}"
STATE_DIR="${GUARDIAN_STATE_DIR:-/var/lib/zdr-guardian}"
STATE_FILE="$STATE_DIR/last-state"
PUBLIC_URL="${GUARDIAN_PUBLIC_URL:-https://status.zerodayreapers.me}"
ANALYTICS_URL="${GUARDIAN_ANALYTICS_URL:-https://analytics.zerodayreapers.me/api/heartbeat}"
DISK_LIMIT="${GUARDIAN_DISK_LIMIT_PERCENT:-80}"
MEMORY_MIN_MIB="${GUARDIAN_MEMORY_MIN_MIB:-200}"
BACKUP_MAX_HOURS="${GUARDIAN_BACKUP_MAX_HOURS:-30}"
SMART_DEVICE="${GUARDIAN_SMART_DEVICE:-/dev/sda}"
SMART_TYPE="${GUARDIAN_SMART_TYPE:-auto}"
SMART_REQUIRED="${GUARDIAN_SMART_REQUIRED:-true}"

[[ ! -r "$NOTIFICATION_ENV" ]] || source "$NOTIFICATION_ENV"

FAILURES=()
fail() { FAILURES+=("$1"); }

unit_exists() {
  systemctl cat "$1" >/dev/null 2>&1
}

check_active() {
  local unit="$1"
  systemctl is-active --quiet "$unit" || fail "$unit is not active"
}

check_disk() {
  local path="$1" usage
  if ! mountpoint -q "$path"; then
    fail "$path is not mounted"
    return
  fi
  usage="$(df -P "$path" 2>/dev/null | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"
  if [[ ! "$usage" =~ ^[0-9]+$ ]]; then
    fail "cannot read disk usage for $path"
  elif (( usage >= DISK_LIMIT )); then
    fail "$path usage is ${usage}% (limit ${DISK_LIMIT}%)"
  fi
}

# Core services and timers.
for unit in docker.service nftables.service gatus.service cloudflared.service backup.timer restore-drill.timer; do
  check_active "$unit"
done

# Optional services are checked only after their unit has been installed.
for unit in gatus-public.service umami.service config-backup.timer offsite-copy.timer \
  ops-weekly-report.timer ops-monthly-report.timer ops-capacity-alert.timer \
  discord-queue-flush.timer pi-performance-daily.timer pi-performance-weekly.timer \
  disk-health-daily.timer disk-health-short.timer disk-health-long.timer \
  security-report.timer gatus-slo-report.timer domain-monitor.timer \
  config-integrity.timer login-readiness.timer container-update-check.timer; do
  unit_exists "$unit" && check_active "$unit"
done

# Report instances are oneshots and therefore normally inactive; only a recorded failure is unhealthy.
for unit in ops-report@weekly.service ops-report@monthly.service ops-report@capacity.service; do
  if unit_exists "$unit"; then
    report_result="$(systemctl show "$unit" -p Result --value 2>/dev/null)"
    [[ -z "$report_result" || "$report_result" == success ]] || fail "$unit last run failed ($report_result)"
  fi
done

check_disk /srv/backups
check_disk /srv/ops

# Available memory matters more than the raw "free" column because Linux reclaims cache on demand.
available_kib="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null)"
if [[ "$available_kib" =~ ^[0-9]+$ ]]; then
  available_mib=$(( available_kib / 1024 ))
  (( available_mib >= MEMORY_MIN_MIB )) || fail "available memory is ${available_mib} MiB (minimum ${MEMORY_MIN_MIB} MiB)"
else
  fail "cannot read MemAvailable"
fi

# Raspberry Pi current throttle flags are the low nibble. Historical flags do not page repeatedly.
if command -v vcgencmd >/dev/null 2>&1; then
  throttle_raw="$(vcgencmd get_throttled 2>/dev/null | awk -F= '{print $2}')"
  if [[ "$throttle_raw" =~ ^0x[0-9a-fA-F]+$ ]]; then
    throttle_value=$(( throttle_raw ))
    (( (throttle_value & 0xF) == 0 )) || fail "Pi is currently undervolted, frequency-capped, or throttled ($throttle_raw)"
  else
    fail "cannot read Pi throttle status"
  fi
else
  fail "vcgencmd is unavailable"
fi

# SMART health for the backup HDD. Set GUARDIAN_SMART_REQUIRED=false for an enclosure that cannot pass SMART.
if command -v smartctl >/dev/null 2>&1 && [[ -b "$SMART_DEVICE" ]]; then
  smart_output="$(smartctl -H -d "$SMART_TYPE" "$SMART_DEVICE" 2>&1 || true)"
  if ! grep -Eqi 'PASSED|OK' <<<"$smart_output"; then
    fail "SMART health did not report PASSED/OK for $SMART_DEVICE (type $SMART_TYPE)"
  fi
elif [[ "$SMART_REQUIRED" == "true" ]]; then
  fail "SMART check unavailable for $SMART_DEVICE (install smartmontools or adjust guardian.env)"
fi

# Gatus itself must be reachable and every latest private result must be successful.
gatus_json="$(curl -fsS -m 15 http://127.0.0.1:8080/api/v1/endpoints/statuses 2>/dev/null || true)"
if [[ -z "$gatus_json" ]]; then
  fail "private Gatus API is unreachable"
elif ! jq -e 'length > 0 and all(.[]; (.results[-1].success // false) == true)' <<<"$gatus_json" >/dev/null 2>&1; then
  fail "one or more private Gatus checks are failing"
fi

public_code="$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL" 2>/dev/null || true)"
[[ "$public_code" == "200" ]] || fail "public status URL returned HTTP ${public_code:-unreachable}"

analytics_json="$(curl -fsS -m 20 "$ANALYTICS_URL" 2>/dev/null || true)"
if [[ -z "$analytics_json" ]]; then
  fail "public analytics heartbeat is unreachable"
elif ! jq -e '.ok == true' <<<"$analytics_json" >/dev/null 2>&1; then
  fail "public analytics heartbeat returned an unhealthy response"
fi

# Once the sanitized instance is installed, ensure Cloudflare is not still routing to private Gatus.
if unit_exists gatus-public.service; then
  public_json="$(curl -fsS -m 20 "${PUBLIC_URL%/}/api/v1/endpoints/statuses" 2>/dev/null || true)"
  if [[ -z "$public_json" ]]; then
    fail "public Gatus API is unreachable"
  elif grep -Eqi 'supabase\.co|r2\.cloudflarestorage\.com' <<<"$public_json" || \
       jq -e 'any(.[]; ((.key // .name // "") | ascii_downcase | test("supabase|r2")))' \
         <<<"$public_json" >/dev/null 2>&1; then
    fail "public Gatus route exposes a private backend check"
  fi
fi

# Prove each required encrypted backup stream is recent. Checking tags separately prevents a fresh config
# snapshot from masking a stale database or R2 backup. An exclusive restic check legitimately blocks this
# read, so skip only while a known backup/report unit is active. Secrets never appear on a command line.
if [[ -r "$BACKUP_ENV" ]]; then
  restic_busy_unit=''
  for unit in backup.service offsite-copy.service restore-drill.service ops-report@monthly.service; do
    if systemctl is-active --quiet "$unit"; then
      restic_busy_unit="$unit"
      break
    fi
  done
  if [[ -n "$restic_busy_unit" ]]; then
    echo "guardian: skipping restic freshness check while $restic_busy_unit is active"
  else
    snapshots="$(runuser -u zdrops -- bash -c 'source "$1" && timeout 30s restic snapshots --json' _ "$BACKUP_ENV" 2>/dev/null || true)"
    if ! jq -e 'type == "array"' <<<"$snapshots" >/dev/null 2>&1; then
      fail "restic snapshots are unreadable"
    else
      backup_tags=(supabase r2)
      unit_exists config-backup.timer && backup_tags+=(pi-config)
      unit_exists umami.service && backup_tags+=(umami-db)
      for backup_tag in "${backup_tags[@]}"; do
        latest_time="$(jq -r --arg tag "$backup_tag" \
          '[.[] | select((.tags // []) | index($tag))] | if length > 0 then max_by(.time).time else empty end' \
          <<<"$snapshots" 2>/dev/null)"
        if [[ -z "$latest_time" ]]; then
          fail "restic has no $backup_tag snapshot"
          continue
        fi
        latest_epoch="$(date -d "$latest_time" +%s 2>/dev/null || echo 0)"
        if (( latest_epoch == 0 )); then
          fail "cannot parse latest $backup_tag snapshot time"
          continue
        fi
        backup_age_hours=$(( ( $(date +%s) - latest_epoch ) / 3600 ))
        if (( backup_age_hours > BACKUP_MAX_HOURS )); then
          fail "latest $backup_tag snapshot is ${backup_age_hours}h old (maximum ${BACKUP_MAX_HOURS}h)"
        fi
      done
    fi
  fi
else
  fail "$BACKUP_ENV is not readable"
fi

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
previous_state="$(cat "$STATE_FILE" 2>/dev/null || true)"

guardian_webhook() {
  local webhook="${DISCORD_GUARDIAN_WEBHOOK:-}"
  if [[ -z "$webhook" ]]; then
    webhook="$(runuser -u zdrops -- bash -c 'source "$1" && printf "%s" "${DISCORD_WEBHOOK:-}"' _ "$BACKUP_ENV" 2>/dev/null || true)"
  fi
  printf '%s' "$webhook"
}

send_guardian_message() {
  local message="$1" webhook payload
  webhook="$(guardian_webhook)"
  [[ -n "$webhook" ]] || {
    echo "guardian has no readable DISCORD_GUARDIAN_WEBHOOK or legacy DISCORD_WEBHOOK" >&2
    return 1
  }
  payload="$(jq -n --arg content "$message" '{content: $content, allowed_mentions: {parse: []}}')"
  curl -fsS -m 15 -X POST "$webhook" -H 'Content-Type: application/json' -d "$payload" >/dev/null
}

if (( ${#FAILURES[@]} == 0 )); then
  if [[ "$previous_state" == fail:* ]]; then
    recovery_message="[RESOLVED] zdr-ops guardian recovered $(date -u +%FT%TZ)"$'\n'
    recovery_message+="All Guardian checks are healthy."
    if ! send_guardian_message "$recovery_message"; then
      echo "guardian could not send recovery notification; retaining failed state for retry" >&2
      exit 1
    fi
  fi
  printf 'ok\n' >"$STATE_FILE"
  echo "guardian OK"
  exit 0
fi

failure_text="$(printf '%s\n' "${FAILURES[@]}")"
failure_hash="$(printf '%s' "$failure_text" | sha256sum | awk '{print $1}')"
new_state="fail:$failure_hash"

if [[ "$previous_state" != "$new_state" ]]; then
  message="[FAIL] zdr-ops guardian $(date -u +%FT%TZ)"
  while IFS= read -r item; do
    message+=$'\n- '
    message+="$item"
  done <<<"$failure_text"
  if send_guardian_message "$message"; then
    printf '%s\n' "$new_state" >"$STATE_FILE"
  else
    echo "guardian could not send Discord alert" >&2
  fi
fi

printf 'guardian FAIL:\n%s\n' "$failure_text" >&2
exit 1
