#!/usr/bin/env bash
# Notification-only digest and upstream release check. Never pulls or restarts containers.
set -Eeuo pipefail

STATE_DIR="${CONTAINER_UPDATE_STATE_DIR:-/var/lib/zdr-container-updates}"
STATE_FILE="$STATE_DIR/last-state"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
notify() { /srv/ops/discord-send.sh container-updates "$1"; }

latest_release() {
  local repository="$1"
  curl -fsS --connect-timeout 5 --max-time 30 -H 'User-Agent: zdr-ops-monitor' \
    "https://api.github.com/repos/${repository}/releases/latest" | jq -er '.tag_name'
}

normalize_version() {
  local value="$1"
  value="${value#postgresql-}"
  value="${value#v}"
  printf '%s' "$value"
}

containers=(gatus gatus-public cloudflared umami)
findings=()
details=()
errors=()
for container in "${containers[@]}"; do
  if ! docker inspect "$container" >/dev/null 2>&1; then
    errors+=("$container is not running/present")
    continue
  fi
  ref="$(docker inspect -f '{{.Config.Image}}' "$container")"
  image_id="$(docker inspect -f '{{.Image}}' "$container")"
  ref_without_digest="${ref%@*}"
  tag="${ref_without_digest##*:}"
  [[ "$tag" != "$ref_without_digest" ]] || tag='latest'
  details+=("${container}=${tag}")

  if [[ "$ref" != *@sha256:* ]]; then
    remote_digest="$(skopeo inspect --retry-times 2 --format '{{.Digest}}' "docker://${ref}" 2>/dev/null || true)"
    local_digest="$(docker image inspect "$image_id" --format '{{json .RepoDigests}}' 2>/dev/null | jq -r '.[0] // ""' | sed 's/.*@//' || true)"
    if [[ -z "$remote_digest" ]]; then
      errors+=("registry digest unreadable for $container")
    elif [[ -n "$local_digest" && "$remote_digest" != "$local_digest" ]]; then
      findings+=("$container tag ${tag} points to a new digest")
    fi
  fi

  repository=''
  case "$container" in
    gatus) repository='TwiN/gatus' ;;
    cloudflared) repository='cloudflare/cloudflared' ;;
    umami) repository='umami-software/umami' ;;
  esac
  if [[ -n "$repository" && "$tag" != latest && "$tag" != stable ]]; then
    latest="$(latest_release "$repository" 2>/dev/null || true)"
    if [[ -z "$latest" ]]; then
      errors+=("latest release unreadable for $container")
    elif [[ "$(normalize_version "$latest")" != "$(normalize_version "$tag")" ]]; then
      findings+=("$container installed ${tag}; upstream latest ${latest}")
    fi
  fi
done

state_text='ok'
(( ${#findings[@]} == 0 )) || state_text="available:$(printf '%s\n' "${findings[@]}" | sha256sum | awk '{print $1}')"
(( ${#errors[@]} == 0 )) || state_text="error:$(printf '%s\n' "${errors[@]}" | sha256sum | awk '{print $1}')"
previous="$(cat "$STATE_FILE" 2>/dev/null || true)"

if [[ "$state_text" == ok ]]; then
  if [[ -z "$previous" ]]; then
    notify "[BASELINE] ZDR container versions recorded $(date -u +%FT%TZ)"$'\n'"${details[*]}"
  elif [[ "$previous" != ok ]]; then
    notify "[RESOLVED] ZDR managed container versions are current/readable $(date -u +%FT%TZ)"$'\n'"${details[*]}"
  fi
  printf 'ok\n' >"$STATE_FILE"
  echo "container update check OK: ${details[*]}"
  exit 0
fi

if [[ "$previous" != "$state_text" ]]; then
  if [[ "$state_text" == available:* ]]; then
    message="[UPDATE] ZDR container update available $(date -u +%FT%TZ)"
    while IFS= read -r item; do message+=$'\n- '; message+="$item"; done < <(printf '%s\n' "${findings[@]}")
    message+=$'\n'"Notification only; no image was pulled or restarted."
  else
    message="[FAIL] ZDR container update check incomplete $(date -u +%FT%TZ)"
    while IFS= read -r item; do message+=$'\n- '; message+="$item"; done < <(printf '%s\n' "${errors[@]}")
  fi
  notify "$message"
  printf '%s\n' "$state_text" >"$STATE_FILE"
fi

[[ "$state_text" != error:* ]]
