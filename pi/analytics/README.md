# Umami on zdr-ops (optional)

This runs only the ARM64 Umami application on the 1 GB Pi. PostgreSQL must be external and dedicated to
analytics; never use the production portal database. The container is capped at 320 MiB RAM, 384 MiB
RAM+swap, 0.75 CPU, and loopback port 3001. Docker logs rotate automatically. The image is pinned to
Umami 3.3.1's ARM64 digest so `latest` cannot change unexpectedly.

## 1. External database and secrets

Create a dedicated PostgreSQL database (a separate project/database from the portal). For Neon, use the
Singapore region, put the pooled URL in `DATABASE_URL`, and the non-pooler URL in `DIRECT_DATABASE_URL`.
Use `sslmode=verify-full` in both URLs; retain Neon's `channel_binding=require` parameter when present.
Upload `umami.env.example`, install it, and generate the two secrets independently:

```bash
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/backup/backup.sh > /srv/ops/backup.sh"
sudo chown zdrops:zdrops /srv/ops/backup.sh
sudo chmod 750 /srv/ops/backup.sh
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/analytics/umami.env.example > /srv/ops/umami.env"
openssl rand -hex 32
openssl rand -hex 32
sudo nano /srv/ops/umami.env
sudo chown root:zdrops /srv/ops/umami.env
sudo chmod 640 /srv/ops/umami.env
sudo grep -q CHANGE_ME /srv/ops/umami.env && echo 'STOP: placeholder remains' || echo 'PASS: placeholders removed'
sudo -u zdrops bash -c '
  db="$(sed -n "s/^DIRECT_DATABASE_URL=//p" /srv/ops/umami.env | tail -n 1 | tr -d "\r")"
  psql "$db" -tAc "select 1" | grep -qx 1
' && echo 'PASS: dedicated Umami database reachable'
```

The `zdrops` group read permission lets the existing backup job dump the Umami database into encrypted
restic snapshots. The database is backed up only when `/srv/ops/umami.env` exists. The backup sets
`PGSSLROOTCERT=system` so libpq can verify Neon against Debian's trusted CA bundle and
`PGSSLCERTMODE=disable` so the sandboxed service does not probe the intentionally hidden home directory
for an unused client certificate. Password authentication, server verification, and channel binding stay
enabled. Save all four database and application secrets in the password manager; do not paste them into
chat or commit them.

The `pg_dump` client must be at least as new as Neon's server. For a PostgreSQL 18 Neon project on Debian
13, install only `postgresql-client-18` from the official PostgreSQL Apt repository. The backup deliberately
uses `/usr/lib/postgresql/18/bin/pg_dump`; a PostgreSQL server is not installed on the Pi.

## 2. Install and test

First confirm Docker reports memory-limit support. If `docker info` reports `WARNING: No memory limit
support`, do not start Umami. On current 64-bit Raspberry Pi OS, append
`cgroup_memory=1 cgroup_enable=memory` to the single line in `/boot/firmware/cmdline.txt`, reboot, and
verify that `memory` appears in `/sys/fs/cgroup/cgroup.controllers` before continuing. Firmware and the
device tree may add `cgroup_disable=memory` to `/proc/cmdline` even though that token is not present in
the editable file; do not modify a DTB to remove it.

Upload the current `pi/analytics` directory, then:

```bash
sudo sh -c "tr -d '\r' < /home/zdradmin/pi/analytics/umami.service > /etc/systemd/system/umami.service"
sudo systemd-analyze verify /etc/systemd/system/umami.service
sudo systemctl daemon-reload
sudo systemctl enable --now umami
sudo docker ps --filter name=umami
curl -fsS http://127.0.0.1:3001/api/heartbeat
```

Wait for the container to become healthy. On first login, use Umami's documented default `admin` / `umami`
and change the password immediately. Enable Umami 2FA after login.

## 3. Publish through the existing tunnel

In Cloudflare Zero Trust, add a published application route:

- Hostname: `analytics.zerodayreapers.me`
- Service: `HTTP`
- URL: `localhost:3001`

If Cloudflare does not create DNS automatically, add a proxied CNAME named `analytics` pointing to the same
`<tunnel-id>.cfargotunnel.com` target used by `status`. Do not open port 3001 in nftables or the router.

## 4. Add the tracker to the portal

Create the website in Umami, copy its website ID, and set these Vercel environment variables:

```text
NEXT_PUBLIC_UMAMI_SCRIPT_URL=https://analytics.zerodayreapers.me/script.js
NEXT_PUBLIC_UMAMI_WEBSITE_ID=<website UUID from Umami>
```

Redeploy. The application loads Umami only when both variables exist. Vercel Analytics remains enabled;
keep both briefly for comparison, then decide whether the duplicate analytics is useful.
