# Umami on zdr-ops (optional)

This runs only the ARM64 Umami application on the 1 GB Pi. PostgreSQL must be external and dedicated to
analytics; never use the production portal database. The container is capped at 256 MiB RAM, 320 MiB
RAM+swap, 0.75 CPU, and loopback port 3001. Docker logs rotate automatically.

## 1. External database and secrets

Create a dedicated PostgreSQL database (a separate project/database from the portal), then upload
`umami.env.example` as `/srv/ops/umami.env` and fill it. Generate the two secrets independently:

```bash
openssl rand -hex 32
openssl rand -hex 32
sudo chown root:zdrops /srv/ops/umami.env
sudo chmod 640 /srv/ops/umami.env
```

The `zdrops` group read permission lets the existing backup job dump the Umami database into encrypted
restic snapshots. The database is backed up only when `/srv/ops/umami.env` exists.

## 2. Install and test

Upload `umami.service`, then:

```bash
tr -d '\r' < ~/umami.service | sudo tee /etc/systemd/system/umami.service >/dev/null
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
