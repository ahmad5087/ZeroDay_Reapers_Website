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

## Editing
- Services: `SERVICES` array at top of `app/page.jsx`
- CEO bio / certs: `CERTS` array + CEO section in `app/page.jsx`
- Colors: `tailwind.config.js` (blood/ink palettes)
- Add a real CEO photo: drop into `/public/ali.jpg` and swap the `<Image src="/logo.png" ...>` inside the CEO block.
