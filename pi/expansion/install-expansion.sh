#!/usr/bin/env bash
# Installs monitoring expansion files but does not enable timers.
set -Eeuo pipefail

[[ "$(id -u)" -eq 0 ]] || { echo 'run as root' >&2; exit 1; }
STAGING_ROOT="${STAGING_ROOT:-/home/zdradmin/pi/expansion}"

for unit in backup.service config-backup.service offsite-copy.service restore-drill.service; do
  if systemctl is-active --quiet "$unit"; then
    echo "refusing install while $unit is active" >&2
    exit 1
  fi
done

install_text() {
  local source="$1" target="$2" mode="$3" tmp
  [[ -s "$source" ]] || { echo "missing staged file: $source" >&2; return 1; }
  tmp="$(mktemp "$(dirname "$target")/.$(basename "$target").XXXXXX")"
  tr -d '\r' <"$source" >"$tmp"
  chown root:root "$tmp"
  chmod "$mode" "$tmp"
  mv -f "$tmp" "$target"
}

# Backup and reporting services deliberately run as the unprivileged zdrops user.
# Keep secrets protected by their per-file modes while allowing that service group
# to traverse the operations directory.
install -d -o root -g zdrops -m 0750 /srv/ops
install -d -o root -g root -m 0700 /var/lib/zdr-discord-queue/pending /var/lib/zdr-discord-queue/bad
install -d -o root -g root -m 0700 /var/lib/aide-zdr /srv/ops/provider-exports

scripts=(
  discord-send.sh
  pi-performance-report.sh
  disk-health.sh
  security-report.sh
  gatus-slo-report.sh
  domain-monitor.sh
  config-integrity.sh
  saas-config-backup.sh
  login-readiness.sh
  tailscale-health.sh
  container-update-check.sh
)
for file in "${scripts[@]}"; do install_text "$STAGING_ROOT/$file" "/srv/ops/$file" 0750; done
install_text "$STAGING_ROOT/mail-monitor.py" /srv/ops/mail-monitor.py 0750
install_text "$STAGING_ROOT/aide-zdr-ops.conf" /etc/aide/zdr-ops.conf 0640

units=(
  discord-queue-flush.service discord-queue-flush.timer
  pi-performance-report@.service pi-performance-daily.timer pi-performance-weekly.timer
  disk-health@.service disk-health-daily.timer disk-health-short.timer disk-health-long.timer
  security-report.service security-report.timer
  gatus-slo-report.service gatus-slo-report.timer
  domain-monitor.service domain-monitor.timer
  config-integrity.service config-integrity.timer
  saas-config-backup.service saas-config-backup.timer
  login-readiness.service login-readiness.timer
  tailscale-health.service tailscale-health.timer
  container-update-check.service container-update-check.timer
  mail-monitor.service mail-monitor.timer
)
for file in "${units[@]}"; do install_text "$STAGING_ROOT/$file" "/etc/systemd/system/$file" 0644; done

if [[ ! -e /srv/ops/monitoring.env ]]; then
  install_text "$STAGING_ROOT/monitoring.env.example" /srv/ops/monitoring.env 0600
fi
if [[ ! -e /srv/ops/domain-monitor.env ]]; then
  install_text "$STAGING_ROOT/domain-monitor.env.example" /srv/ops/domain-monitor.env 0644
fi
if [[ ! -e /srv/ops/provider-export.env ]]; then
  install_text "$STAGING_ROOT/provider-export.env.example" /srv/ops/provider-export.env 0600
fi

if [[ ! -e /srv/ops/mail-monitor.env ]]; then
  install_text "$STAGING_ROOT/mail-monitor.env.example" /srv/ops/mail-monitor.env 0600
fi

if [[ -s /srv/ops/guardian.sh && ! -e /srv/ops/guardian.sh.pre-monitoring-expansion ]]; then
  cp -a /srv/ops/guardian.sh /srv/ops/guardian.sh.pre-monitoring-expansion
fi
install_text /home/zdradmin/pi/guardian/guardian.sh /srv/ops/guardian.sh 0750

for script in /srv/ops/*.sh; do bash -n "$script"; done
python3 -c 'compile(open("/srv/ops/mail-monitor.py", encoding="utf-8").read(), "/srv/ops/mail-monitor.py", "exec")'
systemctl daemon-reload
systemd-analyze verify "${units[@]/#//etc/systemd/system/}"

echo 'Monitoring expansion files installed. Timers remain disabled until routed webhooks and baselines pass.'
