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
7. Discord operations reports and capacity alerts
8. GitHub and Vercel deployment notifications
9. Per-service Discord routing

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
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/backup/backup.sh > /srv/ops/backup.sh"
sudo chown zdrops:zdrops /srv/ops/backup.sh
sudo chmod 750 /srv/ops/backup.sh
sudo systemctl start config-backup.service
sudo -u zdrops bash -c 'source /srv/ops/backup.env && restic snapshots --tag pi-config'
sudo -u zdrops bash -c 'source /srv/ops/backup.env && restic dump latest /pi-config.tar --tag pi-config | tar -tf - | head'
sudo systemctl enable --now config-backup.timer
```

The snapshot contains a tar stream of `/etc/systemd/system`, nftables/SSH/Docker configuration, and
`/srv/ops`, including secrets, encrypted by restic. Cache, staging data, and Gatus SQLite history are
excluded. The updated `backup.sh` adds retention for `pi-config` and optionally backs up Umami later.
Keep a recovery copy of the restic password somewhere off the Pi.

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
sudo systemctl stop guardian.timer
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
new instance fails; the private monitor is never removed. After the public API is proven sanitized, run
`sudo systemctl start guardian.service && sudo systemctl start guardian.timer`. Keep the Guardian timer
stopped if validation fails so planned maintenance does not generate a misleading alert.

## 5. Independent off-site restic copy

Create a bucket/repository with a provider or account independent from the portal's Cloudflare account.
Because rclone saves through a temporary file beside its configuration, edit a protected staging copy in
a directory owned by `zdrops`, verify the remote, and only then install it as the production configuration:

```bash
sudo install -d -o zdrops -g zdrops -m 700 /srv/ops/rclone-edit
sudo install -o zdrops -g zdrops -m 600 /srv/ops/rclone.conf /srv/ops/rclone-edit/rclone.conf
sudo -u zdrops env RCLONE_CONFIG=/srv/ops/rclone-edit/rclone.conf rclone config
sudo -u zdrops env RCLONE_CONFIG=/srv/ops/rclone-edit/rclone.conf rclone lsd b2-zdr:
sudo cp -a /srv/ops/rclone.conf /srv/ops/rclone.conf.pre-b2
sudo install -o zdrops -g zdrops -m 600 /srv/ops/rclone-edit/rclone.conf /srv/ops/rclone.conf
sudo -u zdrops env RCLONE_CONFIG=/srv/ops/rclone.conf rclone lsd b2-zdr:
```

Install `offsite.env.example` in `/srv/ops/offsite.env`, fill the repository and a second restic password,
then initialize the destination with the local repository's chunk parameters:

```bash
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/backup/offsite.env.example > /srv/ops/offsite.env"
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

After the production remote and first off-site copy are proven healthy, remove only the two temporary
credential copies, capture the completed Pi configuration locally, and replicate that snapshot off-site:

```bash
sudo rm -f /srv/ops/rclone-edit/rclone.conf /srv/ops/rclone.conf.pre-b2
sudo rmdir /srv/ops/rclone-edit
sudo systemctl start config-backup.service
sudo systemctl start offsite-copy.service
```

The job runs 30 minutes after boot as a catch-up, then three days after each completed copy.
Retention runs on every copy; remote prune runs only on the first successful copy of each UTC month.
The service is capped at 400 MiB. Repeated runs skip snapshots that are already off-site.

## 6. Umami

Follow `pi/analytics/README.md`. Required manual resources are a dedicated external PostgreSQL database,
an `analytics` route on the existing Cloudflare tunnel, and two Vercel public environment variables. Do
not enable Umami until stages 1-5 pass. Docker must report memory-limit support before Umami is started;
the container's 320 MiB cap is a required safeguard on the 1 GB Pi.

## 7. Discord operations reports and capacity alerts

These are systemd one-shot jobs, not resident daemons. They use RAM only while running:

- daily at 06:30: check B2, Neon, Cloudflare R2, and Supabase database/file-storage/MAU capacity;
  alert only when the state crosses or recovers from a threshold;
- Sunday at 07:00: send an operations digest and a separate seven-day Umami portal report;
- first day of each month at 08:00: fully read-check the local restic repository, sample 10% of off-site
  data, preview retention, and report every automatically measurable free-tier capacity.

The defaults warn at 80% and become critical at 90%. The configured free-plan ceilings are B2 10 GB,
Neon 0.5 GB, Cloudflare R2 10 GB-month, Supabase database 500 MB, Supabase file storage 1 GB, and
Supabase MAU 50,000. Every line includes both usage and remaining capacity. Change the limits in
`reports.env` whenever a provider or account plan changes.

The Supabase database and file-storage figures are live values read from PostgreSQL. Its MAU value is a
conservative calendar-month estimate based on `auth.users.last_sign_in_at`; the Supabase organization
Usage page remains authoritative for billing-cycle MAU, egress, Edge Functions, and Realtime. R2 and B2
storage figures are live bucket sizes, while the providers bill averaged GB-month usage. This Pi deployment
does not hold billing-usage credentials for the remaining provider meters. The weekly Discord report therefore
names B2 egress/Class-D transactions, Neon compute/data transfer, R2 Class A/B operations, Supabase egress/
cached egress/Functions/Realtime, Vercel transfer/compute/functions/analytics, Resend, Sentry, GitHub Actions,
and Web3Forms as dashboard-only instead of presenting stale or invented numbers. Vercel's supported billing
API can also return unavailable for Hobby accounts.

Cloudflare Tunnel/DNS/Turnstile, Discord OAuth/webhooks, self-hosted Umami, and Google AdSense have no
comparable project free-tier consumption meter. The `ipwho.is` and `ipapi.co` geo fallbacks are anonymous and
only run when Vercel does not supply geolocation headers, so there is no account-level remaining counter to
query. External Google Classroom, WhatsApp, LinkedIn, GitHub, YouTube, and Vimeo links/embeds do not consume
a project-owned API quota. Keep every provider's native usage email alerts enabled.

The Umami report reads aggregate page-view counts through the existing protected Neon database connection;
it does not need an Umami username or password. While there is exactly one active Umami website, its UUID is
selected automatically. Set `UMAMI_WEBSITE_ID` in `reports.env` only if more websites are added later.

Upload `pi/reports` and install the protected configuration:

```bash
ls -l ~/pi/reports/ops-report.sh ~/pi/reports/reports.env.example ~/pi/reports/ops-report@.service ~/pi/reports/*.timer
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/reports/reports.env.example > /srv/ops/reports.env"
sudo chown root:root /srv/ops/reports.env
sudo chmod 600 /srv/ops/reports.env

sudo sh -c "tr -d '\r' < /home/zdradmin/pi/reports/ops-report.sh > /srv/ops/ops-report.sh"
sudo chown root:root /srv/ops/ops-report.sh
sudo chmod 750 /srv/ops/ops-report.sh
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/reports/ops-report@.service > /etc/systemd/system/ops-report@.service"
for name in ops-weekly-report ops-monthly-report ops-capacity-alert; do
  sudo sh -c "tr -d '\r' < /home/zdradmin/pi/reports/${name}.timer > /etc/systemd/system/${name}.timer"
done
sudo bash -n /srv/ops/ops-report.sh
sudo systemd-analyze verify /etc/systemd/system/ops-report@.service /etc/systemd/system/ops-*.timer
sudo systemctl daemon-reload
```

Test each mode before enabling the timers. The first capacity check intentionally sends nothing while all
measured providers are below the warning threshold; it records the healthy baseline in `/var/lib/zdr-reports`.
The service uses a five-minute-waiting `flock`, so the daily, weekly, and monthly instances cannot compete for
RAM, disk, or a restic repository lock if their schedules overlap.

```bash
sudo systemctl start ops-report@capacity.service
sudo systemctl start ops-report@weekly.service
sudo systemctl start ops-report@monthly.service
sudo systemctl show ops-report@capacity.service ops-report@weekly.service ops-report@monthly.service \
  -p Result -p ExecMainStatus
sudo journalctl -u 'ops-report@*' -n 80 --no-pager
sudo systemctl enable --now ops-weekly-report.timer ops-monthly-report.timer ops-capacity-alert.timer
systemctl list-timers 'ops-*' --all --no-pager
```

Install the notification and Guardian updates only while the one-shot backup jobs are idle:

```bash
systemctl is-active backup.service offsite-copy.service restore-drill.service
# Continue when each line says inactive.
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/backup/backup.sh > /srv/ops/backup.sh"
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/backup/offsite-copy.sh > /srv/ops/offsite-copy.sh"
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/backup/restore-drill.sh > /srv/ops/restore-drill.sh"
sudo chown zdrops:zdrops /srv/ops/backup.sh /srv/ops/offsite-copy.sh /srv/ops/restore-drill.sh
sudo chmod 750 /srv/ops/backup.sh /srv/ops/offsite-copy.sh /srv/ops/restore-drill.sh
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/guardian/guardian.sh > /srv/ops/guardian.sh"
sudo test -e /srv/ops/guardian.env || sudo install -o root -g root -m 0644 \
  /home/zdradmin/pi/guardian/guardian.env.example /srv/ops/guardian.env
sudo grep -q '^GUARDIAN_ANALYTICS_URL=' /srv/ops/guardian.env || \
  echo 'GUARDIAN_ANALYTICS_URL=https://analytics.zerodayreapers.me/api/heartbeat' | sudo tee -a /srv/ops/guardian.env
sudo chown root:root /srv/ops/guardian.sh /srv/ops/guardian.env
sudo chmod 750 /srv/ops/guardian.sh
sudo chmod 644 /srv/ops/guardian.env
for script in backup offsite-copy restore-drill guardian; do
  sudo bash -n "/srv/ops/${script}.sh" || exit 1
done
sudo systemctl start guardian.service
sudo journalctl -u guardian.service -n 30 --no-pager
```

The main daily backup, three-day off-site copy, and three-day restore drill now send `[START]`, `[OK]`, and
`[FAIL]` messages. Guardian also checks `https://analytics.zerodayreapers.me/api/heartbeat` and continues
to deduplicate repeated failures.

## 8. GitHub and Vercel deployment notifications

`.github/workflows/discord-deployment-notifications.yml` sends these from GitHub-hosted Actions, never the
Pi. Configure the repository Actions secrets `DISCORD_GITHUB_WEBHOOK` and `DISCORD_VERCEL_WEBHOOK`, then run the workflow once
with **Actions -> Discord deployment notifications -> Run workflow**. The workflow reports pushes to
`main` and all documented Vercel `repository_dispatch` lifecycle events (pending, ready, success, failed,
error, canceled, ignored, skipped, and promoted). It becomes operational only after the workflow file is
committed to the default branch. `DISCORD_DEPLOY_WEBHOOK` remains a temporary fallback during migration.

Keep the Vercel project connected to this GitHub repository. Current Vercel Git integrations send
`vercel.deployment.*` repository-dispatch events. No Cloudflare tunnel, Pi token, or Pi webhook endpoint
is involved.

## 9. Per-service Discord routing

Keep `zdr-ops` as a read-only historical archive. New messages are split under the private
`⚙️ ZDR OPERATIONS` category so a failing service does not bury unrelated alerts:

- health checks: `health-website`, `health-portal`, `health-login`, `health-app`, `health-supabase`,
  `health-r2`, and `health-heartbeat` for the Healthchecks.io cron dead-man switch;
- Pi jobs: `job-backup`, `job-config-backup`, `job-offsite-copy`, `job-restore-drill`, and `job-guardian`;
- reports: `report-capacity`, `report-weekly-ops`, `report-umami`, and `report-monthly`;
- external delivery: `deploy-github`, `deploy-vercel`, and `alerts-sentry`.

Create one incoming webhook in each channel. The protected routing map is streamed to
`pi/notifications/install-routing.sh`; the installer validates all 15 Pi routes, atomically installs
`/srv/ops/notifications.env` as `zdrops:zdrops` mode `0600`, and mirrors the six Gatus values into its
container environment. Root-run reports and Guardian can still read the file, while the `zdrops` backup
services need that ownership to read their own routes.

```bash
sudo bash /home/zdradmin/pi/notifications/install-routing.sh </path/to/protected/notifications.env
```

Each private Gatus endpoint uses its own `provider-override.webhook-url`; the global `DISCORD_WEBHOOK`
remains only a rollback fallback.
Install the updated scripts and private Gatus configuration while one-shot jobs are idle, then restart
Gatus and run `pi/verify.sh`. `pi/notifications/deploy-routing.sh` refuses to run while those jobs are
active, creates one-time `.pre-discord-routing` rollback copies, and automatically restores the previous
Gatus configuration if its post-restart API check fails. GitHub and Vercel use the two repository secrets
described in Step 8.

The Sentry Discord integration is moved to `alerts-sentry` when it is a guild webhook manageable by the
operations bot. If an organization-owned Sentry integration cannot be moved through Discord, change its
destination channel once in Sentry's integration settings. Do not delete the old `zdr-ops` channel or its
historical messages during the migration.

Official references: [Discord webhooks](https://docs.discord.com/developers/platform/webhooks),
[Umami automated reporting](https://docs.umami.is/docs/guides/automate-reporting-with-api),
[restic integrity checks](https://restic.readthedocs.io/en/stable/077_troubleshooting.html), and
[Vercel for GitHub repository-dispatch events](https://vercel.com/docs/git/vercel-for-github),
[Vercel Hobby limits](https://vercel.com/docs/plans/hobby),
[Supabase free-plan quotas](https://supabase.com/docs/guides/platform/billing-on-supabase),
[Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing),
[Neon pricing](https://neon.com/pricing), and
[Resend pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing).

## Final verification

Upload the updated `pi/verify.sh`, then:

```bash
sudo bash ~/pi/verify.sh
systemctl list-timers backup.timer restore-drill.timer config-backup.timer guardian.timer offsite-copy.timer \
  ops-weekly-report.timer ops-monthly-report.timer ops-capacity-alert.timer --no-pager
sudo docker stats --no-stream
free -h
```

Keep at least 200 MiB available during normal operation and preferably 250-300 MiB. If Umami causes
pressure or OOM events, disable it first; monitoring and backups have priority:

```bash
sudo systemctl disable --now umami
```
