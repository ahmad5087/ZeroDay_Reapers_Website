#!/usr/bin/env bash
# verify.sh - one-run health check for zdr-ops (monitor + backups). READ-ONLY, safe to run anytime.
# Run:  sudo bash verify.sh
# Prints PASS/WARN/FAIL per check and a summary; exits non-zero if any FAIL.
set -uo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root:  sudo bash $0"; exit 1; }

PASS=0; WARN=0; FAIL=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$1"; WARN=$((WARN+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }
hdr()  { printf '\n== %s ==\n' "$1"; }
ENV=/srv/ops/backup.env
zsrc() { sudo -u zdrops bash -c "source $ENV && $1"; }   # run a cmd as zdrops with backup.env sourced

hdr "Host & storage"
[ "$(hostname)" = zdr-ops ] && ok "hostname zdr-ops" || warn "hostname is $(hostname)"
ip -br addr | grep -q '10\.10\.0\.132' && ok "IP 10.10.0.132 present" || warn "10.10.0.132 not found on any interface"
mountpoint -q /srv/backups && ok "/srv/backups mounted ($(df -h --output=size /srv/backups | tail -1 | tr -d ' '))" || bad "/srv/backups NOT mounted"
mountpoint -q /srv/ops     && ok "/srv/ops mounted ($(df -h --output=size /srv/ops | tail -1 | tr -d ' '))"     || bad "/srv/ops NOT mounted"
swapon --show 2>/dev/null | grep -q zram && ok "zram swap active" || warn "zram swap not active"

hdr "Services (active + enabled at boot)"
for u in docker nftables gatus backup.timer; do
  systemctl is-active --quiet "$u" && ok "$u active" || bad "$u NOT active"
done
for u in gatus backup.timer nftables; do
  systemctl is-enabled --quiet "$u" && ok "$u enabled at boot" || warn "$u NOT enabled at boot"
done
NEXT=$(systemctl show -p NextElapseUSecRealtime --value backup.timer 2>/dev/null)
[ -n "$NEXT" ] && ok "backup.timer next run: $NEXT" || warn "backup.timer has no scheduled run"

hdr "Firewall (nftables)"
RULES=$(nft list ruleset 2>/dev/null)
echo "$RULES" | grep -q 'iifname "docker0" accept' && ok "docker0 egress rule present" || bad "docker0 egress rule MISSING (gatus checks would time out)"
echo "$RULES" | grep -q 'tcp dport 22'   && ok "SSH (22) allowed" || warn "SSH rule not found"
echo "$RULES" | grep -q 'tcp dport 8080' && ok "gatus dashboard (8080) allowed from admin net" || warn "8080 rule not found"

hdr "gatus monitor"
docker ps --filter name=gatus --filter status=running --format '{{.Names}}' 2>/dev/null | grep -qx gatus \
  && ok "gatus container running" || bad "gatus container NOT running"
if curl -fsS -m 10 http://localhost:8080/api/v1/endpoints/statuses -o /tmp/_gatus.json 2>/dev/null; then
  ok "gatus API reachable on :8080"
  while read -r key succ; do
    [ "$succ" = true ] && ok "check: $key" || warn "check: $key (latest not passing - open the dashboard)"
  done < <(jq -r '.[] | "\(.key) \((.results[-1].success // false))"' /tmp/_gatus.json 2>/dev/null)
  rm -f /tmp/_gatus.json
else
  bad "gatus API not reachable on :8080"
fi

hdr "Backups (restic + rclone + DB)"
if [ -r "$ENV" ] || sudo test -r "$ENV"; then
  MISS=$(zsrc 'for v in RESTIC_REPOSITORY RESTIC_PASSWORD RESTIC_CACHE_DIR RCLONE_CONFIG RCLONE_REMOTE R2_BUCKET DATABASE_URL DISCORD_WEBHOOK; do [ -z "${!v}" ] && echo -n "$v "; done')
  [ -z "$MISS" ] && ok "backup.env has all 8 vars" || bad "backup.env missing: $MISS"

  SNAP=$(zsrc 'restic snapshots --json 2>/dev/null' || true)
  if [ -n "$SNAP" ] && echo "$SNAP" | jq -e 'length>0' >/dev/null 2>&1; then
    sup=$(echo "$SNAP" | jq '[.[]|select(.tags|index("supabase"))]|length')
    r2=$( echo "$SNAP" | jq '[.[]|select(.tags|index("r2"))]|length')
    [ "$sup" -ge 1 ] && ok "supabase snapshot present ($sup)" || bad "no supabase snapshot"
    [ "$r2"  -ge 1 ] && ok "r2 snapshot present ($r2)"       || bad "no r2 snapshot"
    last=$(echo "$SNAP" | jq -r 'max_by(.time)|.time' | sed 's/\.[0-9]*//')
    le=$(date -d "$last" +%s 2>/dev/null || echo 0)
    if [ "$le" -gt 0 ]; then
      age=$(( ( $(date +%s) - le ) / 3600 ))
      [ "$age" -le 26 ] && ok "last backup ${age}h ago" || warn "last backup ${age}h ago (>26h - timer may not be firing)"
    fi
  else
    bad "restic has no snapshots (or repo unreadable)"
  fi

  zsrc 'psql "$DATABASE_URL" -tAc "select 1" >/dev/null 2>&1' && ok "Supabase DB reachable (pooler)" || bad "Supabase DB unreachable (check DATABASE_URL)"
  zsrc 'env RCLONE_CONFIG="$RCLONE_CONFIG" rclone lsd "r2:$R2_BUCKET" >/dev/null 2>&1' && ok "R2 bucket reachable" || bad "R2 bucket unreachable (check rclone.conf)"
else
  warn "backup.env not found - backups not configured yet (PI.md sec 10)"
fi

hdr "Summary"
printf '  PASS=%d  WARN=%d  FAIL=%d\n' "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "  RESULT: zdr-ops fully operational (WARN items are informational)."
  exit 0
else
  echo "  RESULT: issues above need attention."
  exit 1
fi
