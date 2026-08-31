#!/usr/bin/env bash
# Read-only inventory used before installing the monitoring expansion.
set -u

echo '== host =='
cat /etc/os-release | sed -n 's/^PRETTY_NAME=//p'
timedatectl show -p Timezone -p NTPSynchronized --value
free -h
df -h / /srv/ops /srv/backups

echo '== packages =='
for package in sysstat vnstat smartmontools aide skopeo tailscale python3 jq curl dnsutils bind9-dnsutils whois; do
  if dpkg-query -W -f='${Status} ${Version}\n' "$package" 2>/dev/null | grep -q '^install ok installed'; then
    printf '%-20s installed\n' "$package"
  else
    printf '%-20s missing\n' "$package"
  fi
done

echo '== relevant units =='
systemctl list-unit-files --no-legend --no-pager | \
  awk '$1 ~ /^(gatus|gatus-public|cloudflared|umami|guardian|backup|config-backup|offsite-copy|restore-drill|ops-|fail2ban|nftables|unattended-upgrades|tailscaled)/ {print}'

echo '== timers =='
systemctl list-timers --all --no-pager | \
  grep -E 'backup|restore|guardian|offsite|ops-|NEXT|^$' || true

echo '== protected environment variable names only =='
while IFS= read -r -d '' env_file; do
  printf '%s: ' "$env_file"
  awk -F= '/^(export[[:space:]]+)?[A-Z][A-Z0-9_]*=/ {
    key=$1; sub(/^export[[:space:]]+/, "", key); keys[++n]=key
  } END {
    for (i=1; i<=n; i++) printf "%s%s", keys[i], (i<n ? "," : "")
  }' "$env_file"
  printf '\n'
done < <(find /srv/ops -maxdepth 3 -type f -name '*.env' -print0 2>/dev/null | sort -z)

echo '== credential availability flags =='
for item in \
  '/srv/ops/gatus/gatus.env:SMTP_USER' \
  '/srv/ops/gatus/gatus.env:SMTP_PASSWORD' \
  '/srv/ops/gatus/gatus.env:SMTP_HOST' \
  '/srv/ops/notifications.env:DISCORD_GUARDIAN_WEBHOOK' \
  '/srv/ops/provider-export.env:CLOUDFLARE_API_TOKEN' \
  '/srv/ops/provider-export.env:VERCEL_API_TOKEN'; do
  file="${item%%:*}"
  key="${item#*:}"
  if [[ -r "$file" ]] && grep -Eq "^(export[[:space:]]+)?${key}=..+" "$file"; then
    printf '%s present\n' "$key"
  else
    printf '%s absent\n' "$key"
  fi
done

echo '== disks and interfaces =='
lsblk -o NAME,MODEL,SERIAL,SIZE,FSTYPE,MOUNTPOINTS
ip -br link

echo '== current resource users =='
ps -eo pid,comm,rss,%cpu --sort=-rss | head -n 12
docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' 2>/dev/null || true
