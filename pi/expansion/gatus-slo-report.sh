#!/usr/bin/env bash
# Weekly 7d/30d uptime and response-time report from private Gatus.
set -Eeuo pipefail

BASE_URL="${GATUS_PRIVATE_URL:-http://127.0.0.1:8080}"
SLO_TARGET="${GATUS_SLO_TARGET_PERCENT:-99.0}"

on_error() {
  local line="$1" status="$2"
  trap - ERR
  /srv/ops/discord-send.sh slo-report "[FAIL] zdr-ops Gatus SLO report failed at line ${line} $(date -u +%FT%TZ)" || true
  exit "$status"
}
trap 'on_error "$LINENO" "$?"' ERR

statuses="$(curl -fsS --max-time 20 "$BASE_URL/api/v1/endpoints/statuses")"
jq -e 'type == "array" and length > 0' <<<"$statuses" >/dev/null

format_uptime() {
  local raw="$1"
  jq -er 'if type == "number" then . elif type == "object" and has("uptime") then .uptime else error("unsupported uptime JSON") end' <<<"$raw" | \
    awk '{v=$1; if (v <= 1) v=v*100; printf "%.3f", v}'
}

format_response_ms() {
  local raw="$1"
  jq -er 'if type == "number" then . elif type == "object" and has("average") then .average else error("unsupported response-time JSON") end' <<<"$raw" | \
    awk '{v=$1; if (v > 1000000) v=v/1000000; printf "%.0f", v}'
}

message="[WEEKLY] ZDR private Gatus SLO $(date -u +%F)"
warn=0
while IFS= read -r key; do
  uptime_7_json="$(curl -fsS --max-time 20 "$BASE_URL/api/v1/endpoints/${key}/uptimes/7d")"
  uptime_30_json="$(curl -fsS --max-time 20 "$BASE_URL/api/v1/endpoints/${key}/uptimes/30d")"
  response_7_json="$(curl -fsS --max-time 20 "$BASE_URL/api/v1/endpoints/${key}/response-times/7d")"
  response_30_json="$(curl -fsS --max-time 20 "$BASE_URL/api/v1/endpoints/${key}/response-times/30d")"
  uptime_7="$(format_uptime "$uptime_7_json")"
  uptime_30="$(format_uptime "$uptime_30_json")"
  response_7="$(format_response_ms "$response_7_json")"
  response_30="$(format_response_ms "$response_30_json")"
  if awk -v current="$uptime_7" -v target="$SLO_TARGET" 'BEGIN {exit !(current < target)}'; then warn=1; fi
  message+=$'\n'"${key}: 7d ${uptime_7}%/${response_7}ms; 30d ${uptime_30}%/${response_30}ms"
done < <(jq -r '.[].key' <<<"$statuses" | sort)

unhealthy="$(jq '[.[] | select((.results[-1].success // false) != true)] | length' <<<"$statuses")"
message+=$'\n'"Current unhealthy: ${unhealthy}; objective: ${SLO_TARGET}% (7d)"
if (( warn > 0 || unhealthy > 0 )); then message="${message/\[WEEKLY\]/[WARN]}"; fi

printf '%s\n' "$message"
/srv/ops/discord-send.sh slo-report "$message"
