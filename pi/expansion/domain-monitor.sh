#!/usr/bin/env bash
# Registrar, DNS, TLS, SPF, DKIM, and DMARC drift monitor.
set -Eeuo pipefail

[[ -r /srv/ops/domain-monitor.env ]] && source /srv/ops/domain-monitor.env
: "${DOMAIN:=zerodayreapers.me}"
: "${HOSTS:=zerodayreapers.me portal.zerodayreapers.me status.zerodayreapers.me analytics.zerodayreapers.me}"
: "${DKIM_NAMES:=resend._domainkey.zerodayreapers.me}"
: "${DOMAIN_EXPIRY_WARN_DAYS:=45}"
: "${TLS_EXPIRY_WARN_DAYS:=21}"

STATE_DIR="${DOMAIN_MONITOR_STATE_DIR:-/var/lib/zdr-domain-monitor}"
BASELINE="$STATE_DIR/dns-baseline.txt"
STATE_FILE="$STATE_DIR/last-state"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

notify() { /srv/ops/discord-send.sh domain-monitor "$1"; }

query_values() {
  local name="$1" type="$2" values
  values="$(dig +time=5 +tries=1 +short "$type" "$name" 2>/dev/null | sed 's/[[:space:]]\+$//' | sort -u)"
  [[ -n "$values" ]] || values='<none>'
  while IFS= read -r value; do printf '%s %s %s\n' "$name" "$type" "$value"; done <<<"$values"
}

current_dns() {
  for type in A AAAA CNAME MX NS CAA; do query_values "$DOMAIN" "$type"; done
  query_values "$DOMAIN" TXT
  query_values "_dmarc.$DOMAIN" TXT
  query_values "$DOMAIN" DS
  for dkim in $DKIM_NAMES; do
    query_values "$dkim" TXT
    query_values "$dkim" CNAME
  done
  for host in $HOSTS; do
    [[ "$host" == "$DOMAIN" ]] && continue
    query_values "$host" A
    query_values "$host" AAAA
    query_values "$host" CNAME
  done
}

if [[ "${1:-}" == --print-current ]]; then
  current_dns
  exit 0
fi

if [[ "${1:-}" == --init-baseline ]]; then
  tmp="$(mktemp "$STATE_DIR/.dns-baseline.XXXXXX")"
  current_dns >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$BASELINE"
  printf 'ok\n' >"$STATE_FILE"
  message="[BASELINE] zdr-ops domain/DNS posture recorded $(date -u +%FT%TZ)"$'\n'
  message+="Domain: ${DOMAIN}; records: $(wc -l <"$BASELINE")"
  notify "$message"
  exit 0
fi

[[ -s "$BASELINE" ]] || {
  echo "DNS baseline is missing; run domain-monitor.sh --print-current and --init-baseline after review" >&2
  exit 2
}

failures=()
current="$(mktemp)"
trap 'rm -f "$current"' EXIT
current_dns >"$current"
if ! cmp -s "$BASELINE" "$current"; then
  drift_count="$(diff -U0 "$BASELINE" "$current" 2>/dev/null | grep -Ec '^[+-][^-+]' || true)"
  failures+=("DNS baseline drift (${drift_count} changed line(s)); review journal output")
  diff -u "$BASELINE" "$current" || true
fi

mx="$(dig +short MX "$DOMAIN" 2>/dev/null || true)"
spf="$(dig +short TXT "$DOMAIN" 2>/dev/null | grep -i 'v=spf1' || true)"
dmarc="$(dig +short TXT "_dmarc.$DOMAIN" 2>/dev/null | grep -i 'v=DMARC1' || true)"
[[ -n "$mx" ]] || failures+=("MX record is missing")
[[ -n "$spf" ]] || failures+=("SPF record is missing")
[[ -n "$dmarc" ]] || failures+=("DMARC record is missing")
for dkim in $DKIM_NAMES; do
  dkim_value="$(dig +short TXT "$dkim" 2>/dev/null; dig +short CNAME "$dkim" 2>/dev/null)"
  [[ -n "$dkim_value" ]] || failures+=("DKIM record is missing for $dkim")
done

expiration=''
rdap="$(curl -fsS --max-time 20 "https://rdap.org/domain/${DOMAIN}" 2>/dev/null || true)"
if jq -e . >/dev/null 2>&1 <<<"$rdap"; then
  expiration="$(jq -r '[.events[]? | select(.eventAction == "expiration") | .eventDate] | first // empty' <<<"$rdap")"
fi
if [[ -z "$expiration" ]]; then
  expiration="$(timeout 20 whois "$DOMAIN" 2>/dev/null | sed -nE 's/^(Registry Expiry Date|Expiry Date|Expiration Date):[[:space:]]*//Ip' | head -n1)"
fi
domain_days='unknown'
if [[ -n "$expiration" ]] && expiration_epoch="$(date -d "$expiration" +%s 2>/dev/null)"; then
  domain_days=$(( (expiration_epoch - $(date +%s)) / 86400 ))
  (( domain_days >= DOMAIN_EXPIRY_WARN_DAYS )) || failures+=("domain expires in ${domain_days} day(s)")
else
  failures+=("domain expiration could not be determined")
fi

tls_summary=()
for host in $HOSTS; do
  cert="$(timeout 20 openssl s_client -servername "$host" -connect "${host}:443" </dev/null 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null || true)"
  enddate="${cert#notAfter=}"
  if [[ -z "$cert" || "$enddate" == "$cert" ]]; then
    failures+=("TLS certificate unreadable for $host")
    continue
  fi
  tls_epoch="$(date -d "$enddate" +%s 2>/dev/null || echo 0)"
  tls_days=$(( (tls_epoch - $(date +%s)) / 86400 ))
  tls_summary+=("${host}=${tls_days}d")
  (( tls_days >= TLS_EXPIRY_WARN_DAYS )) || failures+=("TLS for $host expires in ${tls_days} day(s)")
done

previous="$(cat "$STATE_FILE" 2>/dev/null || true)"
if (( ${#failures[@]} == 0 )); then
  if [[ "$previous" == fail:* ]]; then
    message="[RESOLVED] zdr-ops domain/DNS/mail posture recovered $(date -u +%FT%TZ)"$'\n'
    message+="Domain expiry: ${domain_days}d; TLS: ${tls_summary[*]}"
    notify "$message"
  fi
  printf 'ok\n' >"$STATE_FILE"
  echo "domain monitor OK: domain=${domain_days}d TLS=${tls_summary[*]}"
  exit 0
fi

failure_text="$(printf '%s\n' "${failures[@]}")"
new_state="fail:$(printf '%s' "$failure_text" | sha256sum | awk '{print $1}')"
if [[ "$previous" != "$new_state" ]]; then
  message="[FAIL] zdr-ops domain/DNS/mail posture $(date -u +%FT%TZ)"
  while IFS= read -r item; do message+=$'\n- '; message+="$item"; done <<<"$failure_text"
  notify "$message"
  printf '%s\n' "$new_state" >"$STATE_FILE"
fi
printf 'domain monitor FAIL:\n%s\n' "$failure_text" >&2
exit 1
