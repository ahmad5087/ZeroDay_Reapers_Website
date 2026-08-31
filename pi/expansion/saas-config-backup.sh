#!/usr/bin/env bash
# Read-only Cloudflare/Vercel configuration export for encrypted pi-config backup.
set -Eeuo pipefail

ENV_FILE="${PROVIDER_EXPORT_ENV:-/srv/ops/provider-export.env}"
ROOT="${PROVIDER_EXPORT_ROOT:-/srv/ops/provider-exports}"
[[ -r "$ENV_FILE" ]] || { echo "$ENV_FILE is missing" >&2; exit 2; }
source "$ENV_FILE"

required=(CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_TUNNEL_ID VERCEL_API_TOKEN VERCEL_PROJECT_ID VERCEL_TEAM_ID)
for key in "${required[@]}"; do
  [[ -n "${!key:-}" && "${!key}" != CHANGE_ME ]] || { echo "$key is missing or a placeholder" >&2; exit 2; }
done

install -d -o root -g root -m 0700 "$ROOT"
staging="$(mktemp -d "$ROOT/.staging.XXXXXX")"
cleanup() { rm -rf -- "$staging"; }
trap cleanup EXIT

notify() { /srv/ops/discord-send.sh saas-config-backup "$1"; }
on_error() {
  local line="$1" status="$2"
  trap - ERR
  notify "[FAIL] zdr-ops SaaS configuration export failed at line ${line} $(date -u +%FT%TZ)" || true
  exit "$status"
}
trap 'on_error "$LINENO" "$?"' ERR

cf_get() {
  local path="$1" output="$2"
  curl -fsS --connect-timeout 5 --max-time 60 \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H 'Content-Type: application/json' \
    "https://api.cloudflare.com/client/v4/${path}" >"$output"
  jq -e '.success == true' "$output" >/dev/null
  tmp="${output}.redacted"
  jq 'walk(if type == "object" then with_entries(if (.key | test("token|secret|password|credential|clientSecret"; "i")) then .value = "[REDACTED]" else . end) else . end)' \
    "$output" >"$tmp"
  mv "$tmp" "$output"
}

vercel_get() {
  local path="$1" output="$2"
  separator='?'
  [[ "$path" == *'?'* ]] && separator='&'
  curl -fsS --connect-timeout 5 --max-time 60 \
    -H "Authorization: Bearer ${VERCEL_API_TOKEN}" \
    "https://api.vercel.com/${path}${separator}teamId=${VERCEL_TEAM_ID}" >"$output"
  jq -e . "$output" >/dev/null
}

cf_get "zones/${CLOUDFLARE_ZONE_ID}" "$staging/cloudflare-zone.json"
cf_get "zones/${CLOUDFLARE_ZONE_ID}/dns_records?per_page=5000" "$staging/cloudflare-dns.json"
cf_get "accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${CLOUDFLARE_TUNNEL_ID}" "$staging/cloudflare-tunnel.json"
cf_get "accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${CLOUDFLARE_TUNNEL_ID}/configurations" "$staging/cloudflare-tunnel-config.json"

vercel_get "v9/projects/${VERCEL_PROJECT_ID}" "$staging/vercel-project.raw.json"
vercel_get "v9/projects/${VERCEL_PROJECT_ID}/domains" "$staging/vercel-domains.raw.json"
vercel_get "v10/projects/${VERCEL_PROJECT_ID}/env?decrypt=false" "$staging/vercel-env.raw.json"
jq 'del(.env?, .password?, .secret?)' "$staging/vercel-project.raw.json" >"$staging/vercel-project.json"
jq '{domains: [.domains[]? | {name,redirect,redirectStatusCode,gitBranch,createdAt,updatedAt,verified}]}' \
  "$staging/vercel-domains.raw.json" >"$staging/vercel-domains.json"
jq '{envs: [.envs[]? | {id,key,type,target,gitBranch,createdAt,updatedAt}]}' \
  "$staging/vercel-env.raw.json" >"$staging/vercel-env-metadata.json"
rm -f "$staging"/*.raw.json

(cd "$staging" && sha256sum ./*.json >manifest.sha256)
jq -n --arg created_at "$(date -u +%FT%TZ)" \
  --arg note 'Read-only metadata export; provider tokens and Vercel environment values are excluded.' \
  '{created_at:$created_at,note:$note}' >"$staging/manifest.json"
chmod 600 "$staging"/*

rm -rf -- "$ROOT/previous"
[[ ! -e "$ROOT/current" ]] || mv "$ROOT/current" "$ROOT/previous"
mv "$staging" "$ROOT/current"
trap - EXIT

file_count="$(find "$ROOT/current" -maxdepth 1 -type f | wc -l)"
notify "[OK] zdr-ops SaaS configuration export completed $(date -u +%FT%TZ)"$'\n'"Files: ${file_count}; encrypted pi-config backup requested."
systemctl start --no-block config-backup.service
