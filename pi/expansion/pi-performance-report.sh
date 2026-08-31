#!/usr/bin/env bash
# Lightweight current/daily/weekly Pi resource report.
set -Eeuo pipefail

MODE="${1:-daily}"
[[ "$MODE" == daily || "$MODE" == weekly ]] || { echo 'usage: pi-performance-report.sh daily|weekly' >&2; exit 2; }

human_kib() { numfmt --from-unit=1024 --to=iec-i --suffix=B "${1:-0}"; }

mem_total_kib="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
mem_available_kib="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
swap_used_bytes="$(free -b | awk '/^Swap:/ {print $3}')"
load="$(awk '{print $1" "$2" "$3}' /proc/loadavg)"
uptime_text="$(uptime -p)"
temperature='unavailable'
throttle='unavailable'
command -v vcgencmd >/dev/null 2>&1 && temperature="$(vcgencmd measure_temp 2>/dev/null | cut -d= -f2 || true)"
command -v vcgencmd >/dev/null 2>&1 && throttle="$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2 || true)"

cpu_average='collecting'
if command -v sar >/dev/null 2>&1; then
  cpu_average="$(LC_ALL=C sar -u 2>/dev/null | awk '/Average:/ && $2 == "all" {printf "%.1f%%", 100-$NF}' | tail -n1)"
  [[ -n "$cpu_average" ]] || cpu_average='collecting'
fi

disk_line='unavailable'
if command -v iostat >/dev/null 2>&1; then
  disk_line="$(LC_ALL=C iostat -dx 1 2 2>/dev/null | awk '$1 == "sda" {line=$0} END {print line}')"
  [[ -n "$disk_line" ]] || disk_line='unavailable'
fi

traffic='collecting'
if command -v vnstat >/dev/null 2>&1; then
  traffic="$(vnstat -i eth0 --oneline b 2>/dev/null | cut -c1-240 || true)"
  [[ -n "$traffic" ]] || traffic='collecting'
fi

top_rss="$(ps -eo comm=,rss= --sort=-rss | head -n 5 | awk '{printf "%s:%sMiB ", $1, int($2/1024)}')"
containers="$(docker stats --no-stream --format '{{.Name}}={{.MemUsage}}' 2>/dev/null | sed 's/ \/ .*//' | paste -sd ', ' - || true)"
[[ -n "$containers" ]] || containers='unavailable'

level='REPORT'
(( mem_available_kib >= 204800 )) || level='WARN'
if [[ "$throttle" =~ ^0x[0-9a-fA-F]+$ ]] && (( (throttle & 0xF) != 0 )); then level='WARN'; fi

message="[${level}] zdr-ops Pi performance (${MODE}) $(date -u +%FT%TZ)"$'\n'
message+="Uptime: ${uptime_text}; load: ${load}; avg CPU used: ${cpu_average}"$'\n'
message+="RAM: $(human_kib "$mem_available_kib") available / $(human_kib "$mem_total_kib"); swap used: $(numfmt --to=iec-i --suffix=B "$swap_used_bytes")"$'\n'
message+="Temp: ${temperature}; throttle: ${throttle}"$'\n'
message+="sda iostat: ${disk_line}"$'\n'
message+="eth0: ${traffic}"$'\n'
message+="Top RSS: ${top_rss}"$'\n'
message+="Containers: ${containers}"$'\n'
message+="Local time: $(date '+%F %T %Z')"

printf '%s\n' "$message"
/srv/ops/discord-send.sh pi-performance "$message"
