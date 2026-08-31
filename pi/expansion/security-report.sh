#!/usr/bin/env bash
# Weekly read-only OS security and update posture report.
set -Eeuo pipefail

upgrades="$(apt list --upgradable 2>/dev/null | tail -n +2 || true)"
upgrade_count="$(grep -c . <<<"$upgrades" || true)"
upgrade_names="$(awk -F/ '{print $1}' <<<"$upgrades" | head -n 12 | paste -sd ',' -)"
[[ -n "$upgrade_names" ]] || upgrade_names='none'

reboot='no'
reboot_packages='none'
if [[ -e /run/reboot-required ]]; then
  reboot='YES'
  [[ ! -r /run/reboot-required.pkgs ]] || reboot_packages="$(head -n 12 /run/reboot-required.pkgs | paste -sd ',' -)"
fi

failed_units="$(systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}' | paste -sd ',' -)"
[[ -n "$failed_units" ]] || failed_units='none'

unattended_result="$(systemctl show unattended-upgrades.service -p Result --value 2>/dev/null || true)"
[[ -n "$unattended_result" ]] || unattended_result='unknown'

jail_summary='none'
if command -v fail2ban-client >/dev/null 2>&1 && systemctl is-active --quiet fail2ban.service; then
  jail_list="$(fail2ban-client status 2>/dev/null | sed -n 's/.*Jail list:[[:space:]]*//p' | tr -d '[:space:]')"
  current_bans=0
  total_bans=0
  IFS=',' read -ra jails <<<"$jail_list"
  for jail in "${jails[@]}"; do
    [[ -n "$jail" ]] || continue
    status="$(fail2ban-client status "$jail" 2>/dev/null || true)"
    current_bans=$((current_bans + $(awk -F: '/Currently banned:/ {gsub(/ /,"",$2); print $2+0}' <<<"$status")))
    total_bans=$((total_bans + $(awk -F: '/Total banned:/ {gsub(/ /,"",$2); print $2+0}' <<<"$status")))
  done
  jail_summary="${#jails[@]} jail(s), ${current_bans} current bans, ${total_bans} total bans"
fi

ssh_failures="$(journalctl -u ssh.service --since '7 days ago' --no-pager 2>/dev/null | \
  grep -Eci 'Failed password|Invalid user|authentication failure' || true)"

nft_state='inactive/invalid'
if systemctl is-active --quiet nftables.service && nft list ruleset >/dev/null 2>&1; then nft_state='active/readable'; fi

kernel_security_count="$(journalctl -k --since '7 days ago' --no-pager 2>/dev/null | \
  grep -Eci 'oom-kill|Out of memory|segfault|blocked for more than|EXT4-fs error|I/O error' || true)"

throttle='unavailable'
command -v vcgencmd >/dev/null 2>&1 && throttle="$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2 || true)"

permission_issues=()
protected_files=(
  /srv/ops/backup.env
  /srv/ops/cloudflared.env
  /srv/ops/gatus/gatus.env
  /srv/ops/notifications.env
  /srv/ops/monitoring.env
  /srv/ops/offsite.env
  /srv/ops/umami.env
  /srv/ops/mail-monitor.env
  /srv/ops/provider-export.env
)
for file in "${protected_files[@]}"; do
  [[ -e "$file" ]] || continue
  mode="$(stat -c %a "$file")"
  owner="$(stat -c %U:%G "$file")"
  [[ "$mode" == 600 ]] || permission_issues+=("$(basename "$file")=${owner}/${mode}")
done
permissions='all protected env files mode 600'
(( ${#permission_issues[@]} == 0 )) || permissions="issues: ${permission_issues[*]}"

level='WEEKLY'
[[ "$reboot" == no && "$failed_units" == none && "$nft_state" == active/readable ]] || level='WARN'

message="[${level}] ZDR security posture $(date -u +%F)"$'\n'
message+="Upgrades: ${upgrade_count} (${upgrade_names})"$'\n'
message+="Reboot required: ${reboot}; packages: ${reboot_packages}"$'\n'
message+="Unattended upgrades: ${unattended_result}; failed units: ${failed_units}"$'\n'
message+="Fail2ban: ${jail_summary}; SSH failures/7d: ${ssh_failures}"$'\n'
message+="nftables: ${nft_state}; kernel warning matches/7d: ${kernel_security_count}"$'\n'
message+="Throttle: ${throttle}; boot: $(uptime -s)"$'\n'
message+="Protected env permissions: ${permissions}"

printf '%s\n' "$message"
/srv/ops/discord-send.sh security-report "$message"
