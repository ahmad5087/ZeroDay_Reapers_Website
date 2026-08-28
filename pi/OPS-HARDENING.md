# zdr-ops hardening and analytics rollout

This guide deploys the optional post-build additions without interrupting the working portal. Upload files
with Termius SFTP; do not paste whole scripts into the SSH terminal. Complete and verify each stage before
starting the next one.

## Safety order

1. Docker log rotation
2. Encrypted Pi configuration backup
3. Guardian timer
4. Sanitized public Gatus
5. Independent off-site restic copy (requires a provider/account)
6. Umami (requires a dedicated external PostgreSQL database)

Keep the existing `/srv/ops/*.env` files. Never upload or commit filled secret files.

## 1. Docker log rotation

Upload the updated `pi` directory to `/home/zdradmin/pi`, then install the two units and recreate both
containers:

```bash
ls -l ~/pi/monitor/gatus.service ~/pi/tunnel/cloudflared.service   # stop if missing or zero bytes
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/monitor/gatus.service > /etc/systemd/system/gatus.service"
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/tunnel/cloudflared.service > /etc/systemd/system/cloudflared.service"
sudo systemd-analyze verify /etc/systemd/system/gatus.service /etc/systemd/system/cloudflared.service
sudo systemctl daemon-reload
sudo systemctl restart gatus cloudflared
sudo docker inspect -f '{{.Name}} {{.HostConfig.LogConfig.Type}} {{json .HostConfig.LogConfig.Config}}' gatus cloudflared
```

Both must report the `local` driver, `max-size=10m`, and `max-file=3`. Confirm the status page still returns
HTTP 200 before continuing. The cloudflared unit passes `TUNNEL_TOKEN` with Docker's `--env-file`; do not
change it back to a `--token ...` command-line argument, which exposes the credential in `systemctl status`.

## 2. Encrypted configuration backup

Upload the current `pi/backup` directory under `/home/zdradmin/pi/backup`, then install the configuration
backup files. The initial `ls` is a mandatory guard: stop if any source is missing or zero bytes.

```bash
ls -l ~/pi/backup/config-backup.sh ~/pi/backup/config-backup.service ~/pi/backup/config-backup.timer ~/pi/backup/backup.sh
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/backup/config-backup.sh > /srv/ops/config-backup.sh"
sudo chown root:root /srv/ops/config-backup.sh
sudo chmod 750 /srv/ops/config-backup.sh
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/backup/config-backup.service > /etc/systemd/system/config-backup.service"
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/backup/config-backup.timer > /etc/systemd/system/config-backup.timer"
sudo systemd-analyze verify /etc/systemd/system/config-backup.service /etc/systemd/system/config-backup.timer
sudo systemctl daemon-reload
sudo systemctl start config-backup.service
sudo -u zdrops bash -c 'source /srv/ops/backup.env && restic snapshots --tag pi-config'
sudo -u zdrops bash -c 'source /srv/ops/backup.env && restic dump latest /pi-config.tar --tag pi-config | tar -tf - | head'
sudo systemctl enable --now config-backup.timer
```

The snapshot contains a tar stream of `/etc/systemd/system`, nftables/SSH/Docker configuration, and
`/srv/ops`, including secrets, encrypted by restic. Cache, staging data, and Gatus SQLite history are
excluded. Keep a recovery copy of the restic password somewhere off the Pi.

Install the updated `backup.sh` in `/srv/ops`; it adds retention for `pi-config` and optionally backs up
Umami later:

```bash
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/backup/backup.sh > /srv/ops/backup.sh"
sudo chown zdrops:zdrops /srv/ops/backup.sh
sudo chmod 750 /srv/ops/backup.sh
```

## 3. Guardian timer

Install SMART support first:

```bash
sudo apt update
sudo apt install -y smartmontools
sudo smartctl -H -d auto /dev/sda
```

If the USB enclosure requires SAT passthrough, test `sudo smartctl -H -d sat /dev/sda` and put
`GUARDIAN_SMART_TYPE=sat` in `/srv/ops/guardian.env`. If the enclosure cannot pass SMART at all, set
`GUARDIAN_SMART_REQUIRED=false` and rely on mount/disk/backup checks.

Upload the current `pi/guardian` directory, then install its files:

```bash
ls -l ~/pi/guardian/guardian.sh ~/pi/guardian/guardian.service ~/pi/guardian/guardian.timer ~/pi/guardian/guardian.env.example
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/guardian/guardian.sh > /srv/ops/guardian.sh"
sudo chown root:root /srv/ops/guardian.sh
sudo chmod 750 /srv/ops/guardian.sh
sudo cp ~/pi/guardian/guardian.env.example /srv/ops/guardian.env
sudo chmod 644 /srv/ops/guardian.env
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/guardian/guardian.service > /etc/systemd/system/guardian.service"
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/guardian/guardian.timer > /etc/systemd/system/guardian.timer"
sudo systemd-analyze verify /etc/systemd/system/guardian.service /etc/systemd/system/guardian.timer
sudo systemctl daemon-reload
sudo systemctl start guardian.service
sudo journalctl -u guardian.service -n 40 --no-pager
sudo systemctl enable --now guardian.timer
```

The guardian checks services, timers, both mounts, disk usage, available RAM, current Pi throttle flags,
HDD SMART health, all private Gatus checks, public HTTPS, and backup age. It sends Discord only for a new
failure set, not for every successful run.

## 4. Split private and public Gatus

The existing Gatus remains private on port 8080 with all six checks and alerts. The new instance exposes
only website, portal, login-page, and coarse app-health on loopback port 8081.

Upload the current `pi/monitor` directory, then install the public Gatus files:

```bash
ls -l ~/pi/monitor/gatus-public.yaml ~/pi/monitor/gatus-public.env.example ~/pi/monitor/gatus-public.service
sudo install -o zdrops -g zdrops -d /srv/ops/gatus-public
sudo install -o zdrops -g zdrops -m 0644 ~/pi/monitor/gatus-public.yaml /srv/ops/gatus-public/gatus.yaml
sudo install -o zdrops -g zdrops -m 0600 ~/pi/monitor/gatus-public.env.example /srv/ops/gatus-public/gatus-public.env
sudo nano /srv/ops/gatus-public/gatus-public.env
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/monitor/gatus-public.service > /etc/systemd/system/gatus-public.service"
sudo systemd-analyze verify /etc/systemd/system/gatus-public.service
sudo systemctl daemon-reload
sudo systemctl enable --now gatus-public
curl -fsS http://127.0.0.1:8081/api/v1/endpoints/statuses | jq -r '.[].name'
curl -fsS http://127.0.0.1:8081/api/v1/endpoints/statuses | grep -E 'supabase\.co|r2\.cloudflarestorage\.com' && echo 'STOP: hostname leak' || echo 'sanitized API OK'
```

Only after the local test passes, edit the existing Cloudflare published application route:

```text
status.zerodayreapers.me -> HTTP -> localhost:8081
```

Verify the public page and `/api/v1/endpoints/statuses`. Roll back the route to `localhost:8080` if the
new instance fails; the private monitor is never removed.

## 5. Independent off-site restic copy

Create a bucket/repository with a provider or account independent from the portal's Cloudflare account.
Add it as a new remote in the existing `/srv/ops/rclone.conf`:

```bash
sudo -u zdrops env RCLONE_CONFIG=/srv/ops/rclone.conf rclone config
```

Install `offsite.env.example` in `/srv/ops/offsite.env`, fill the repository and a second restic password,
then initialize the destination with the local repository's chunk parameters:

```bash
sudo cp ~/pi/backup/offsite.env.example /srv/ops/offsite.env
sudo nano /srv/ops/offsite.env
sudo chown zdrops:zdrops /srv/ops/offsite.env
sudo chmod 600 /srv/ops/offsite.env
sudo -u zdrops bash -c '
  source /srv/ops/backup.env
  source /srv/ops/offsite.env
  export RESTIC_FROM_REPOSITORY="$RESTIC_REPOSITORY"
  export RESTIC_FROM_PASSWORD="$RESTIC_PASSWORD"
  export RESTIC_REPOSITORY="$RESTIC_OFFSITE_REPOSITORY"
  export RESTIC_PASSWORD="$RESTIC_OFFSITE_PASSWORD"
  restic init --from-repo "$RESTIC_FROM_REPOSITORY" --copy-chunker-params
'
```

Upload the current `pi/backup` directory and install `offsite-copy.sh`, `.service`, and `.timer`:

```bash
ls -l ~/pi/backup/offsite-copy.sh ~/pi/backup/offsite-copy.service ~/pi/backup/offsite-copy.timer
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/backup/offsite-copy.sh > /srv/ops/offsite-copy.sh"
sudo chown zdrops:zdrops /srv/ops/offsite-copy.sh
sudo chmod 750 /srv/ops/offsite-copy.sh
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/backup/offsite-copy.service > /etc/systemd/system/offsite-copy.service"
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/backup/offsite-copy.timer > /etc/systemd/system/offsite-copy.timer"
sudo systemd-analyze verify /etc/systemd/system/offsite-copy.service /etc/systemd/system/offsite-copy.timer
sudo systemctl daemon-reload
sudo systemctl start offsite-copy.service
sudo journalctl -u offsite-copy.service -n 50 --no-pager
sudo systemctl enable --now offsite-copy.timer
```

The job runs weekly. Retention runs each week; remote prune runs only on the first weekly run of a month.
The service is capped at 400 MiB and scheduled away from the daily backup window.

## 6. Umami

Follow `pi/analytics/README.md`. Required manual resources are a dedicated external PostgreSQL database,
an `analytics` route on the existing Cloudflare tunnel, and two Vercel public environment variables. Do
not enable Umami until stages 1-5 pass.

## Final verification

Upload the updated `pi/verify.sh`, then:

```bash
sudo bash ~/pi/verify.sh
systemctl list-timers backup.timer restore-drill.timer config-backup.timer guardian.timer offsite-copy.timer --no-pager
sudo docker stats --no-stream
free -h
```

Keep at least 200 MiB available during normal operation and preferably 250-300 MiB. If Umami causes
pressure or OOM events, disable it first; monitoring and backups have priority:

```bash
sudo systemctl disable --now umami
```
