# pi/tunnel — public status page via Cloudflare Tunnel

Publishes the sanitized Gatus dashboard (loopback `http://127.0.0.1:8081`) at a public HTTPS URL like
**`https://status.zerodayreapers.me`** using a **Cloudflare Tunnel** — no router port-forwarding, no dynamic
DNS, no inbound firewall change (cloudflared dials OUT to Cloudflare). Cloudflare terminates TLS for you.

`cloudflared` is a lightweight Go binary (~30-50 MB RAM) — fine alongside gatus/restic on the 1 GB Pi
(unlike ClamAV, which we deliberately do not run here).

## 0. First: deploy the sanitized public instance
`ui.hide-hostname` cleans up the Gatus page but does not remove historical hostnames from its JSON API.
Keep the full six-check monitor private on port 8080 and deploy `pi/monitor/gatus-public.*` on loopback
port 8081. The public instance contains only public website URLs and the coarse `/api/health` check. Follow
`pi/OPS-HARDENING.md` section 4 and verify the JSON before changing the tunnel route.

## 1. Create the tunnel in Cloudflare (dashboard, ~2 min)
1. Cloudflare **Zero Trust** dashboard -> **Networks -> Tunnels -> Create a tunnel** -> **Cloudflared**.
2. Name it `zdr-ops`. On the next screen, **copy the token** (the long `eyJ...` string) — you'll paste it
   into `cloudflared.env`. (Ignore the install commands; we run the container with systemd.)
3. Add a **Public Hostname**:
   - Subdomain `status`, Domain `zerodayreapers.me` (Cloudflare auto-creates the DNS record).
   - **Service**: Type `HTTP`, URL `localhost:8081`.
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
- The private `http://10.10.0.132:8080` still works from your admin subnet with all six checks.
- `curl http://127.0.0.1:8081/api/v1/endpoints/statuses` returns only sanitized public checks.
- `systemctl is-active cloudflared` -> `active`.

## Notes
- **No firewall change:** cloudflared is outbound-only; `--network host` lets it reach public Gatus on
  `127.0.0.1:8081` (loopback is already allowed). If you ever reload nftables, remember the usual
  `sudo systemctl restart docker` afterwards.
- **To take the page down:** `sudo systemctl disable --now cloudflared` (the internal dashboard stays up).
- `cloudflared.env` holds the tunnel token and is **gitignored** — never commit it. Docker reads it with
  `--env-file`, keeping the value out of `systemctl status` and the process command line. Avoid dumping the
  container's complete environment with `docker inspect` because Docker administrators can still read it.
