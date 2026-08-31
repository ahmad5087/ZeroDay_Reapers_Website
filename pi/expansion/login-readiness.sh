#!/usr/bin/env bash
# Credential-free portal login readiness canary. Does not bypass Turnstile.
set -Eeuo pipefail

[[ -r /srv/ops/gatus/gatus.env ]] && source /srv/ops/gatus/gatus.env
SITE_HOST="${SITE_DOMAIN:-zerodayreapers.me}"
PORTAL_HOST="${PORTAL_DOMAIN:-$SITE_HOST}"
PORTAL_URL="${LOGIN_READINESS_PORTAL_URL:-https://${PORTAL_HOST}/portal}"
HEALTH_URL="${LOGIN_READINESS_HEALTH_URL:-https://${SITE_HOST}/api/health}"
TURNSTILE_URL='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
STATE_DIR="${LOGIN_READINESS_STATE_DIR:-/var/lib/zdr-login-readiness}"
STATE_FILE="$STATE_DIR/last-state"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

notify() { /srv/ops/discord-send.sh synthetic-login "$1"; }
failures=()
portal_body="$(mktemp)"
health_body="$(mktemp)"
trap 'rm -f "$portal_body" "$health_body"' EXIT

portal_result="$(curl -sSL --retry 2 --retry-all-errors --retry-delay 1 --max-redirs 3 --connect-timeout 5 --max-time 12 -o "$portal_body" -w '%{http_code} %{time_total}' "$PORTAL_URL" 2>/dev/null || true)"
read -r portal_code portal_time <<<"$portal_result"
[[ "$portal_code" == 200 ]] || failures+=("portal returned ${portal_code:-unreachable}")
grep -Eqi 'ZeroDay Reapers|ZERODAY REAPERS' "$portal_body" || failures+=("portal shell marker is missing")

health_result="$(curl -sSL --retry 2 --retry-all-errors --retry-delay 1 --max-redirs 3 --connect-timeout 5 --max-time 12 -o "$health_body" -w '%{http_code} %{time_total}' "$HEALTH_URL" 2>/dev/null || true)"
read -r health_code health_time <<<"$health_result"
[[ "$health_code" == 200 ]] || failures+=("app health returned ${health_code:-unreachable}")
if ! jq -e '.ok == true and .checks.db == "ok"' "$health_body" >/dev/null 2>&1; then
  failures+=("app health or Supabase DB path is not healthy")
fi

turnstile_code="$(curl -sSL --retry 2 --retry-all-errors --retry-delay 1 --max-redirs 3 --connect-timeout 5 --max-time 12 -o /dev/null -w '%{http_code}' "$TURNSTILE_URL" 2>/dev/null || true)"
[[ "$turnstile_code" == 200 ]] || failures+=("Turnstile client API returned ${turnstile_code:-unreachable}")

previous="$(cat "$STATE_FILE" 2>/dev/null || true)"
if (( ${#failures[@]} == 0 )); then
  if [[ -z "$previous" ]]; then
    message="[BASELINE] ZDR login readiness healthy $(date -u +%FT%TZ)"
    notify "$message"
  elif [[ "$previous" == fail:* ]]; then
    message="[RESOLVED] ZDR login readiness recovered $(date -u +%FT%TZ)"
    notify "$message"
  fi
  printf 'ok\n' >"$STATE_FILE"
  echo "login readiness OK: portal=${portal_time}s health=${health_time}s turnstile=200"
  exit 0
fi

failure_text="$(printf '%s\n' "${failures[@]}")"
new_state="fail:$(printf '%s' "$failure_text" | sha256sum | awk '{print $1}')"
if [[ "$previous" != "$new_state" ]]; then
  message="[FAIL] ZDR login readiness $(date -u +%FT%TZ)"
  while IFS= read -r item; do message+=$'\n- '; message+="$item"; done <<<"$failure_text"
  message+=$'\n'"This check does not use or bypass CAPTCHA credentials."
  notify "$message"
  printf '%s\n' "$new_state" >"$STATE_FILE"
fi
printf 'login readiness FAIL:\n%s\n' "$failure_text" >&2
exit 1
