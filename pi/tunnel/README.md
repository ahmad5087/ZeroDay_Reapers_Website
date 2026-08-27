# pi/tunnel — public status page via Cloudflare Tunnel

Publishes the gatus dashboard (internal `http://10.10.0.132:8080`) at a public HTTPS URL like
**`https://status.zerodayreapers.me`** using a **Cloudflare Tunnel** — no router port-forwarding, no dynamic
DNS, no inbound firewall change (cloudflared dials OUT to Cloudflare). Cloudflare terminates TLS for you.

`cloudflared` is a lightweight Go binary (~30-50 MB RAM) — fine alongside gatus/restic on the 1 GB Pi
(unlike ClamAV, which we deliberately do not run here).

## 0. First: make the dashboard safe to expose
The gatus dashboard shows each check's URL, which includes your Supabase project ref and R2 account id.
Those are already semi-public identifiers (not secrets), but for a clean public page the backend checks
(`supabase`, `r2-endpoint`, `app-health`) now have `ui: { hide-hostname: true, hide-url: true }` in
`pi/monitor/gatus.yaml`. Re-SFTP that file and restart gatus so the public page shows names + status only:
```bash
sudo install -o zdrops -g zdrops -m 0644 ~/gatus.yaml /srv/ops/gatus/gatus.yaml
sudo systemctl restart gatus
```

## 1. Create the tunnel in Cloudflare (dashboard, ~2 min)
1. Cloudflare **Zero Trust** dashboard -> **Networks -> Tunnels -> Create a tunnel** -> **Cloudflared**.
2. Name it `zdr-ops`. On the next screen, **copy the token** (the long `eyJ...` string) — you'll paste it
   into `cloudflared.env`. (Ignore the install commands it shows; we run it via the systemd unit below.)
3. Add a **Public Hostname**:
   - Subdomain `status`, Domain `zerodayreapers.me` (Cloudflare auto-creates the DNS record).
   - **Service**: Type `HTTP`, URL `localhost:8080`.
4. Save. (Leave it as a truly public page — do **not** add a Cloudflare Access policy unless you want it
   gated.)

## 2. Install cloudflared on the Pi
Upload `pi/tunnel/cloudflared.service` + `pi/tunnel/cloudflared.env.example` via SFTP to `~`, then:
```bash
# secret token file
sudo cp ~/cloudflared.env.example /srv/ops/cloudflared.env
sudo nano /srv/ops/cloudflared.env          # paste TUNNEL_TOKEN=eyJ...
sudo chmod 600 /srv/ops/cloudflared.env

# service
tr -d '\r' < ~/cloudflared.service | sudo tee /etc/systemd/system/cloudflared.service >/dev/null
sudo systemctl daemon-reload && sudo systemctl enable --now cloudflared
sudo docker logs --tail 20 cloudflared        # expect "Registered tunnel connection" lines
```

## 3. Verify
- Browse to **https://status.zerodayreapers.me** — the ZDR Ops Monitor loads over HTTPS.
- The internal `http://10.10.0.132:8080` still works from your admin subnet (unchanged).
- `systemctl is-active cloudflared` -> `active`.

## Notes
- **No firewall change:** cloudflared is outbound-only; `--network host` lets it reach gatus on
  `127.0.0.1:8080` (loopback is already allowed). If you ever reload nftables, remember the usual
  `sudo systemctl restart docker` afterwards.
- **To take the page down:** `sudo systemctl disable --now cloudflared` (the internal dashboard stays up).
- `cloudflared.env` holds the tunnel token and is **gitignored** — never commit it.
