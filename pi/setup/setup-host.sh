#!/usr/bin/env bash
# setup-host.sh — one-time OS prep for zdr-ops (Pi 4B, 1GB RAM): ops monitor + backups. Run as root.
#
# DOES (automatically): pre-flight checks, ops user, packages, mount the HDD partitions, ownership,
#   zram (only if not already active), SSH hardening (only if a key is installed), unattended-upgrades,
#   fail2ban, firewall.
# DOES NOT (do these yourself): partition the HDD (PI.md §7a — must be done BEFORE this script),
#   set the static IP (§5), install gatus (§9), set up restic backups + rclone (§10). Those stay manual
#   because they need your own secrets/config.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "Run as root:  sudo bash $0"; exit 1; }

echo "==> pre-flight: the HDD must already be partitioned + LABELED (PI.md §7a)"
if ! blkid -L zdrbackups >/dev/null 2>&1 || ! blkid -L zdrops >/dev/null 2>&1; then
  echo "ERROR: partitions labeled 'zdrbackups' and 'zdrops' not found."
  echo "       Partition + format + label the HDD first (PI.md §7a), then re-run this script."
  exit 1
fi

echo "==> ops user"
id zdrops >/dev/null 2>&1 || useradd -m -s /bin/bash zdrops

echo "==> packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nftables unattended-upgrades fail2ban restic rclone postgresql-client curl jq

echo "==> mounts"
mkdir -p /srv/backups /srv/ops
grep -q ' /srv/backups ' /etc/fstab || echo 'LABEL=zdrbackups /srv/backups ext4 defaults,noatime 0 2' >> /etc/fstab
grep -q ' /srv/ops '     /etc/fstab || echo 'LABEL=zdrops     /srv/ops     ext4 defaults,noatime 0 2' >> /etc/fstab
mount -a

echo "==> ownership"
chown root:zdrops /srv/backups && chmod 750 /srv/backups
install -o zdrops -g zdrops -m 750 -d /srv/backups/restic          # restic repo — zdrops must own it to write
mkdir -p /srv/ops/gatus /srv/ops/restic-stage /srv/ops/restic-cache
chown -R zdrops:zdrops /srv/ops/gatus /srv/ops/restic-stage /srv/ops/restic-cache

echo "==> zram swap"
if swapon --show 2>/dev/null | grep -q zram; then
  echo "    zram already active — skipping (do NOT stack zram-tools on an existing zram)."
else
  apt-get install -y zram-tools
  printf 'ALGO=zstd\nPERCENT=150\n' > /etc/default/zramswap
  systemctl restart zramswap 2>/dev/null || true
fi

echo "==> SSH hardening (keys only, no root)"
if [ -s /home/zdradmin/.ssh/authorized_keys ]; then
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
  systemctl restart ssh || systemctl restart sshd || true
  echo "    password auth disabled (key found). TEST a new ssh session before closing this one."
else
  echo "    SKIPPED — no /home/zdradmin/.ssh/authorized_keys. Add your key (ssh-copy-id) first,"
  echo "    then re-run, so you don't lock yourself out."
fi

echo "==> auto-updates + fail2ban"
systemctl enable --now unattended-upgrades fail2ban

echo "==> firewall"
install -m 0644 "$HERE/../firewall/nftables.conf" /etc/nftables.conf
systemctl enable --now nftables
nft -f /etc/nftables.conf

echo
echo "==> setup-host DONE. STILL MANUAL (need your config):"
echo "    - static IP ............ PI.md §5"
echo "    - gatus + gatus.env .... PI.md §9"
echo "    - restic + rclone ...... PI.md §10 (incl. a restore drill)"
