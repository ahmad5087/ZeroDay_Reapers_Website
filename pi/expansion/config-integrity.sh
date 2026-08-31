#!/usr/bin/env bash
# Scoped AIDE configuration-integrity monitor. Never updates its own baseline.
set -Eeuo pipefail

CONFIG="${AIDE_ZDR_CONFIG:-/etc/aide/zdr-ops.conf}"
DATABASE="${AIDE_ZDR_DATABASE:-/var/lib/aide-zdr/aide.db}"
STATE_DIR="${CONFIG_INTEGRITY_STATE_DIR:-/var/lib/zdr-config-integrity}"
STATE_FILE="$STATE_DIR/last-state"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

notify() { /srv/ops/discord-send.sh config-integrity "$1"; }

[[ -s "$DATABASE" ]] || {
  notify "[FAIL] zdr-ops AIDE baseline is missing $(date -u +%FT%TZ)"
  echo "AIDE baseline is missing: $DATABASE" >&2
  exit 2
}

set +e
output="$(aide --check --config "$CONFIG" 2>&1)"
status=$?
set -e
printf '%s\n' "$output"

previous="$(cat "$STATE_FILE" 2>/dev/null || true)"
if (( status == 0 )); then
  if [[ -z "$previous" ]]; then
    notify "[BASELINE] zdr-ops configuration integrity clean $(date -u +%FT%TZ)"
  elif [[ "$previous" == fail:* ]]; then
    notify "[RESOLVED] zdr-ops configuration integrity clean $(date -u +%FT%TZ)"
  fi
  printf 'ok\n' >"$STATE_FILE"
  exit 0
fi

if (( status <= 7 )); then
  summary="$(grep -E '^(/|Added entries:|Removed entries:|Changed entries:|Total number of entries:)' <<<"$output" | tail -n 20 | cut -c1-120 | head -c 1100)"
  [[ -n "$summary" ]] || summary="AIDE reported added, removed, or changed paths (exit ${status}); inspect the journal."
  failure="configuration drift:${status}:$(sha256sum <<<"$summary" | awk '{print $1}')"
  new_state="fail:$(sha256sum <<<"$failure" | awk '{print $1}')"
  if [[ "$previous" != "$new_state" ]]; then
    message="[WARN] zdr-ops configuration drift $(date -u +%FT%TZ)"$'\n'
    message+="AIDE exit: ${status}. Do not accept a new baseline before review."$'\n'
    message+="$summary"
    notify "$message"
    printf '%s\n' "$new_state" >"$STATE_FILE"
  fi
  exit "$status"
fi

new_state="fail:error-${status}"
if [[ "$previous" != "$new_state" ]]; then
  notify "[FAIL] zdr-ops AIDE execution error ${status} $(date -u +%FT%TZ); inspect config-integrity.service journal"
  printf '%s\n' "$new_state" >"$STATE_FILE"
fi
exit "$status"
