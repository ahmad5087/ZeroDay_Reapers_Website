# zdr-ops monitoring expansion: manual deployment runbook

This runbook extends the completed `OPS-HARDENING.md` deployment with thirteen lightweight operational
capabilities. It is written for the current Raspberry Pi host (`zdr-ops`, Debian 13) and the existing
`/srv/ops` layout. Nothing in this document should be exposed on the public status page.

The UPS/NUT proposal is intentionally excluded.

## Deployment status (2026-08-31)

The monitoring deployment and the three external integrations are enabled. The Discord operations bot
created one private channel and one webhook for each new route. `/srv/ops/monitoring.env` contains 12
validated routes as `root:root` mode `0600`, and the durable notification queue is active. The repository's
`pi/verify.sh` completed with 71 passes, zero warnings, and zero failures after deployment.

| Capability | Live state | Evidence or remaining gate |
|---|---|---|
| Guardian failure/recovery | enabled and healthy | Real restic-access failure and recovery completed; state is `ok` |
| Pi performance/bandwidth | enabled | Daily and weekly timers active; `sysstat` and `vnstat` installed |
| Disk health | enabled | Daily, short, and long SMART/filesystem timers active |
| Security posture | enabled | Baseline report succeeded; Exim is disabled and masked |
| Gatus SLO report | enabled | Report test succeeded against private Gatus v5.36 API |
| Domain/DNS/mail posture | enabled and healthy | Apex Namecheap SPF and delegated Resend SPF are present; the reviewed DNS baseline passes |
| Durable Discord delivery | enabled | All 12 routes passed; pending and bad queues are empty |
| Configuration integrity | enabled | Scoped AIDE baseline contains 205 reviewed entries and the clean check passes |
| SaaS configuration exports | enabled and healthy | Read-only Cloudflare/Vercel export and encrypted `pi-config` snapshot succeeded |
| Login-readiness canary | enabled | Portal, app health, database-backed health path, and Turnstile readiness passed |
| Tailscale health | enabled; observation ongoing | `zdr-ops` is enrolled, SSH is restricted to approved devices, and the 10-minute health timer passes |
| Container update notice | enabled | Baseline succeeded; it never pulls or restarts a container |
| Incoming email headers | enabled and healthy | Namecheap IMAP authentication and normal two-minute timer cycles succeed; subjects remain disabled |

The original `OPS-HARDENING.md` Step 7 jobs are also live: capacity, weekly, and monthly report timers are
enabled. The latest capacity run reported B2 3%, Neon 1%, R2 4%, Supabase database 4%, Supabase storage
1%, and Supabase MAU 0%. Step 8 is live on GitHub's `main` branch with both
`DISCORD_GITHUB_WEBHOOK` and `DISCORD_VERCEL_WEBHOOK`; recent push and Vercel repository-dispatch runs
completed successfully.

## External credential and approval record

The three integrations below require external access. Their credentials are configured only in protected
files on the Pi; no credential value is stored in this repository. Do not put any of these values in Git,
this Markdown file, a Discord message, or an SSH command line. Open each protected file using `sudoedit`,
save it, then enforce its owner and mode.

### A. Cloudflare and Vercel read-only configuration export

Required Cloudflare values:

- `CLOUDFLARE_API_TOKEN`: a dedicated token restricted to `zerodayreapers.me`, with Zone DNS Read and
  account Cloudflare Tunnel Read permissions; never use the Global API Key;
- `CLOUDFLARE_ZONE_ID`: the zone ID for `zerodayreapers.me`;
- `CLOUDFLARE_ACCOUNT_ID`: the account that owns the zone and tunnel;
- `CLOUDFLARE_TUNNEL_ID`: the UUID of the production Cloudflare Tunnel.

Required Vercel values:

- `VERCEL_API_TOKEN`: a dedicated token with only the minimum account/team access available;
- `VERCEL_PROJECT_ID`: the production ZeroDay Reapers project ID;
- `VERCEL_TEAM_ID`: the owning team ID. For a personal project, confirm the API scope and use the owning
  account/team identifier expected by Vercel rather than guessing.

Place all seven values only in `/srv/ops/provider-export.env`:

```bash
sudoedit /srv/ops/provider-export.env
sudo chown root:root /srv/ops/provider-export.env
sudo chmod 600 /srv/ops/provider-export.env
sudo awk -F= '/^[A-Z][A-Z0-9_]*=/ {print $1}' /srv/ops/provider-export.env
```

The last command prints names only and must list the seven variables above. It must not print values. After
the credentials exist, perform one test before enabling the schedule:

```bash
sudo systemctl start saas-config-backup.service
systemctl show saas-config-backup.service -p Result -p ExecMainStatus
sudo journalctl -u saas-config-backup.service -n 60 --no-pager
sudo systemctl enable --now saas-config-backup.timer
```

The export strips Vercel environment values and redacts secret-like Cloudflare fields. It has read access
only and never changes DNS, tunnel configuration, or Vercel settings.

### B. Incoming Namecheap mailbox notifications

Required values:

- `MAIL_USERNAME`: currently `contact@zerodayreapers.me`;
- `MAIL_PASSWORD`: the credential for that exact Namecheap Private Email mailbox, preferably an application
  password if the account supports one. Do not use the Resend SMTP API key or SMTP credential;
- `MAIL_IMAP_HOST=mail.privateemail.com` and `MAIL_IMAP_PORT=993` with TLS.

Place them only in `/srv/ops/mail-monitor.env`:

```bash
sudoedit /srv/ops/mail-monitor.env
sudo chown root:root /srv/ops/mail-monitor.env
sudo chmod 600 /srv/ops/mail-monitor.env
sudo awk -F= '/^MAIL_[A-Z0-9_]*=/ {print $1}' /srv/ops/mail-monitor.env
```

Keep `MAIL_INCLUDE_SUBJECT=false` unless posting subjects to the private Discord channel has been explicitly
approved. The monitor never retrieves bodies or attachments and opens the mailbox read-only. Its first
successful run creates a baseline without replaying old messages:

```bash
sudo systemctl start mail-monitor.service
systemctl show mail-monitor.service -p Result -p ExecMainStatus
sudo journalctl -u mail-monitor.service -n 40 --no-pager
sudo systemctl enable --now mail-monitor.timer
```

Send one harmless email from another address and confirm that only sender name, sender address, message date,
and Pi detection time appear in `alerts-email-inbox`, while the source email remains unread.

### C. Tailscale account enrollment

Tailscale does not require a token in a Pi environment file for the normal interactive enrollment used here.
It requires installing Tailscale, running `sudo tailscale up --hostname=zdr-ops`, and approving the device in
the intended tailnet account. Require account MFA and restrict access to the operator identity/device before
enabling the monitor. An optional expected identity may be placed in `/srv/ops/tailscale-health.env`:

```bash
TAILSCALE_EXPECTED_DNS_NAME='zdr-ops.REPLACE_WITH_TAILNET.ts.net'
```

After enrollment and policy verification:

```bash
sudo systemctl start tailscale-health.service
systemctl show tailscale-health.service -p Result -p ExecMainStatus
sudo systemctl enable --now tailscale-health.timer
```

Keep LAN SSH and the existing SSH key until Tailscale access has been tested from a second session.

### D. DNS action completed without a Pi credential

The authoritative DNS now publishes the exact Namecheap Private Email SPF record at the apex while Resend
uses its separate `send.zerodayreapers.me` SPF record. The propagated result was verified through multiple
resolvers, the one-line DNS baseline change was approved, and `domain-monitor.service` passes. Do not create
another SPF record at either hostname.

No additional Discord credential is required: all 12 Pi webhooks are already stored in
`/srv/ops/monitoring.env` as `root:root` mode `0600`. No additional GitHub credential is required either:
the Step 8 Actions secrets are already configured in GitHub.

For disaster recovery or a fresh installation, use the staged rollout below. Complete one numbered section,
test it, and observe the Pi for at least one normal timer cycle before continuing. Do not enable all jobs at
once.

## 1. Safety and resource limits

The Pi has about 905 MiB total RAM and recently had about 400 MiB available. Preserve monitoring and
backup reliability with these limits:

- keep at least 200 MiB `MemAvailable`; 250-300 MiB is the preferred normal reserve;
- use systemd one-shot services and timers wherever possible;
- never install a local Grafana, Prometheus, Loki, Uptime Kuma, Wazuh, Portainer, or CI runner;
- never let a monitoring job overlap a restic integrity check or restore drill;
- never place a real webhook, API token, mailbox password, or synthetic-user password in this repository;
- use `Nice=15`, `IOSchedulingClass=idle`, and a memory limit on every new one-shot service;
- use notification-only container update checks; never automatically upgrade production containers;
- keep `zdr-ops` as a read-only historical archive.

Before every stage:

```bash
free -h
sudo docker stats --no-stream
systemctl --failed --no-pager
systemctl is-active backup.service offsite-copy.service restore-drill.service
```

Continue only when the three one-shot backup services are `inactive`, no unexpected unit is failed, and
normal available RAM is above 250 MiB.

Create rollback copies before replacing any existing file:

```bash
sudo cp -a /srv/ops/FILE /srv/ops/FILE.pre-monitoring-expansion
sudo cp -a /etc/systemd/system/UNIT /etc/systemd/system/UNIT.pre-monitoring-expansion
```

Do not paste long scripts into an SSH prompt. Create them on the workstation, upload them beneath
`/home/zdradmin/pi`, inspect them with `ls -l`, remove Windows carriage returns with `tr -d '\r'`, then
install them under `/srv/ops`.

## 2. Discord channel plan

Create every channel under the existing private `ZDR OPERATIONS` category. Deny `View Channel` to
`@everyone`; allow only the Founder/operator role and the relevant bot/integration. Create exactly one
incoming webhook per channel.

One monitoring responsibility gets one channel. Failure and recovery for the same responsibility stay in
the same channel so the incident has a readable lifecycle.

| # | Capability | Discord channel | Webhook variable | Schedule | New resident service |
|---:|---|---|---|---|---|
| 1 | Guardian failure and recovery | existing `job-guardian` | existing `DISCORD_GUARDIAN_WEBHOOK` | every 15 min | no |
| 2 | Pi performance and bandwidth | `report-pi-performance` | `DISCORD_PI_PERFORMANCE_WEBHOOK` | daily + weekly | `vnstat` only |
| 3 | SMART and kernel disk health | `job-disk-health` | `DISCORD_DISK_HEALTH_WEBHOOK` | daily/weekly/monthly | no |
| 4 | OS security and update posture | `report-security` | `DISCORD_SECURITY_REPORT_WEBHOOK` | Monday 07:15 PKT | no |
| 5 | Gatus uptime/SLO report | `report-slo` | `DISCORD_SLO_REPORT_WEBHOOK` | Sunday 07:30 PKT | no |
| 6 | Domain, DNS and mail posture | `alerts-domain-dns-mail` | `DISCORD_DOMAIN_MONITOR_WEBHOOK` | daily | no |
| 7 | Durable Discord delivery queue | `job-alert-delivery` | `DISCORD_ALERT_DELIVERY_WEBHOOK` | retry every 2 min | no |
| 8 | Configuration integrity | `alerts-config-integrity` | `DISCORD_CONFIG_INTEGRITY_WEBHOOK` | daily | no |
| 9 | SaaS configuration exports | `job-saas-config-backup` | `DISCORD_SAAS_CONFIG_BACKUP_WEBHOOK` | Sunday 08:15 PKT | no |
| 10 | Portal login-readiness canary | `health-synthetic-login` | `DISCORD_SYNTHETIC_LOGIN_WEBHOOK` | every 5 min | no |
| 11 | Tailscale health | `alerts-tailscale` | `DISCORD_TAILSCALE_WEBHOOK` | every 10 min | yes, optional |
| 12 | Container update availability | `alerts-container-updates` | `DISCORD_CONTAINER_UPDATES_WEBHOOK` | Wednesday 08:00 PKT | no |
| 13 | New incoming email headers | `alerts-email-inbox` | `DISCORD_EMAIL_INBOX_WEBHOOK` | every 1-2 min | no |

For each new channel:

1. Open **Edit Channel -> Integrations -> Webhooks -> New Webhook**.
2. Name the webhook after the route, for example `zdr-route-report-slo`.
3. Select the matching channel and copy the webhook URL.
4. Store the URL only in the protected environment file described below.
5. Send a test and confirm it appears in only that channel.

Channel IDs are not webhook URLs. A channel ID is used by integrations such as Sentry; the Pi jobs use
incoming webhook URLs.

## 3. Protected configuration for the new routes

Keep the existing `/srv/ops/notifications.env` unchanged. Create a second file so the proven 15-route
installer remains a stable rollback boundary:

```bash
sudo install -o root -g root -m 0600 /dev/null /srv/ops/monitoring.env
sudo nano /srv/ops/monitoring.env
```

Add the following, replacing every `CHANGE_ME` value inside the editor:

```bash
export DISCORD_PI_PERFORMANCE_WEBHOOK='CHANGE_ME'
export DISCORD_DISK_HEALTH_WEBHOOK='CHANGE_ME'
export DISCORD_SECURITY_REPORT_WEBHOOK='CHANGE_ME'
export DISCORD_SLO_REPORT_WEBHOOK='CHANGE_ME'
export DISCORD_DOMAIN_MONITOR_WEBHOOK='CHANGE_ME'
export DISCORD_ALERT_DELIVERY_WEBHOOK='CHANGE_ME'
export DISCORD_CONFIG_INTEGRITY_WEBHOOK='CHANGE_ME'
export DISCORD_SAAS_CONFIG_BACKUP_WEBHOOK='CHANGE_ME'
export DISCORD_SYNTHETIC_LOGIN_WEBHOOK='CHANGE_ME'
export DISCORD_TAILSCALE_WEBHOOK='CHANGE_ME'
export DISCORD_CONTAINER_UPDATES_WEBHOOK='CHANGE_ME'
export DISCORD_EMAIL_INBOX_WEBHOOK='CHANGE_ME'
```

Validate without printing any secret:

```bash
sudo bash -n /srv/ops/monitoring.env
sudo awk -F= '/^export DISCORD_/ {count++; if ($2 ~ /CHANGE_ME|^..$/) bad++} END {print "routes=" count, "placeholders=" bad+0}' /srv/ops/monitoring.env
sudo stat -c '%U:%G %a %n' /srv/ops/monitoring.env
```

Expected: `routes=12 placeholders=0` and `root:root 600`.

Every notification payload must use this Discord JSON shape to prevent hostile sender names, DNS values,
or log lines from pinging server members:

```bash
payload="$(jq -n --arg content "$message" '{content: $content, allowed_mentions: {parse: []}}')"
```

Never print or pass a webhook in a command-line argument. Source the protected environment file inside the
script and pass the URL directly to `curl`.

## 4. Common systemd standard

Use the following controls on each new one-shot service, adjusting `ExecStart` and writable state paths:

```ini
[Service]
Type=oneshot
User=root
Group=root
EnvironmentFile=/srv/ops/monitoring.env
ExecStart=/srv/ops/REPLACE-ME.sh
Nice=15
IOSchedulingClass=idle
MemoryHigh=96M
MemoryMax=160M
NoNewPrivileges=true
ProtectHome=true
ProtectSystem=strict
PrivateTmp=true
```

If a job writes state, add a unique `StateDirectory=` and only the required `ReadWritePaths=`. Do not give
all monitors write access to all of `/srv/ops`.

Use these timer defaults unless a section specifies otherwise:

```ini
[Timer]
OnCalendar=REPLACE-ME
Persistent=true
RandomizedDelaySec=5m

[Install]
WantedBy=timers.target
```

`Persistent=true` lets a missed job run after the Pi returns online. Random delay prevents several jobs
from competing for RAM, disk, DNS, or network at exactly the same second.

For every script and unit:

```bash
sudo bash -n /srv/ops/NAME.sh
sudo systemd-analyze verify /etc/systemd/system/NAME.service /etc/systemd/system/NAME.timer
sudo systemctl daemon-reload
sudo systemctl start NAME.service
sudo systemctl show NAME.service -p Result -p ExecMainStatus
sudo journalctl -u NAME.service -n 80 --no-pager
sudo systemctl enable --now NAME.timer
```

Do not enable the timer until the manual service run succeeds and its test message reaches only the mapped
Discord channel.

## 5. Point 1 - Guardian recovery notifications

### Goal

The Guardian already deduplicates identical failures in `job-guardian`. Extend it so a transition from a
failed state to `ok` sends one `[RESOLVED]` message. Do not create a second channel: failure and recovery
belong to the same Guardian incident.

### Required behavior

Change only the final state-handling block of `/srv/ops/guardian.sh`:

1. Read the previous value of `/var/lib/zdr-guardian/last-state`.
2. If the current run has no failures and the previous value begins with `fail:`, send:

   ```text
   [RESOLVED] zdr-ops guardian recovered 2026-08-30T12:34:56Z
   All Guardian checks are healthy.
   ```

3. Write `ok` only after the recovery notification succeeds. If Discord is unavailable, retain the failed
   state so the next successful Guardian run retries the recovery message.
4. If the previous value is already `ok`, send nothing.
5. Continue hashing and deduplicating failure sets exactly as the current script does.
6. Build the payload with `allowed_mentions.parse=[]`.

### Test

Use a reversible, harmless failure such as a temporary test override rather than stopping Docker. A safe
method is to copy `guardian.env`, temporarily set `GUARDIAN_MEMORY_MIN_MIB` above total RAM, run Guardian,
restore the original value, and run Guardian again:

```bash
sudo cp -a /srv/ops/guardian.env /srv/ops/guardian.env.recovery-test
sudo nano /srv/ops/guardian.env
sudo systemctl start guardian.service
sudo journalctl -u guardian.service -n 30 --no-pager
sudo mv /srv/ops/guardian.env.recovery-test /srv/ops/guardian.env
sudo systemctl start guardian.service
sudo journalctl -u guardian.service -n 30 --no-pager
```

Expected: one `[FAIL]`, then one `[RESOLVED]`, both in `job-guardian`. Run it once more; the third run must
send nothing.

## 6. Point 2 - Pi performance and bandwidth history

### Goal

Keep enough history to answer, “Was the Pi under CPU, memory, swap, disk-I/O, thermal, or network pressure
when the portal was slow?” Post a concise report to `report-pi-performance`.

### Install collectors

`sysstat` stores CPU, load, RAM, swap, disk, network, and pressure history. `vnstat` stores interface byte
counters without packet capture.

```bash
sudo apt update
sudo apt install -y sysstat vnstat
sudo dpkg-reconfigure sysstat
sudo systemctl enable --now sysstat vnstat
systemctl status sysstat vnstat --no-pager
sar -u 1 3
vnstat --iflist
vnstat -i eth0
```

Select **Yes** when `dpkg-reconfigure sysstat` asks whether collection should be enabled. The active network
interface on the current Pi is `eth0`; `wlan0` is down. Verify this again before hard-coding it.

Keep 14 days of sysstat history. On Debian, inspect `/etc/sysstat/sysstat`, set `HISTORY=14`, and restart
the collector. Do not sample more frequently than the distribution default unless diagnosing a specific
incident.

### Report design

Create `/srv/ops/pi-performance-report.sh`. It should source `/srv/ops/monitoring.env` and report:

- uptime and 1/5/15-minute load;
- current `MemAvailable` and swap used;
- CPU idle average and load average from `sar`;
- disk utilization/await from `iostat -xz`;
- current Pi temperature and `vcgencmd get_throttled`;
- `eth0` received, sent, and total traffic from `vnstat`;
- the five highest-RSS processes from `ps`;
- current per-container RAM from `docker stats --no-stream`;
- timestamp in UTC and `Asia/Karachi`.

Keep the Discord message below 1,800 characters. Put detailed raw data in the journal, not Discord.

Create two instances or modes:

- `pi-performance-report@daily.service`: current summary, daily at `06:45 Asia/Karachi`;
- `pi-performance-report@weekly.service`: seven-day `sar`/`vnstat` summary, Sunday at `07:15`.

Suggested timers:

```ini
OnCalendar=*-*-* 06:45:00 Asia/Karachi
```

```ini
OnCalendar=Sun *-*-* 07:15:00 Asia/Karachi
```

Do not alert merely because Linux's `free` column is small. Alert only when `MemAvailable` is below
200 MiB, swap grows rapidly, the current throttle low nibble is non-zero, or disk utilization remains high.

### Manual incident commands

```bash
sar -u
sar -q
sar -r
sar -S
sar -d
pidstat -r -u -d 1 5
iostat -xz 1 5
vnstat -i eth0 -d 7
```

## 7. Point 3 - SMART tests and kernel storage errors

### Goal

Send HDD health, temperature, self-test results, USB resets, filesystem errors, I/O errors, and unexpected
read-only remounts to `job-disk-health`.

The existing Guardian already checks the current SMART health result for `/dev/sda`. This point adds test
scheduling and historical error inspection; do not duplicate Guardian’s 15-minute health message.

### Confirm the device and transport

```bash
lsblk -o NAME,MODEL,SERIAL,SIZE,FSTYPE,MOUNTPOINTS
sudo smartctl -H -d auto /dev/sda
sudo smartctl -c -d auto /dev/sda
```

If the enclosure needs SAT passthrough, use `-d sat` consistently and keep
`GUARDIAN_SMART_TYPE=sat`. If SMART is not passed through by the enclosure, do not schedule tests that the
device cannot execute.

### Jobs

Create `/srv/ops/disk-health.sh` with modes `daily`, `short`, and `long`:

- `daily`: run `smartctl -H -A -l error -l selftest`; scan the previous 24 hours of the kernel journal for
  `I/O error`, `Buffer I/O`, `EXT4-fs error`, `read-only`, `reset SuperSpeed USB device`, `uas_eh_abort`,
  `blk_update_request`, and `oom-kill`;
- `short`: start `smartctl -t short`, then report the command’s stated completion time;
- `long`: start `smartctl -t long`, then report the command’s stated completion time;
- the next daily run reports the most recent completed self-test result;
- report a weekly healthy summary, but deduplicate repeated failure text in a state file.

Use `/var/lib/zdr-disk-health` for state. Suggested schedules:

```ini
# Daily health/error scan
OnCalendar=*-*-* 05:50:00 Asia/Karachi

# Weekly short test
OnCalendar=Sat *-*-* 03:00:00 Asia/Karachi

# Monthly extended test
OnCalendar=*-*-01 02:00:00 Asia/Karachi
```

Do not run an extended SMART test during backup, off-site copy, restore drill, or monthly restic integrity
check. The script must exit with a clear `[SKIP]` journal entry when one of those services is active.

### Test and rollback

Run the daily mode first. Do not use `smartctl -X` unless you deliberately need to abort a test.

```bash
sudo /srv/ops/disk-health.sh daily
sudo smartctl -l selftest -d auto /dev/sda
sudo journalctl -k --since '24 hours ago' --no-pager
```

Disable all three disk timers before changing the device path or SMART transport type.

## 8. Point 4 - Security and OS update digest

### Goal

Post a weekly, non-secret security summary to `report-security`. Immediate service outages remain Guardian’s
job.

Create `/srv/ops/security-report.sh` and include:

- count and package names from `apt list --upgradable`;
- whether `/run/reboot-required` exists and, if present, its package list;
- last result of `unattended-upgrades.service`;
- `systemctl --failed` units;
- Fail2ban jail names and current/total ban counts;
- failed SSH authentication count for the last seven days, without posting attempted usernames or IPs;
- nftables service state and ruleset validation result;
- last boot time and unexpected reboot evidence;
- kernel security messages, OOM kills, and current Pi throttle state;
- permissions for `/srv/ops/*.env`, reporting only filename/owner/mode and never contents.

Schedule Monday at 07:15 PKT:

```ini
OnCalendar=Mon *-*-* 07:15:00 Asia/Karachi
Persistent=true
RandomizedDelaySec=10m
```

The job is report-only. Never run `apt upgrade`, reboot, unban an IP, rewrite nftables, or change SSH from
inside this script.

Test:

```bash
sudo /srv/ops/security-report.sh
sudo journalctl -u security-report.service -n 80 --no-pager
sudo fail2ban-client status
sudo nft --check list ruleset
```

## 9. Point 5 - Seven-day and thirty-day Gatus SLO report

### Goal

Reuse the existing private Gatus instance and send uptime and response-time statistics to `report-slo`.
No SQLite client, Prometheus, or new dashboard is required.

The current endpoint keys are expected to be:

```text
public_website
public_portal
public_login-page
backend_app-health
backend_supabase
backend_r2-endpoint
```

Confirm them instead of assuming:

```bash
curl -fsS http://127.0.0.1:8080/api/v1/endpoints/statuses | jq -r '.[].key'
```

For every key, Gatus exposes:

```text
/api/v1/endpoints/{key}/uptimes/7d
/api/v1/endpoints/{key}/uptimes/30d
/api/v1/endpoints/{key}/response-times/7d
/api/v1/endpoints/{key}/response-times/30d
```

Create `/srv/ops/gatus-slo-report.sh`. It should discover keys from `/statuses`, fetch both periods, and
report:

- 7-day and 30-day uptime percentage;
- average and maximum response time for each period;
- count of currently unhealthy endpoints;
- the report timestamp;
- `[WARN]` when any seven-day uptime is below the chosen objective, initially 99.0%;
- `[FAIL]` if the private Gatus API or any statistics endpoint is unreadable.

Response-time values may be nanoseconds in the API. Inspect a live response and convert to milliseconds only
after confirming its JSON fields:

```bash
curl -fsS http://127.0.0.1:8080/api/v1/endpoints/public_portal/response-times/7d | jq .
curl -fsS http://127.0.0.1:8080/api/v1/endpoints/public_portal/uptimes/7d | jq .
```

Schedule Sunday at 07:30 PKT, after the weekly performance report and before SaaS configuration export.

Do not query `status.zerodayreapers.me` for private endpoint statistics. Query loopback port 8080 so backend
names and history remain private.

## 10. Point 6 - Domain, DNS, TLS and email-authentication posture

### Goal

Detect registrar expiry risk, unexpected DNS changes, missing mail-authentication records, and TLS expiry in
`alerts-domain-dns-mail`.

### Install tools

```bash
sudo apt install -y bind9-dnsutils whois openssl ca-certificates
```

Create `/srv/ops/domain-monitor.env` as `root:root 0600`:

```bash
DOMAIN=zerodayreapers.me
HOSTS='zerodayreapers.me www.zerodayreapers.me status.zerodayreapers.me analytics.zerodayreapers.me'
DKIM_NAMES='resend._domainkey.zerodayreapers.me'
DOMAIN_EXPIRY_WARN_DAYS=45
TLS_EXPIRY_WARN_DAYS=21
```

Add the actual Namecheap Private Email DKIM selector if one is configured. Do not invent a selector and then
alert forever because it does not exist.

Create `/srv/ops/domain-monitor.sh` to:

1. query RDAP over HTTPS and parse the registrar expiration event;
2. fall back to `whois` only if RDAP is unavailable;
3. capture A, AAAA, CNAME, MX, NS, CAA, SPF TXT, DMARC TXT, and configured DKIM TXT records;
4. compare normalized results with a reviewed baseline in `/var/lib/zdr-domain-monitor/dns-baseline.txt`;
5. check whether a DS record/DNSSEC state unexpectedly changed from the baseline;
6. check each configured host certificate with `openssl s_client` and `openssl x509 -checkend`;
7. alert on expiry thresholds, missing required records, or baseline drift;
8. never update the baseline automatically.

The first run must be baseline-only. Review the output carefully, then approve it manually:

```bash
sudo /srv/ops/domain-monitor.sh --print-current
sudo install -d -o root -g root -m 0700 /var/lib/zdr-domain-monitor
sudo /srv/ops/domain-monitor.sh --print-current | sudo tee /var/lib/zdr-domain-monitor/dns-baseline.txt >/dev/null
sudo chmod 600 /var/lib/zdr-domain-monitor/dns-baseline.txt
```

Schedule daily at 05:35 PKT. When a planned DNS change occurs, let the monitor alert, verify the live records
from a second resolver, then regenerate the baseline. Never accept drift merely to make an alert disappear.

## 11. Point 7 - Durable Discord notification queue

### Goal

Jobs currently use best-effort `curl`; an alert can disappear when Discord or the Internet is down. Add a
small protected spool and retry timer. Its own status belongs in `job-alert-delivery`.

### Design requirements

Create `/srv/ops/discord-send.sh` with two modes:

```text
discord-send.sh ROUTE MESSAGE
discord-send.sh --flush
```

It must:

- map only known route names to webhook variables; never accept a webhook URL as an argument;
- read existing routes from `/srv/ops/notifications.env` and new routes from `/srv/ops/monitoring.env`;
- build JSON with `jq` and `allowed_mentions.parse=[]`;
- reject messages above 1,800 characters;
- use `curl -fsS --connect-timeout 5 --max-time 20`;
- on delivery failure, atomically store `{route,message,queued_at}` under
  `/var/lib/zdr-discord-queue/pending` mode `0700`;
- refuse to queue more than 500 messages and emit a critical journal error instead of deleting old alerts;
- flush oldest files first under `flock`;
- remove a queue file only after Discord returns success;
- move malformed queue files to a protected `bad` directory rather than deleting them;
- after a successful flush, send one `[RESOLVED]` summary to `job-alert-delivery` with the count and oldest
  queued time;
- never include webhook URLs in journal output.

Create `/etc/systemd/system/discord-queue-flush.service`:

```ini
[Unit]
Description=Retry queued ZDR Discord notifications
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
Group=root
ExecStart=/usr/bin/flock --exclusive --nonblock /run/zdr-discord-queue.lock /srv/ops/discord-send.sh --flush
Nice=15
IOSchedulingClass=idle
MemoryHigh=48M
MemoryMax=96M
NoNewPrivileges=true
ProtectHome=true
ProtectSystem=strict
PrivateTmp=true
ReadWritePaths=/var/lib/zdr-discord-queue
```

Create `/etc/systemd/system/discord-queue-flush.timer`:

```ini
[Unit]
Description=Retry ZDR Discord notifications every two minutes

[Timer]
OnBootSec=2m
OnUnitActiveSec=2m
RandomizedDelaySec=15s

[Install]
WantedBy=timers.target
```

Install the state directories:

```bash
sudo install -d -o root -g root -m 0700 /var/lib/zdr-discord-queue/pending
sudo install -d -o root -g root -m 0700 /var/lib/zdr-discord-queue/bad
```

### Failure test

Do not alter a real webhook. Add a script test mode that deliberately queues a harmless test message, then
run `--flush` with the valid route:

```bash
sudo /srv/ops/discord-send.sh --queue-test alert-delivery '[TEST] queued delivery'
sudo find /var/lib/zdr-discord-queue/pending -maxdepth 1 -type f -printf '%f\n'
sudo systemctl start discord-queue-flush.service
sudo journalctl -u discord-queue-flush.service -n 40 --no-pager
```

Migrate existing job scripts to the helper one at a time. Keep the old direct-send implementation in each
`.pre-monitoring-expansion` rollback copy until a real failure and recovery have both been observed.

## 12. Point 8 - Scoped configuration integrity monitoring

### Goal

Use AIDE to detect unplanned changes to security and operations configuration. Send only changed paths and
counts to `alerts-config-integrity`; never send file contents.

### Install and scope AIDE

```bash
sudo apt install -y aide
sudo install -d -o root -g root -m 0700 /var/lib/aide-zdr
sudo nano /etc/aide/zdr-ops.conf
```

The dedicated configuration should use its own database under `/var/lib/aide-zdr` and include only:

```text
/etc/ssh
/etc/nftables.conf
/etc/docker/daemon.json
/etc/systemd/system
/srv/ops/*.sh
/srv/ops/*.env
/srv/ops/*/*.yaml
/srv/ops/*/*.yml
/srv/ops/*/*.conf
```

Explicitly exclude dynamic or large paths:

```text
/srv/ops/gatus/gatus.db
/srv/ops/gatus-public/gatus.db
/srv/ops/restic-cache
/srv/ops/restic-stage
/srv/ops/provider-exports/.staging
```

Use SHA-256/SHA-512 plus owner, group, mode, size, timestamps, ACL, and extended-attribute checks. Confirm the
exact AIDE rule syntax with `man aide.conf` on the Pi; do not copy a distribution-specific example without
validating it using:

```bash
sudo aide --config-check --config /etc/aide/zdr-ops.conf
```

Initialize only after reviewing the current system:

```bash
sudo aide --init --config /etc/aide/zdr-ops.conf
sudo ls -l /var/lib/aide-zdr
```

Move the generated `.new` database to the configured input database name only after the initialization
reports success. Never automate baseline acceptance.

Create `/srv/ops/config-integrity.sh` to run `aide --check`, retain the complete report in the journal, and
send a concise Discord summary. Schedule daily at 04:45 PKT.

After a planned deployment:

1. Run the check and compare every changed path with the deployment.
2. Investigate anything unrelated.
3. Run AIDE update manually.
4. Review the generated new database.
5. Replace the baseline atomically.
6. Run another check and require a clean result.

AIDE is evidence of change, not proof that a change is malicious.

## 13. Point 9 - Encrypted Cloudflare and Vercel configuration exports

### Goal

Export recovery-critical third-party metadata to the Pi and include it in the existing encrypted `pi-config`
restic snapshot. Report results to `job-saas-config-backup`.

### Credential boundaries

Create narrowly scoped credentials wherever the provider permits:

- Cloudflare: `Zone DNS Read` for only `zerodayreapers.me` and `Cloudflare Tunnel Read` for the account;
- Vercel: use a dedicated token with the minimum team/project access available; rotate it periodically;
- never use the Cloudflare Global API Key;
- never export decrypted Vercel environment-variable values by default;
- never print tokens, request headers, or raw secret-bearing API responses in the journal.

Create `/srv/ops/provider-export.env` as `root:root 0600`:

```bash
CLOUDFLARE_API_TOKEN='CHANGE_ME'
CLOUDFLARE_ZONE_ID='CHANGE_ME'
CLOUDFLARE_ACCOUNT_ID='CHANGE_ME'
CLOUDFLARE_TUNNEL_ID='CHANGE_ME'
VERCEL_API_TOKEN='CHANGE_ME'
VERCEL_PROJECT_ID='CHANGE_ME'
VERCEL_TEAM_ID='CHANGE_ME'
```

### Export job

Create `/srv/ops/saas-config-backup.sh`. It should use a new staging directory and atomically replace the
last successful export only after all required API calls and `jq` validation succeed.

Export at minimum:

- Cloudflare zone metadata and DNS records;
- Cloudflare tunnel metadata and ingress configuration, excluding credentials/tokens;
- Vercel project metadata;
- Vercel project domains;
- Vercel environment-variable names, targets, types, and timestamps with every value removed;
- a manifest containing provider, endpoint, export time, HTTP status, file SHA-256, and schema note.

Store the approved result beneath `/srv/ops/provider-exports/current`. This location is already covered by
the encrypted configuration backup because `config-backup.sh` archives `/srv/ops`.

After a successful export:

```bash
sudo systemctl start config-backup.service
sudo -u zdrops bash -c 'source /srv/ops/backup.env && restic snapshots --tag pi-config --latest 1'
```

Schedule Sunday at 08:15 PKT, after the SLO report. Skip when `config-backup.service`, `backup.service`, or
`offsite-copy.service` is active.

### Restore test

Quarterly, restore only `provider-exports/current` into a temporary directory, validate every JSON file with
`jq empty`, compare it with the live provider dashboards, and then remove the temporary restore. The export
is recovery documentation; it must never automatically rewrite live DNS, tunnels, or Vercel settings.

## 14. Point 10 - Portal login-readiness canary

### Important limitation

Production password login requires a single-use Cloudflare Turnstile token. A headless Pi job must not bypass
Turnstile, reuse a captured CAPTCHA token, disable CAPTCHA, or store an administrator’s real credentials.

Therefore the safe Pi implementation is a **login-readiness canary**, not a full password/session login. It
belongs in `health-synthetic-login` and checks the path that can be tested unattended:

1. `GET https://zerodayreapers.me/portal` returns HTTP 200 within the latency limit;
2. the response contains the expected portal shell/build marker;
3. the Turnstile JavaScript URL is present or its expected client configuration is available;
4. `GET https://zerodayreapers.me/api/health` returns 200 with `.ok == true`;
5. `.checks.db == "ok"` confirms the app execution path can reach Supabase;
6. Supabase Auth settings are reachable through the app’s existing health probe;
7. failure and recovery are state-deduplicated.

Create `/srv/ops/login-readiness.sh` and schedule it every five minutes with a randomized delay of 30 seconds.
Set timeouts of 15 seconds per request and 30 seconds for the whole service. Do not retry indefinitely.

This supplements the existing Gatus `login-page` and `app-health` checks. Keep its message focused on the
combined readiness result so it does not duplicate routine Gatus notifications.

### Future full-login option

A real synthetic login requires one of these separately reviewed designs:

- a protected server-side canary endpoint that performs a narrowly scoped authentication self-test without
  returning tokens; or
- a staging deployment with Turnstile test keys and a dedicated non-admin synthetic account.

That option requires application code, rate-limit review, secret rotation, and an audit event. It is not part
of this manual Pi rollout.

## 15. Point 11 - Optional Tailscale private access and health

### Goal

Provide private remote access to the Pi and monitor the tailnet state in `alerts-tailscale`. Tailscale is the
only proposed addition that runs a new resident daemon, so install it last and compare RAM before/after.

### Install and enroll

Follow the current official Debian installation instructions rather than an old copied repository entry:

```bash
curl -fsSL https://tailscale.com/install.sh -o /tmp/tailscale-install.sh
less /tmp/tailscale-install.sh
sudo sh /tmp/tailscale-install.sh
sudo tailscale up --hostname=zdr-ops
tailscale status
tailscale ip -4
```

The `tailscale up` step requires one browser/account approval. This cannot be fully automated safely.

Initially use the normal OpenSSH server over the Tailscale IP and keep the existing SSH key. Do not enable
Tailscale SSH until tailnet grants/ACLs have been configured and tested from a second session.

Recommended policy:

- only your operator identity/device can reach `zdr-ops`;
- allow TCP 22 and, if wanted, private Gatus TCP 8080;
- do not expose Docker, Umami port 3001, or public Gatus port 8081 through the tailnet unnecessarily;
- enable device approval and account MFA;
- disable key expiry only if you accept the associated device-compromise risk;
- never remove LAN SSH until Tailscale access and recovery have both been tested.

### Monitor

Create `/srv/ops/tailscale-health.sh` to check:

- `tailscaled.service` is active;
- `tailscale status --json` is valid;
- backend state is `Running`;
- the Pi has a Tailscale IPv4 address;
- the authenticated tailnet identity is the expected one;
- state transitions produce one failure and one recovery notification.

Schedule every ten minutes. Guardian may also check `tailscaled.service`, but only after Tailscale is an
accepted required dependency.

After 24 hours compare:

```bash
free -h
systemctl status tailscaled --no-pager
systemctl show tailscaled -p MemoryCurrent -p CPUUsageNSec
```

Disable cleanly if normal `MemAvailable` falls below the reserve:

```bash
sudo systemctl disable --now tailscaled
```

## 16. Point 12 - Notification-only container image updates

### Goal

Notify `alerts-container-updates` when a registry tag used by a running container points to a different
digest. Do not pull, restart, or upgrade anything automatically.

Prefer a weekly one-shot `skopeo` comparison over another resident container:

```bash
sudo apt install -y skopeo
```

Create `/srv/ops/container-update-check.sh` to:

1. enumerate only the managed containers `gatus`, `gatus-public`, `cloudflared`, and `umami`;
2. read each configured image reference with `docker inspect`;
3. inspect the remote registry digest with `skopeo inspect`;
4. compare the remote digest with the locally running image’s recorded repository digest;
5. treat an explicitly digest-pinned image as pinned, not “outdated”;
6. store the last observed comparison in `/var/lib/zdr-container-updates`;
7. alert once per new remote digest and once after the running image is deliberately updated;
8. never invoke `docker pull`, `docker compose pull`, `systemctl restart`, or image deletion.

Run weekly Wednesday at 08:00 PKT. Registry rate limits and network errors should produce a check failure,
not a false update notice.

Every update remains a manual change window:

1. read the upstream release notes and security advisories;
2. confirm ARM architecture support;
3. record current image digest and service file;
4. update one service;
5. verify its local endpoint and Discord routing;
6. run Guardian and `pi/verify.sh`;
7. retain the previous image until rollback is no longer needed.

## 17. Point 13 - New incoming email notification relay

### Goal

When a new message reaches the monitored mailbox, send only header metadata to the private
`alerts-email-inbox` channel:

```text
[NEW EMAIL]
From: Display Name <sender@example.com>
Received: 2026-08-30 17:20:55 PKT
Subject: optional, controlled by configuration
Mailbox: contact@zerodayreapers.me
```

Never post the message body, preview/snippet, recipients, authentication headers, links, or attachments.

### Choose the mailbox

The project documentation currently treats `contact@zerodayreapers.me` on Namecheap Private Email as the
receiving/reply mailbox. Namecheap currently specifies `mail.privateemail.com`, IMAP port `993`, and
SSL/TLS, using the full mailbox address and its master or application password. Prefer an application
password when the mailbox plan/account supports one.

For Gmail, the official IMAP endpoint is `imap.gmail.com:993` with TLS. Prefer OAuth 2.0. If an app password
is used, the Google account must have the required two-step-verification configuration and app passwords must
be available for that account. Never use the ordinary Google account password.

Monitor one mailbox first. Add a second instance only after the first is stable, giving each mailbox its own
state directory and preferably its own Discord channel if the privacy audience differs.

### Protected mailbox configuration

Create `/srv/ops/mail-monitor.env` as `root:root 0600`:

```bash
MAIL_IMAP_HOST='mail.privateemail.com'
MAIL_IMAP_PORT='993'
MAIL_USERNAME='contact@zerodayreapers.me'
MAIL_PASSWORD='CHANGE_ME'
MAIL_FOLDER='INBOX'
MAIL_TIMEZONE='Asia/Karachi'
MAIL_INCLUDE_SUBJECT='false'
MAIL_MAX_MESSAGES_PER_RUN='20'
```

If OAuth is implemented, replace `MAIL_PASSWORD` with protected client/refresh-token configuration and use
IMAP XOAUTH2. Do not place refresh or access tokens in journal output.

### Mail-check implementation contract

Create `/srv/ops/mail-monitor.py` using Python’s standard `imaplib`, `email`, `ssl`, and `zoneinfo` modules.
It must:

1. require TLS certificate validation;
2. open only the configured folder in read-only mode;
3. use IMAP UIDs rather than sequence numbers;
4. fetch headers with `BODY.PEEK`, so notifications do not mark messages as read;
5. parse and decode RFC 2047 sender names safely;
6. extract the sender display name and normalized address;
7. display both the provider/message date and the Pi detection time when available;
8. replace control characters and limit every displayed field’s length;
9. never fetch a body or attachment;
10. keep `UIDVALIDITY` and the highest processed UID in `/var/lib/zdr-mail-monitor/state.json`;
11. on first run, record the current highest UID and send `[BASELINE]` without replaying old mail;
12. cap each run at 20 new messages and queue the remainder for later runs;
13. call `/srv/ops/discord-send.sh email-inbox MESSAGE` rather than reading a webhook itself;
14. deduplicate repeated IMAP errors and send one `[RESOLVED]` after reconnection;
15. never delete, move, flag, archive, or mark an email as read.

The email `Date` header is sender-controlled and may be forged. Label it as the message date; use the Pi’s
detection time as the operationally trusted timestamp.

### systemd service and timer

Create `/etc/systemd/system/mail-monitor.service`:

```ini
[Unit]
Description=Notify Discord of new mailbox headers
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
Group=root
EnvironmentFile=/srv/ops/mail-monitor.env
ExecStart=/usr/bin/python3 /srv/ops/mail-monitor.py
TimeoutStartSec=45s
Nice=15
MemoryHigh=48M
MemoryMax=96M
NoNewPrivileges=true
ProtectHome=true
ProtectSystem=strict
PrivateTmp=true
StateDirectory=zdr-mail-monitor
ReadWritePaths=/var/lib/zdr-mail-monitor /var/lib/zdr-discord-queue
```

Create `/etc/systemd/system/mail-monitor.timer`:

```ini
[Unit]
Description=Check the monitored inbox every two minutes

[Timer]
OnBootSec=3m
OnUnitActiveSec=2m
RandomizedDelaySec=15s

[Install]
WantedBy=timers.target
```

### Safe test

1. Start the service once; require a `[BASELINE]` message and no historical email dump.
2. Send a harmless test from a different account.
3. Start the service again or wait for the timer.
4. Confirm name, sender address, message date/detection time, and optional subject.
5. Confirm the source email remains unread.
6. Start the service again and require no duplicate.
7. Stop the network briefly only during a maintenance window, confirm one deduplicated failure, restore the
   network, and confirm one recovery.

If the account receives password-reset links, private student information, or sensitive business mail, keep
`MAIL_INCLUDE_SUBJECT=false`.

## 18. Recommended deployment order

The numerical list describes the requested features; the safest installation order is different because the
notification queue should exist before new monitors depend on it:

1. Create all Discord channels and webhooks.
2. Install the protected `monitoring.env`.
3. Install Point 7, the Discord delivery queue/helper.
4. Add Point 1, Guardian recovery behavior.
5. Add Points 2 and 3, performance history and disk tests.
6. Add Points 4, 5, and 6, scheduled reports and domain posture.
7. Add Point 8, configuration integrity, and approve its initial baseline.
8. Add Point 9 only after read-only provider credentials exist.
9. Add Point 10 as login-readiness only.
10. Add Point 12, notification-only container update checks.
11. Add Point 13 after deciding which mailbox is in scope and how it authenticates.
12. Add optional Point 11, Tailscale, last; observe RAM for 24 hours.

Wait at least one normal schedule cycle between groups 5-12. Do not interpret “timer enabled” as “monitor
proven”; force one controlled failure and recovery where the section permits it.

## 19. Final verification checklist

### Discord isolation

- [ ] Every monitor posts to only its assigned channel.
- [ ] `@everyone` cannot view any operations channel.
- [ ] Webhook messages cannot generate mentions.
- [ ] Webhook URLs never appear in Git, Discord messages, shell history, or journals.
- [ ] `zdr-ops` remains a read-only historical archive.

### Functional checks

- [ ] Guardian sends one failure and one recovery, then stays quiet.
- [ ] `sar` and `vnstat` retain data after reboot.
- [ ] SMART self-test history is readable and disk jobs avoid restic jobs.
- [ ] Security report contains counts but no attacker usernames/IPs or secret contents.
- [ ] Gatus report returns both 7-day and 30-day values from loopback port 8080.
- [ ] DNS baseline changes only after manual approval.
- [ ] A queued Discord test survives a failed send and flushes once.
- [ ] AIDE reports a controlled test-file change and returns clean after reviewed baseline update.
- [ ] Provider exports contain no tokens or decrypted Vercel values.
- [ ] Login readiness checks the portal, app health, DB path, and Turnstile presence without credentials.
- [ ] Tailscale, if installed, is access-controlled and does not replace recovery access.
- [ ] Container monitor never pulls or restarts anything.
- [ ] Email monitor starts from a baseline, leaves mail unread, and never sends bodies/attachments.

### Host checks

```bash
sudo systemd-analyze verify /etc/systemd/system/*.service /etc/systemd/system/*.timer
systemctl list-timers --all --no-pager
systemctl --failed --no-pager
sudo journalctl -p warning --since '24 hours ago' --no-pager
sudo docker stats --no-stream
free -h
sudo bash /home/zdradmin/pi/verify.sh
```

`systemd-analyze verify` over every local unit may show unrelated warnings from older services; resolve any
warning naming a new unit before continuing.

Keep at least 200 MiB available under ordinary load and preferably 250-300 MiB. If the reserve is breached,
disable optional Tailscale first, then lengthen frequent timer intervals. Do not disable Guardian, Gatus,
backups, restore drills, firewalling, or SSH protection to make room.

## 20. Manual actions that cannot be eliminated

Most checks can run automatically after installation, but the following deliberately require a human on a
fresh deployment or during ongoing maintenance. Discord channel/webhook creation is already complete on the
current deployment:

- creating private Discord channels and copying their webhooks;
- approving Cloudflare/Vercel credentials and rotating them;
- approving a DNS and AIDE baseline after reviewing it;
- deciding whether email subjects may be posted to Discord;
- configuring Gmail OAuth/app-password access or the Namecheap mailbox credential;
- approving a Tailscale device and access policy;
- reviewing release notes and deploying container updates;
- deciding whether a future full-login canary endpoint is acceptable.

These gates prevent a monitoring feature from silently gaining write access, weakening CAPTCHA, leaking mail,
or rewriting production configuration.

## 21. Official references

- [Discord webhooks](https://docs.discord.com/developers/resources/webhook)
- [sysstat performance tools](https://github.com/sysstat/sysstat)
- [vnStat](https://humdi.net/vnstat/)
- [smartmontools documentation](https://www.smartmontools.org/wiki/TocDoc)
- [Gatus v5.36.0 API and raw uptime/response-time data](https://github.com/TwiN/gatus/blob/v5.36.0/README.md#api)
- [AIDE](https://aide.github.io/)
- [Cloudflare API token creation and scoping](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
- [Vercel REST API](https://vercel.com/docs/rest-api)
- [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords)
- [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
- [Tailscale on Linux](https://tailscale.com/docs/install/linux)
- [Tailscale SSH](https://tailscale.com/docs/features/tailscale-ssh)
- [Namecheap Private Email IMAP configuration](https://www.namecheap.com/support/knowledgebase/article.aspx/1179/2175/general-private-email-configuration-for-mail-clients-and-mobile-devices/)
- [Gmail IMAP, SMTP, and OAuth](https://developers.google.com/workspace/gmail/imap/imap-smtp)

## 22. Work completed

The following items were completed on `zdr-ops` on 2026-08-30 and 2026-08-31:

- [x] `OPS-HARDENING.md` Step 7 capacity, weekly operations, Umami, and monthly reports are installed,
  tested, enabled, and routed to separate Discord channels.
- [x] The latest capacity run calculated both usage and remaining capacity for the live measurable providers.
  Usage at deployment time was B2 3%, Neon 1%, R2 4%, Supabase database 4%, Supabase storage 1%, and
  Supabase MAU 0%.
- [x] `OPS-HARDENING.md` Step 8 is active on GitHub `main`. `DISCORD_GITHUB_WEBHOOK` and
  `DISCORD_VERCEL_WEBHOOK` exist as GitHub Actions secrets, and recent push and Vercel
  `repository_dispatch` runs completed successfully.
- [x] Twelve new private Discord channels and twelve dedicated incoming webhooks were created beneath the
  private operations category. Every route passed an end-to-end delivery test.
- [x] `/srv/ops/monitoring.env` contains the twelve Discord routes as `root:root` mode `0600`; no webhook is
  stored in this repository.
- [x] The durable Discord queue is enabled. Both `/var/lib/zdr-discord-queue/pending` and
  `/var/lib/zdr-discord-queue/bad` were empty after the recovery/flush test.
- [x] Pi performance, bandwidth, disk health, security posture, Gatus SLO, domain/DNS posture,
  configuration integrity, login readiness, and container-update notification jobs are installed and their
  safe timers are enabled.
- [x] Guardian now sends failure and recovery messages and checks the new required timers. A real restic
  access failure was detected, corrected, and followed by a successful recovery notification.
- [x] The `/srv/ops` service-access regression was fixed by using `root:zdrops` mode `0750`; the installer was
  corrected so future runs preserve access for the unprivileged backup account.
- [x] Scoped AIDE integrity monitoring is enabled with a reviewed 205-entry baseline.
- [x] The synthetic login-readiness check passes for the portal, application health, database-backed health
  path, and Turnstile presence without storing login credentials or bypassing CAPTCHA.
- [x] Exim, which arrived as an AIDE package dependency, is disabled and masked. Nothing listens on TCP 25.
- [x] `pi/verify.sh` completed with 71 passes, zero warnings, and zero failures. At final verification the Pi
  had 449 MiB `MemAvailable`, above the 200 MiB required reserve.
- [x] SaaS export, Tailscale health, and incoming-email monitoring are enabled and their controlled service
  tests pass. Mail and Tailscale completed normal timer-triggered cycles; SaaS export completed a persistent
  catch-up run and remains scheduled for its ordinary Sunday cycle.

## 23. Remaining validation and ongoing manual actions

No additional Discord webhook or GitHub Actions credential is required. Those routes and secrets are already
configured. The credential-enrollment record below is complete except where explicitly left open; remaining
items are schedule observation and recurring maintenance.

### 23.1 Cloudflare and Vercel export credentials

- [x] Create a dedicated Cloudflare API token with Zone DNS Read access restricted to
  `zerodayreapers.me` and Cloudflare Tunnel Read access for the owning account.
- [x] Collect `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_TUNNEL_ID` from the account that
  owns the production zone and tunnel.
- [x] Create a dedicated minimum-access Vercel API token and collect `VERCEL_PROJECT_ID` and
  `VERCEL_TEAM_ID` for the production project.
- [x] Put the following seven values only in `/srv/ops/provider-export.env`:

```bash
CLOUDFLARE_API_TOKEN='REPLACE_IN_SUDOEDIT'
CLOUDFLARE_ZONE_ID='REPLACE_IN_SUDOEDIT'
CLOUDFLARE_ACCOUNT_ID='REPLACE_IN_SUDOEDIT'
CLOUDFLARE_TUNNEL_ID='REPLACE_IN_SUDOEDIT'
VERCEL_API_TOKEN='REPLACE_IN_SUDOEDIT'
VERCEL_PROJECT_ID='REPLACE_IN_SUDOEDIT'
VERCEL_TEAM_ID='REPLACE_IN_SUDOEDIT'
```

Use `sudoedit /srv/ops/provider-export.env`, then run:

```bash
sudo chown root:root /srv/ops/provider-export.env
sudo chmod 600 /srv/ops/provider-export.env
sudo systemctl start saas-config-backup.service
systemctl show saas-config-backup.service -p Result -p ExecMainStatus
sudo systemctl enable --now saas-config-backup.timer
```

Never use the Cloudflare Global API Key, and never paste any token into Discord, Git, this document, or a
shell command.

The current export targets Vercel project `zero-day-reapers-website`, which owns the apex and `www`
production domains. Confirm whether the separate `zero-day-reapers-website-jkb7` project is an additional
production workload; if it is, extend the exporter rather than silently replacing the current project.

### 23.2 Namecheap incoming-mail credential and privacy decision

- [x] Confirm that `contact@zerodayreapers.me` is the mailbox to monitor.
- [x] Obtain the password for that exact Namecheap Private Email mailbox, preferably an application password
  if supported. The Resend SMTP/API credential cannot be used for IMAP.
- [x] Decide whether email subjects may appear in the private Discord channel. The safe default remains
  `MAIL_INCLUDE_SUBJECT=false`.
- [x] Put the mailbox settings only in `/srv/ops/mail-monitor.env`:

```bash
MAIL_IMAP_HOST='mail.privateemail.com'
MAIL_IMAP_PORT='993'
MAIL_USERNAME='contact@zerodayreapers.me'
MAIL_PASSWORD='REPLACE_IN_SUDOEDIT'
MAIL_FOLDER='INBOX'
MAIL_TIMEZONE='Asia/Karachi'
MAIL_INCLUDE_SUBJECT='false'
MAIL_MAX_MESSAGES_PER_RUN='20'
```

Use `sudoedit /srv/ops/mail-monitor.env`, then run:

```bash
sudo chown root:root /srv/ops/mail-monitor.env
sudo chmod 600 /srv/ops/mail-monitor.env
sudo systemctl start mail-monitor.service
systemctl show mail-monitor.service -p Result -p ExecMainStatus
sudo systemctl enable --now mail-monitor.timer
```

- [x] Confirm the first run creates a baseline without replaying historical mail.
- [ ] Send one harmless test email and confirm Discord shows sender name, sender address, message date, and Pi
  detection time only. Confirm the email remains unread and a second run creates no duplicate.

### 23.3 Optional Tailscale enrollment

- [x] Decide whether the extra resident daemon and private remote-access path are wanted.
- [x] Install Tailscale using its current official Debian instructions.
- [x] Run `sudo tailscale up --hostname=zdr-ops`, approve the device, and restrict Pi SSH to the approved
  operator devices in both Tailscale policy and nftables.
- [ ] Confirm account MFA and Tailscale device approval remain enabled in the owning account.
- [x] Test Tailscale from a second session while retaining LAN SSH and the existing SSH key.
- [x] Put `TAILSCALE_EXPECTED_DNS_NAME` in `/srv/ops/tailscale-health.env`.
- [x] Start `tailscale-health.service`; only after it passes, enable `tailscale-health.timer`.
- [ ] Observe memory for 24 hours and disable Tailscale first if normal `MemAvailable` falls below the reserve.

Tailscale interactive enrollment does not require storing a reusable auth token in a Pi environment file.

### 23.4 DNS/SPF correction

- [x] Publish the exact Namecheap Private Email SPF record at the apex while retaining Resend's separate SPF
  record on `send.zerodayreapers.me`; exactly one SPF record exists at each hostname.
- [x] Wait for DNS propagation, run `sudo systemctl start domain-monitor.service`, and confirm it succeeds.
- [x] Review the changed DNS output and approve a new baseline only after the SPF record is verified.

This DNS repair required provider-dashboard access but no credential stored on the Pi. The monitor now passes
with the reviewed SPF addition included in its DNS baseline.

### 23.5 Ongoing manual maintenance

- [ ] Review container-update alerts and release notes, then upgrade one container at a time during a change
  window. The monitor intentionally never pulls or restarts containers.
- [ ] Review and approve AIDE baseline changes only after matching every change to an authorized deployment.
- [ ] Keep provider-native quota/billing alerts enabled for meters that cannot be queried accurately on the
  free plan, and review those dashboards during the weekly/monthly operations review.
- [ ] Rotate Cloudflare, Vercel, mailbox, Discord, and GitHub credentials according to the provider policy or
  immediately after suspected exposure.
- [ ] Continue periodic restic restore drills and quarterly restoration checks of provider export JSON.
- [ ] Observe at least one complete normal schedule cycle after enabling each currently disabled integration.
- [ ] Review, commit, and push the local repository changes when ready; deployment does not automatically
  create a Git commit.
