#!/usr/bin/env bash
# Optional Tailscale state monitor; enable only after tailnet enrollment succeeds.
set -Eeuo pipefail

command -v tailscale >/dev/null 2>&1 || { echo 'tailscale is not installed; keep this timer disabled' >&2; exit 2; }
STATE_DIR="${TAILSCALE_HEALTH_STATE_DIR:-/var/lib/zdr-tailscale-health}"
STATE_FILE="$STATE_DIR/last-state"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
notify() { /srv/ops/discord-send.sh tailscale "$1"; }

failures=()
systemctl is-active --quiet tailscaled.service || failures+=("tailscaled.service is not active")
status_json="$(tailscale status --json 2>/dev/null || true)"
if ! jq -e . >/dev/null 2>&1 <<<"$status_json"; then
  failures+=("tailscale status JSON is unreadable")
else
  backend="$(jq -r '.BackendState // "unknown"' <<<"$status_json")"
  [[ "$backend" == Running ]] || failures+=("backend state is $backend")
  ip4="$(jq -r '.TailscaleIPs[]? | select(test("^[0-9.]+$"))' <<<"$status_json" | head -n1)"
  [[ -n "$ip4" ]] || failures+=("no Tailscale IPv4 address is assigned")
  if [[ -n "${TAILSCALE_EXPECTED_DNS_NAME:-}" ]]; then
    dns_name="$(jq -r '.Self.DNSName // ""' <<<"$status_json")"
    [[ "$dns_name" == "$TAILSCALE_EXPECTED_DNS_NAME" ]] || failures+=("unexpected tailnet DNS identity")
  fi
fi

previous="$(cat "$STATE_FILE" 2>/dev/null || true)"
if (( ${#failures[@]} == 0 )); then
  if [[ -z "$previous" ]]; then
    notify "[BASELINE] zdr-ops Tailscale healthy $(date -u +%FT%TZ)"$'\n'"Address: ${ip4}"
  elif [[ "$previous" == fail:* ]]; then
    notify "[RESOLVED] zdr-ops Tailscale recovered $(date -u +%FT%TZ)"$'\n'"Address: ${ip4}"
  fi
  printf 'ok\n' >"$STATE_FILE"
  echo "tailscale OK: $ip4"
  exit 0
fi

failure_text="$(printf '%s\n' "${failures[@]}")"
new_state="fail:$(printf '%s' "$failure_text" | sha256sum | awk '{print $1}')"
if [[ "$previous" != "$new_state" ]]; then
  message="[FAIL] zdr-ops Tailscale $(date -u +%FT%TZ)"
  while IFS= read -r item; do message+=$'\n- '; message+="$item"; done <<<"$failure_text"
  notify "$message"
  printf '%s\n' "$new_state" >"$STATE_FILE"
fi
exit 1
