# Email Notifications (Resend)

Students get an email when an admin approves/rejects their task submission.
Uses **Resend** (free tier: 3,000 emails/month). Sending happens server-side in
`/api/notify` (admin-authed); the key never reaches the browser.

## 1. Create a Resend account + API key
1. https://resend.com → sign up (free).
2. **API Keys** → **Create API Key** → copy it (`re_…`).

## 2. Sender address
- **Quickest (testing):** use `onboarding@resend.dev` as the from address — works immediately, no domain setup. This is the default in the code.
- **Production (recommended):** Resend → **Domains** → add `zerodayreapers.me` → add the DNS records it shows to Namecheap → verify. Then set the from address to something like `ZeroDay Reapers <noreply@zerodayreapers.me>`.

## 3. Environment variables
Local `.env.local` **and** Vercel → main project → Settings → Environment Variables → redeploy:
```
RESEND_API_KEY=re_your_key_here
RESEND_FROM=ZeroDay Reapers <onboarding@resend.dev>
```
(If `RESEND_API_KEY` is unset, emails are simply skipped — grading still works.)

## 4. Test
Approve a student's submission in the Admin panel → they receive an email with the task, status, and any feedback. If it doesn't arrive, check Resend → **Logs**.

Emails are **best-effort**: grading never fails or blocks if the email send fails.
