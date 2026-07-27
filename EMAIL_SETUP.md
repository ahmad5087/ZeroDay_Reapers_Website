# Email Notifications (Resend)

Students get an email when an admin approves/rejects their task submission.
Uses **Resend** (free tier: 3,000 emails/month). Sending happens server-side in
`/api/notify` (admin-authed); the key never reaches the browser.

## 1. Create a Resend account + API key
1. https://resend.com → sign up (free).
2. **API Keys** → **Create API Key** → copy it (`re_…`).

## 2. Sender address
- **Quickest (testing):** use `onboarding@resend.dev` as the from address — works immediately, no domain setup. This is the default in the code.
- **Production (recommended):** verify the **domain** (not a single mailbox) in Resend:
  1. Resend → **Domains** → **Add Domain** → `zerodayreapers.me`. Resend generates DNS records on a `send.` subdomain for the return-path, so your normal mail is untouched.
  2. Namecheap → Domain List → `zerodayreapers.me` → **Advanced DNS** → add exactly what Resend shows (typically an MX on host `send`, a TXT SPF on `send`, and a TXT DKIM on `resend._domainkey`; optionally DMARC on `_dmarc`).
  3. **Leave your existing Namecheap Private Email records alone** (the `@` MX + its SPF). Resend's records live on the `send` subdomain, so the `contact@zerodayreapers.me` mailbox and Resend sending coexist.
  4. Click **Verify** in Resend (DNS can take minutes to an hour). Then set the from address to `ZeroDay Reapers <noreply@zerodayreapers.me>`.

## 3. Environment variables
Local `.env.local` **and** Vercel → main project → Settings → Environment Variables → redeploy:
```
RESEND_API_KEY=re_your_key_here
RESEND_FROM=ZeroDay Reapers <noreply@zerodayreapers.me>
RESEND_REPLY_TO=contact@zerodayreapers.me   # optional — student replies land in your Namecheap inbox
```
(If `RESEND_API_KEY` is unset, emails are simply skipped — grading still works. If `RESEND_REPLY_TO` is unset, replies go to the `From` address.)

## 4. Test
Approve a student's submission in the Admin panel → they receive an email with the task, status, and any feedback. If it doesn't arrive, check Resend → **Logs**.

Emails are **best-effort**: grading never fails or blocks if the email send fails.
