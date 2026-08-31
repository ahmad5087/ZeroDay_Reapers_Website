#!/usr/bin/env bash
# SMART self-tests plus kernel storage-error monitoring for the backup HDD.
set -Eeuo pipefail

MODE="${1:-daily}"
[[ "$MODE" == daily || "$MODE" == short || "$MODE" == long ]] || {
  echo 'usage: disk-health.sh daily|short|long' >&2
  exit 2
}

[[ ! -r /srv/ops/guardian.env ]] || source /srv/ops/guardian.env
SMART_DEVICE="${GUARDIAN_SMART_DEVICE:-/dev/sda}"
SMART_TYPE="${GUARDIAN_SMART_TYPE:-auto}"
STATE_DIR="${DISK_HEALTH_STATE_DIR:-/var/lib/zdr-disk-health}"
STATE_FILE="$STATE_DIR/last-state"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

notify() { /srv/ops/discord-send.sh disk-health "$1"; }

if [[ "$MODE" == short || "$MODE" == long ]]; then
  for unit in backup.service config-backup.service offsite-copy.service restore-drill.service ops-report@monthly.service; do
    if systemctl is-active --quiet "$unit"; then
      echo "disk-health: skipping $MODE SMART test while $unit is active"
      exit 0
    fi
  done
  output="$(smartctl -t "$MODE" -d "$SMART_TYPE" "$SMART_DEVICE" 2>&1)" || {
    message="[FAIL] zdr-ops could not start ${MODE} SMART test $(date -u +%FT%TZ)"$'\n'
    message+="Device: ${SMART_DEVICE} (${SMART_TYPE})"$'\n'
    message+="$(printf '%s' "$output" | tail -n 4 | tr '\n' ' ' | cut -c1-800)"
    notify "$message"
    exit 1
  }
  message="[START] zdr-ops ${MODE} SMART test $(date -u +%FT%TZ)"$'\n'
  message+="Device: ${SMART_DEVICE} (${SMART_TYPE})"$'\n'
  message+="$(printf '%s' "$output" | grep -Ei 'test will complete|please wait|testing has begun' | tr '\n' ' ' | cut -c1-600)"
  printf '%s\n' "$message"
  notify "$message"
  exit 0
fi

smart_output="$(smartctl -H -A -l error -l selftest -d "$SMART_TYPE" "$SMART_DEVICE" 2>&1 || true)"
failures=()
grep -Eqi 'PASSED|SMART Health Status:[[:space:]]*OK' <<<"$smart_output" || failures+=("SMART health is not PASSED/OK")

temperature="$(awk '
  /Temperature_Celsius/ {print $10; exit}
  /Current Drive Temperature:/ {print $(NF-1); exit}
  /Temperature:/ && /Celsius/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9]+$/) {print $i; exit}}
' <<<"$smart_output")"
[[ -n "$temperature" ]] || temperature='unknown'

selftest="$(awk '/# 1 / {sub(/^[[:space:]]+/, ""); print; exit}' <<<"$smart_output")"
[[ -n "$selftest" ]] || selftest='no completed self-test entry'
if grep -Eq '^# 1 ' <<<"$selftest" && ! grep -Eqi 'Completed without error' <<<"$selftest"; then
  failures+=("latest SMART self-test is not clean: $(cut -c1-180 <<<"$selftest")")
fi

kernel_matches="$(journalctl -k --since '24 hours ago' --no-pager 2>/dev/null | \
  grep -Ei 'I/O error|Buffer I/O|EXT4-fs error|Remounting filesystem read-only|reset (high-speed|SuperSpeed) USB device|uas_eh_abort|blk_update_request|oom-kill' | tail -n 8 || true)"
if [[ -n "$kernel_matches" ]]; then
  failures+=("kernel logged storage/USB/OOM errors in the last 24h")
fi

previous="$(cat "$STATE_FILE" 2>/dev/null || true)"
if (( ${#failures[@]} == 0 )); then
  if [[ -z "$previous" ]]; then
    message="[BASELINE] zdr-ops disk health OK $(date -u +%FT%TZ)"$'\n'
    message+="${SMART_DEVICE}: SMART PASSED; temperature ${temperature} C"$'\n'
    message+="Latest test: $(cut -c1-300 <<<"$selftest")"
    notify "$message"
  elif [[ "$previous" == fail:* ]]; then
    message="[RESOLVED] zdr-ops disk health recovered $(date -u +%FT%TZ)"$'\n'
    message+="${SMART_DEVICE}: SMART PASSED; no matching kernel errors; temperature ${temperature} C"
    notify "$message"
  fi
  printf 'ok\n' >"$STATE_FILE"
  echo "disk-health OK: temperature=${temperature}C; $selftest"
  exit 0
fi

failure_text="$(printf '%s\n' "${failures[@]}")"
failure_hash="$(printf '%s' "$failure_text" | sha256sum | awk '{print $1}')"
new_state="fail:$failure_hash"
if [[ "$previous" != "$new_state" ]]; then
  message="[FAIL] zdr-ops disk health $(date -u +%FT%TZ)"
  while IFS= read -r item; do message+=$'\n- '; message+="$item"; done <<<"$failure_text"
  message+=$'\n'"Temperature: ${temperature} C"
  if [[ -n "$kernel_matches" ]]; then
    message+=$'\n'"Recent kernel sample: $(printf '%s' "$kernel_matches" | tail -n 2 | tr '\n' ' ' | cut -c1-500)"
  fi
  notify "$message"
  printf '%s\n' "$new_state" >"$STATE_FILE"
fi
printf 'disk-health FAIL:\n%s\n' "$failure_text" >&2
exit 1
