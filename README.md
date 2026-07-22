# ZeroDay Reapers

Offensive cybersecurity marketing site. Next.js 15 + Tailwind. Single page.

## Run locally
```bash
npm install
npm run dev
```
Open http://localhost:3000

## Contact form (Web3Forms — free)
1. Go to https://web3forms.com and paste `contact@zerodayreapers.me` to get an access key.
2. In `app/page.jsx` replace `YOUR_WEB3FORMS_ACCESS_KEY` with the key.

## Deploy to Vercel
```bash
npm i -g vercel
vercel
```
Follow prompts. Then in Vercel dashboard → **Project → Settings → Domains → Add `zerodayreapers.me`**.
Vercel will show you the DNS records to set at Namecheap (an A record and/or CNAME).

## Namecheap DNS setup
- Log into Namecheap → Domain List → **Manage** on `zerodayreapers.me` → **Advanced DNS**.
- Add records exactly as Vercel shows (typically `A @ 76.76.21.21` and `CNAME www cname.vercel-dns.com`).
- Propagation: minutes to a couple hours.

## Portfolio (`/portfolio`)

Ali's scrollytelling portfolio lives in `portfolio/` as a **separate Next.js app**
(Tailwind v4), served under `zerodayreapers.me/portfolio` via rewrites in
`next.config.mjs`. Kept separate so the two Tailwind majors don't collide.

**Local dev (two servers):**
```bash
# terminal 1 — main site
npm run dev                 # localhost:3000

# terminal 2 — portfolio
cd portfolio && npm install && npm run dev -- -p 3001
```
Then open http://localhost:3000/portfolio (main app proxies to :3001).

**Deploy (two Vercel projects, same repo):**
1. Main site — import repo as-is (root directory `.`).
2. Portfolio — import the **same repo again**, set **Root Directory = `portfolio`**.
   Note its deploy URL (e.g. `https://zerodayreapers-portfolio.vercel.app`).
3. On the **main** project → Settings → Environment Variables →
   `PORTFOLIO_URL = https://<portfolio-deploy-url>` → redeploy.

The portfolio uses `basePath: /portfolio`, so all its routes/assets are already
namespaced. Frame sequence path is hardcoded to `/portfolio/sequence/...` in
`portfolio/src/components/ScrollyCanvas.tsx` — keep it in sync with basePath.

## Editing
- Services: `SERVICES` array at top of `app/page.jsx`
- CEO bio / certs: `CERTS` array + CEO section in `app/page.jsx`
- Colors: `tailwind.config.js` (blood/ink palettes)
- Add a real CEO photo: drop into `/public/ali.jpg` and swap the `<Image src="/logo.png" ...>` inside the CEO block.
