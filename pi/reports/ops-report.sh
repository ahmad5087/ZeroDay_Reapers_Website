#!/usr/bin/env bash
# ops-report.sh - scheduled Discord operations, analytics, integrity, and capacity reports.
set -Eeuo pipefail

MODE="${1:-}"
BACKUP_ENV="${REPORT_BACKUP_ENV:-/srv/ops/backup.env}"
OFFSITE_ENV="${REPORT_OFFSITE_ENV:-/srv/ops/offsite.env}"
REPORT_ENV="${REPORT_CONFIG_ENV:-/srv/ops/reports.env}"
NOTIFICATION_ENV="${REPORT_NOTIFICATION_ENV:-/srv/ops/notifications.env}"
UMAMI_ENV="${REPORT_UMAMI_ENV:-/srv/ops/umami.env}"
STATE_DIR="${REPORT_STATE_DIR:-/var/lib/zdr-reports}"

case "$MODE" in
  weekly|monthly|capacity) ;;
  *) echo "usage: $0 {weekly|monthly|capacity}" >&2; exit 2 ;;
esac

source "$BACKUP_ENV"
source "$OFFSITE_ENV"
source "$REPORT_ENV"
LEGACY_DISCORD_WEBHOOK="${DISCORD_WEBHOOK:-}"
[[ ! -r "$NOTIFICATION_ENV" ]] || source "$NOTIFICATION_ENV"

DISCORD_CAPACITY_WEBHOOK="${DISCORD_CAPACITY_WEBHOOK:-$LEGACY_DISCORD_WEBHOOK}"
DISCORD_WEEKLY_OPS_WEBHOOK="${DISCORD_WEEKLY_OPS_WEBHOOK:-$LEGACY_DISCORD_WEBHOOK}"
DISCORD_WEEKLY_UMAMI_WEBHOOK="${DISCORD_WEEKLY_UMAMI_WEBHOOK:-$LEGACY_DISCORD_WEBHOOK}"
DISCORD_MONTHLY_WEBHOOK="${DISCORD_MONTHLY_WEBHOOK:-$LEGACY_DISCORD_WEBHOOK}"

case "$MODE" in
  weekly) CURRENT_REPORT_WEBHOOK="$DISCORD_WEEKLY_OPS_WEBHOOK" ;;
  monthly) CURRENT_REPORT_WEBHOOK="$DISCORD_MONTHLY_WEBHOOK" ;;
  capacity) CURRENT_REPORT_WEBHOOK="$DISCORD_CAPACITY_WEBHOOK" ;;
esac

: "${CURRENT_REPORT_WEBHOOK:?No routed or legacy Discord webhook is configured for $MODE reports}"
: "${RESTIC_OFFSITE_REPOSITORY:?RESTIC_OFFSITE_REPOSITORY is missing from $OFFSITE_ENV}"
: "${RESTIC_OFFSITE_PASSWORD:?RESTIC_OFFSITE_PASSWORD is missing from $OFFSITE_ENV}"
: "${B2_LIMIT_BYTES:=10000000000}"
: "${NEON_LIMIT_BYTES:=500000000}"
: "${SUPABASE_DATABASE_LIMIT_BYTES:=500000000}"
: "${SUPABASE_STORAGE_LIMIT_BYTES:=1000000000}"
: "${SUPABASE_MAU_LIMIT:=50000}"
: "${CLOUDFLARE_R2_LIMIT_BYTES:=10000000000}"
: "${REPORT_CAPACITY_WARN_PERCENT:=80}"
: "${REPORT_CAPACITY_CRITICAL_PERCENT:=90}"
: "${UMAMI_WEBSITE_ID:=}"
: "${UMAMI_REPORT_TIMEZONE:=Asia/Karachi}"

for quota_var in B2_LIMIT_BYTES NEON_LIMIT_BYTES SUPABASE_DATABASE_LIMIT_BYTES \
  SUPABASE_STORAGE_LIMIT_BYTES SUPABASE_MAU_LIMIT CLOUDFLARE_R2_LIMIT_BYTES; do
  [[ "${!quota_var}" =~ ^[1-9][0-9]*$ ]] || {
    echo "$quota_var must be a positive integer" >&2
    exit 2
  }
done
[[ "$REPORT_CAPACITY_WARN_PERCENT" =~ ^[0-9]+$ \
  && "$REPORT_CAPACITY_CRITICAL_PERCENT" =~ ^[0-9]+$ ]] || {
  echo "capacity thresholds must be integers" >&2
  exit 2
}
(( REPORT_CAPACITY_WARN_PERCENT > 0 \
  && REPORT_CAPACITY_WARN_PERCENT < REPORT_CAPACITY_CRITICAL_PERCENT \
  && REPORT_CAPACITY_CRITICAL_PERCENT <= 100 )) || {
  echo "capacity thresholds must satisfy 0 < warning < critical <= 100" >&2
  exit 2
}

send_discord_to() {
  local webhook="$1" message="$2" payload
  [[ -n "$webhook" ]] || {
    echo "Discord webhook is missing for the requested report route" >&2
    return 1
  }
  (( ${#message} <= 2000 )) || {
    echo "Discord report exceeds the 2000-character content limit" >&2
    return 1
  }
  payload="$(jq -n --arg content "$message" '{content: $content, allowed_mentions: {parse: []}}')"
  curl -fsS -m 20 -X POST "$webhook" \
    -H 'Content-Type: application/json' -d "$payload" >/dev/null
}

send_discord() {
  send_discord_to "$CURRENT_REPORT_WEBHOOK" "$1"
}

on_error() {
  local line="$1" status="$2"
  trap - ERR
  send_discord "[FAIL] zdr-ops ${MODE} report failed at line ${line} $(date -u +%FT%TZ)" || true
  exit "$status"
}
trap 'on_error "$LINENO" "$?"' ERR

human_bytes() {
  numfmt --to=iec-i --suffix=B "${1:-0}" 2>/dev/null || printf '%s B' "${1:-0}"
}

percent_of() {
  local used="$1" limit="$2"
  (( limit > 0 )) || { printf '0'; return; }
  printf '%d' "$(( used * 100 / limit ))"
}

remaining_of() {
  local used="$1" limit="$2"
  if (( used >= limit )); then
    printf '0'
  else
    printf '%d' "$(( limit - used ))"
  fi
}

capacity_bytes_line() {
  local label="$1" used="$2" limit="$3" percent="$4"
  printf '%s: %s / %s (%s%%); %s remaining' \
    "$label" "$(human_bytes "$used")" "$(human_bytes "$limit")" "$percent" \
    "$(human_bytes "$(remaining_of "$used" "$limit")")"
}

capacity_count_line() {
  local label="$1" used="$2" limit="$3" percent="$4"
  printf '%s: %s / %s (%s%%); %s remaining' \
    "$label" "$used" "$limit" "$percent" "$(remaining_of "$used" "$limit")"
}

format_age() {
  local hours="$1"
  if (( hours < 48 )); then
    printf '%sh' "$hours"
  else
    printf '%sd %sh' "$(( hours / 24 ))" "$(( hours % 24 ))"
  fi
}

latest_age_for_tag() {
  local snapshots="$1" tag="$2" latest epoch now
  latest="$(jq -r --arg tag "$tag" \
    '[.[] | select((.tags // []) | index($tag))] | if length then max_by(.time).time else empty end' \
    <<<"$snapshots")"
  [[ -n "$latest" ]] || { printf 'missing'; return; }
  epoch="$(date -d "$latest" +%s)"
  now="$(date +%s)"
  format_age "$(( (now - epoch) / 3600 ))"
}

local_snapshots() {
  runuser -u zdrops -- bash -c \
    'set -euo pipefail; source "$1"; timeout 5m restic snapshots --json' _ "$BACKUP_ENV"
}

offsite_snapshots() {
  runuser -u zdrops -- bash -c '
    set -euo pipefail
    source "$1"
    source "$2"
    export RESTIC_REPOSITORY="$RESTIC_OFFSITE_REPOSITORY"
    export RESTIC_PASSWORD="$RESTIC_OFFSITE_PASSWORD"
    timeout 10m restic snapshots --json
  ' _ "$BACKUP_ENV" "$OFFSITE_ENV"
}

local_repository_bytes() {
  local json
  json="$(runuser -u zdrops -- bash -c \
    'set -euo pipefail; source "$1"; timeout 10m restic stats --mode raw-data --json' _ "$BACKUP_ENV")"
  # restic 0.19.0 briefly emitted a progress line before the documented JSON object.
  jq -er '.total_size' <<<"$(tail -n 1 <<<"$json")"
}

offsite_target() {
  [[ "$RESTIC_OFFSITE_REPOSITORY" == rclone:* ]] || {
    echo "off-site repository must use the rclone backend for capacity reporting" >&2
    return 1
  }
  printf '%s' "${RESTIC_OFFSITE_REPOSITORY#rclone:}"
}

offsite_repository_bytes() {
  local target json
  target="$(offsite_target)"
  json="$(runuser -u zdrops -- bash -c '
    set -euo pipefail
    source "$1"
    timeout 15m rclone size "$2" --json
  ' _ "$BACKUP_ENV" "$target")"
  jq -er '.bytes' <<<"$json"
}

umami_database_url() {
  local database_url
  database_url="$(sed -n 's/^DIRECT_DATABASE_URL=//p' "$UMAMI_ENV" | tail -n 1 | tr -d '\r')"
  [[ -n "$database_url" ]] || {
    database_url="$(sed -n 's/^DATABASE_URL=//p' "$UMAMI_ENV" | tail -n 1 | tr -d '\r')"
  }
  [[ -n "$database_url" ]] || { echo "Umami database URL is missing" >&2; return 1; }
  printf '%s' "$database_url"
}

neon_database_bytes() {
  local database_url psql_bin
  database_url="$(umami_database_url)"
  psql_bin=/usr/lib/postgresql/18/bin/psql
  [[ -x "$psql_bin" ]] || psql_bin="$(command -v psql)"
  runuser -u zdrops -- env \
    PGSSLROOTCERT=system PGSSLCERTMODE=disable \
    "$psql_bin" "$database_url" -X -qAtc 'select pg_database_size(current_database())' | tr -d '[:space:]'
}

supabase_capacity_metrics() {
  local query psql_bin
  query="select pg_database_size(current_database()), coalesce((select sum(nullif(metadata->>'size', '')::bigint) from storage.objects), 0), (select count(*) from auth.users where last_sign_in_at >= date_trunc('month', current_timestamp))"
  psql_bin=/usr/lib/postgresql/18/bin/psql
  [[ -x "$psql_bin" ]] || psql_bin="$(command -v psql)"
  runuser -u zdrops -- bash -c '
    set -euo pipefail
    source "$1"
    timeout 2m "$2" "$DATABASE_URL" -X -qAt -F "|" -c "$3"
  ' _ "$BACKUP_ENV" "$psql_bin" "$query" | tr -d '[:space:]'
}

r2_bucket_bytes() {
  local json
  json="$(runuser -u zdrops -- bash -c '
    set -euo pipefail
    source "$1"
    timeout 15m rclone size "${RCLONE_REMOTE}:${R2_BUCKET}" --json
  ' _ "$BACKUP_ENV")"
  jq -er '.bytes' <<<"$json"
}

collect_capacity() {
  local supabase_metrics
  B2_BYTES="$(offsite_repository_bytes)"
  NEON_BYTES="$(neon_database_bytes)"
  R2_BYTES="$(r2_bucket_bytes)"
  supabase_metrics="$(supabase_capacity_metrics)"
  IFS='|' read -r SUPABASE_DATABASE_BYTES SUPABASE_STORAGE_BYTES SUPABASE_MAU <<<"$supabase_metrics"
  [[ "$B2_BYTES" =~ ^[0-9]+$ && "$NEON_BYTES" =~ ^[0-9]+$ \
    && "$R2_BYTES" =~ ^[0-9]+$ && "$SUPABASE_DATABASE_BYTES" =~ ^[0-9]+$ \
    && "$SUPABASE_STORAGE_BYTES" =~ ^[0-9]+$ && "$SUPABASE_MAU" =~ ^[0-9]+$ ]]
  B2_PERCENT="$(percent_of "$B2_BYTES" "$B2_LIMIT_BYTES")"
  NEON_PERCENT="$(percent_of "$NEON_BYTES" "$NEON_LIMIT_BYTES")"
  R2_PERCENT="$(percent_of "$R2_BYTES" "$CLOUDFLARE_R2_LIMIT_BYTES")"
  SUPABASE_DATABASE_PERCENT="$(percent_of "$SUPABASE_DATABASE_BYTES" "$SUPABASE_DATABASE_LIMIT_BYTES")"
  SUPABASE_STORAGE_PERCENT="$(percent_of "$SUPABASE_STORAGE_BYTES" "$SUPABASE_STORAGE_LIMIT_BYTES")"
  SUPABASE_MAU_PERCENT="$(percent_of "$SUPABASE_MAU" "$SUPABASE_MAU_LIMIT")"
}

capacity_summary() {
  capacity_bytes_line 'Backblaze B2' "$B2_BYTES" "$B2_LIMIT_BYTES" "$B2_PERCENT"
  printf '\n'
  capacity_bytes_line 'Neon Umami DB' "$NEON_BYTES" "$NEON_LIMIT_BYTES" "$NEON_PERCENT"
  printf '\n'
  capacity_bytes_line 'Cloudflare R2' "$R2_BYTES" "$CLOUDFLARE_R2_LIMIT_BYTES" "$R2_PERCENT"
  printf '\n'
  capacity_bytes_line 'Supabase database' "$SUPABASE_DATABASE_BYTES" "$SUPABASE_DATABASE_LIMIT_BYTES" "$SUPABASE_DATABASE_PERCENT"
  printf '\n'
  capacity_bytes_line 'Supabase file storage' "$SUPABASE_STORAGE_BYTES" "$SUPABASE_STORAGE_LIMIT_BYTES" "$SUPABASE_STORAGE_PERCENT"
  printf '\n'
  capacity_count_line 'Supabase MAU estimate' "$SUPABASE_MAU" "$SUPABASE_MAU_LIMIT" "$SUPABASE_MAU_PERCENT"
}

capacity_level() {
  local value="$1"
  if (( value >= REPORT_CAPACITY_CRITICAL_PERCENT )); then
    printf 'critical'
  elif (( value >= REPORT_CAPACITY_WARN_PERCENT )); then
    printf 'warning'
  else
    printf 'ok'
  fi
}

run_capacity_alert() {
  local b2_level neon_level r2_level supabase_database_level supabase_storage_level supabase_mau_level
  local new_state previous_state state_file message
  collect_capacity
  b2_level="$(capacity_level "$B2_PERCENT")"
  neon_level="$(capacity_level "$NEON_PERCENT")"
  r2_level="$(capacity_level "$R2_PERCENT")"
  supabase_database_level="$(capacity_level "$SUPABASE_DATABASE_PERCENT")"
  supabase_storage_level="$(capacity_level "$SUPABASE_STORAGE_PERCENT")"
  supabase_mau_level="$(capacity_level "$SUPABASE_MAU_PERCENT")"
  new_state="b2:${b2_level};neon:${neon_level};r2:${r2_level};supabase-db:${supabase_database_level};supabase-storage:${supabase_storage_level};supabase-mau:${supabase_mau_level}"
  state_file="$STATE_DIR/capacity-state"
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  previous_state="$(cat "$state_file" 2>/dev/null || true)"

  if [[ "$new_state" != "$previous_state" ]]; then
    if [[ "$b2_level" == ok && "$neon_level" == ok && "$r2_level" == ok \
      && "$supabase_database_level" == ok && "$supabase_storage_level" == ok \
      && "$supabase_mau_level" == ok ]]; then
      if [[ -n "$previous_state" ]]; then
        message="[OK] zdr-ops free-tier capacity recovered"$'\n'"$(capacity_summary)"
        send_discord "$message"
      fi
    else
      message="[WARN] zdr-ops free-tier capacity threshold reached"$'\n'"$(capacity_summary)"
      send_discord "$message"
    fi
    printf '%s\n' "$new_state" >"${state_file}.tmp"
    mv "${state_file}.tmp" "$state_file"
  fi
  echo "capacity check complete: B2 ${B2_PERCENT}%, Neon ${NEON_PERCENT}%, R2 ${R2_PERCENT}%, Supabase DB ${SUPABASE_DATABASE_PERCENT}%, Supabase storage ${SUPABASE_STORAGE_PERCENT}%, Supabase MAU ${SUPABASE_MAU_PERCENT}%"
}

run_weekly_ops() {
  local local_json offsite_json local_count offsite_count local_bytes offsite_bytes
  local services_ok=0 timers_ok=0 service_failures=() timer_failures=()
  local backup_disk backup_free ops_disk ops_free mem_total mem_available swap_used message unit
  local_json="$(local_snapshots)"
  offsite_json="$(offsite_snapshots)"
  local_count="$(jq 'length' <<<"$local_json")"
  offsite_count="$(jq 'length' <<<"$offsite_json")"
  local_bytes="$(local_repository_bytes)"
  collect_capacity
  offsite_bytes="$B2_BYTES"

  for unit in docker nftables ssh fail2ban unattended-upgrades gatus cloudflared gatus-public umami; do
    if systemctl is-active --quiet "$unit"; then
      services_ok=$((services_ok + 1))
    else
      service_failures+=("$unit")
    fi
  done
  for unit in backup.timer config-backup.timer restore-drill.timer guardian.timer offsite-copy.timer ops-weekly-report.timer ops-monthly-report.timer ops-capacity-alert.timer; do
    if systemctl is-active --quiet "$unit"; then
      timers_ok=$((timers_ok + 1))
    else
      timer_failures+=("$unit")
    fi
  done

  backup_disk="$(df -P /srv/backups | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"
  backup_free="$(df -PB1 /srv/backups | awk 'NR==2 {print $4}')"
  ops_disk="$(df -P /srv/ops | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"
  ops_free="$(df -PB1 /srv/ops | awk 'NR==2 {print $4}')"
  mem_total="$(awk '/^MemTotal:/ {print $2 * 1024}' /proc/meminfo)"
  mem_available="$(awk '/^MemAvailable:/ {print $2 * 1024}' /proc/meminfo)"
  swap_used="$(free -b | awk '/^Swap:/ {print $3}')"

  CURRENT_REPORT_WEBHOOK="$DISCORD_WEEKLY_OPS_WEBHOOK"
  message="[WEEKLY] ZDR Ops Sunday digest - $(date -u +%F)"$'\n'
  message+="Services: ${services_ok}/9 active; timers: ${timers_ok}/8 active"
  (( ${#service_failures[@]} == 0 )) || message+=$'\n'"Service issues: ${service_failures[*]}"
  (( ${#timer_failures[@]} == 0 )) || message+=$'\n'"Timer issues: ${timer_failures[*]}"
  message+=$'\n'"Snapshots: local ${local_count}; off-site ${offsite_count}"
  message+=$'\n'"Latest local: Supabase $(latest_age_for_tag "$local_json" supabase), R2 $(latest_age_for_tag "$local_json" r2), Pi config $(latest_age_for_tag "$local_json" pi-config), Umami $(latest_age_for_tag "$local_json" umami-db)"
  message+=$'\n'"Latest off-site: Supabase $(latest_age_for_tag "$offsite_json" supabase), R2 $(latest_age_for_tag "$offsite_json" r2), Pi config $(latest_age_for_tag "$offsite_json" pi-config), Umami $(latest_age_for_tag "$offsite_json" umami-db)"
  message+=$'\n'"Repository data: local $(human_bytes "$local_bytes"); B2 $(human_bytes "$offsite_bytes")"
  message+=$'\n'"Disk: backups ${backup_disk}% used ($(human_bytes "$backup_free") free); ops ${ops_disk}% used ($(human_bytes "$ops_free") free)"
  message+=$'\n'"RAM: $(human_bytes "$mem_available") available / $(human_bytes "$mem_total"); swap used $(human_bytes "$swap_used")"
  send_discord "$message"

  CURRENT_REPORT_WEBHOOK="$DISCORD_CAPACITY_WEBHOOK"
  message="[WEEKLY] ZDR free-tier capacity - $(date -u +%F)"$'\n'"$(capacity_summary)"
  message+=$'\n'"Supabase MAU is a calendar-month estimate from last sign-ins; provider billing remains authoritative."
  message+=$'\n'"Dashboard-only on this Pi: B2 egress/Class-D calls; Neon compute/data transfer; R2 Class A/B operations; Supabase egress/cached egress/functions/realtime; Vercel transfer/compute/functions/analytics; Resend; Sentry; GitHub Actions; Web3Forms."
  message+=$'\n'"No project quota meter: Cloudflare Tunnel/DNS/Turnstile; Discord OAuth/webhooks; self-hosted Umami; Google AdSense; anonymous ipwho.is/ipapi.co geo fallbacks."
  send_discord "$message"
}

run_weekly_umami() {
  local database_url psql_bin website_id end_epoch start_epoch stats top period_start period_end top_text message
  CURRENT_REPORT_WEBHOOK="$DISCORD_WEEKLY_UMAMI_WEBHOOK"
  database_url="$(umami_database_url)"
  psql_bin=/usr/lib/postgresql/18/bin/psql
  [[ -x "$psql_bin" ]] || psql_bin="$(command -v psql)"
  website_id="$UMAMI_WEBSITE_ID"
  if [[ -z "$website_id" ]]; then
    website_id="$(runuser -u zdrops -- env \
      PGSSLROOTCERT=system PGSSLCERTMODE=disable \
      "$psql_bin" "$database_url" -X -qAtc \
      "select case when count(*) = 1 then min(website_id::text) else '' end from website where deleted_at is null")"
    [[ -n "$website_id" ]] || {
      echo "set UMAMI_WEBSITE_ID in $REPORT_ENV when Umami has zero or multiple active websites" >&2
      return 1
    }
  fi
  [[ "$website_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || {
    echo "UMAMI_WEBSITE_ID must be a UUID" >&2
    return 1
  }
  end_epoch="$(date +%s)"
  start_epoch="$(( end_epoch - 7 * 24 * 60 * 60 ))"
  stats="$(runuser -u zdrops -- env \
    PGSSLROOTCERT=system PGSSLCERTMODE=disable \
    "$psql_bin" "$database_url" -X -qAt -c \
    "select json_build_object('pageviews', count(*), 'visitors', count(distinct session_id), 'visits', count(distinct visit_id)) from website_event where website_id = '${website_id}'::uuid and event_type = 1 and created_at >= to_timestamp(${start_epoch}) and created_at < to_timestamp(${end_epoch})")"
  top="$(runuser -u zdrops -- env \
    PGSSLROOTCERT=system PGSSLCERTMODE=disable \
    "$psql_bin" "$database_url" -X -qAt -c \
    "select coalesce(json_agg(row_to_json(metric)), '[]'::json) from (select coalesce(nullif(url_path, ''), '/') as name, count(*) as pageviews, count(distinct session_id) as visitors from website_event where website_id = '${website_id}'::uuid and event_type = 1 and created_at >= to_timestamp(${start_epoch}) and created_at < to_timestamp(${end_epoch}) group by 1 order by pageviews desc, name limit 5) metric")"
  jq -e 'has("pageviews") and has("visitors")' <<<"$stats" >/dev/null
  jq -e 'type == "array"' <<<"$top" >/dev/null
  period_start="$(TZ="$UMAMI_REPORT_TIMEZONE" date -d "@$start_epoch" +%F)"
  period_end="$(TZ="$UMAMI_REPORT_TIMEZONE" date -d "@$end_epoch" +%F)"
  top_text="$(jq -r 'to_entries | map("\(.key + 1). \(.value.name): \(.value.pageviews) views, \(.value.visitors) visitors") | join("\n")' <<<"$top")"
  [[ -n "$top_text" ]] || top_text='No page views recorded yet.'
  message="[WEEKLY] Umami portal report (${period_start} to ${period_end})"$'\n'
  message+="Page views: $(jq -r '.pageviews' <<<"$stats") | Visitors: $(jq -r '.visitors' <<<"$stats") | Visits: $(jq -r '.visits' <<<"$stats")"$'\n'
  message+="Top pages:"$'\n'"${top_text}"
  send_discord "$message"
}

retention_preview() {
  local location="$1"
  if [[ "$location" == local ]]; then
    runuser -u zdrops -- bash -c '
      set -euo pipefail
      source "$1"
      restic forget --dry-run --json --keep-daily 7 --keep-weekly 4 --keep-monthly 6 \
        --tag supabase --tag r2 --tag umami-db --tag pi-config
    ' _ "$BACKUP_ENV"
  else
    runuser -u zdrops -- bash -c '
      set -euo pipefail
      source "$1"
      source "$2"
      export RESTIC_REPOSITORY="$RESTIC_OFFSITE_REPOSITORY"
      export RESTIC_PASSWORD="$RESTIC_OFFSITE_PASSWORD"
      restic forget --dry-run --json --keep-daily 14 --keep-weekly 8 --keep-monthly 12
    ' _ "$BACKUP_ENV" "$OFFSITE_ENV"
  fi
}

retention_counts() {
  jq -r '"keep \([.[] | .keep[]?] | length), remove \([.[] | .remove[]?] | length)"'
}

run_monthly() {
  local local_check offsite_check local_retention offsite_retention message
  collect_capacity
  local_check="$(runuser -u zdrops -- bash -c \
    'set -euo pipefail; source "$1"; timeout 2h restic check --read-data' _ "$BACKUP_ENV" 2>&1)"
  grep -q 'no errors were found' <<<"$local_check"
  offsite_check="$(runuser -u zdrops -- bash -c '
    set -euo pipefail
    source "$1"
    source "$2"
    export RESTIC_REPOSITORY="$RESTIC_OFFSITE_REPOSITORY"
    export RESTIC_PASSWORD="$RESTIC_OFFSITE_PASSWORD"
    timeout 2h restic check --read-data-subset=10%
  ' _ "$BACKUP_ENV" "$OFFSITE_ENV" 2>&1)"
  grep -q 'no errors were found' <<<"$offsite_check"
  local_retention="$(retention_preview local)"
  offsite_retention="$(retention_preview offsite)"

  CURRENT_REPORT_WEBHOOK="$DISCORD_MONTHLY_WEBHOOK"
  message="[MONTHLY] ZDR backup integrity and capacity - $(date -u +%F)"$'\n'
  message+="Integrity: local full data PASS; off-site 10% data sample PASS"
  message+=$'\n'"Retention preview: local $(retention_counts <<<"$local_retention"); off-site $(retention_counts <<<"$offsite_retention")"
  message+=$'\n'"$(capacity_summary)"
  message+=$'\n'"Thresholds: warning ${REPORT_CAPACITY_WARN_PERCENT}%; critical ${REPORT_CAPACITY_CRITICAL_PERCENT}%"
  send_discord "$message"
}

case "$MODE" in
  weekly)
    run_weekly_ops
    run_weekly_umami
    ;;
  monthly)
    run_monthly
    ;;
  capacity)
    run_capacity_alert
    ;;
esac
