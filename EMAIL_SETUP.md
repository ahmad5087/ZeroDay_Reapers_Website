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

## 5. Automated portal emails (Phase D)
Beyond the task-graded email, the portal now sends these — all **best-effort** and **silently
skipped until `RESEND_API_KEY` is set**, so nothing breaks before you configure Resend:

| Email | Trigger | Route | Recipients |
|-------|---------|-------|------------|
| Selection status (approved/rejected) | admin sets account status | `/api/notify` | that student |
| Certificate ready | admin graduates a student | `/api/notify` | that student |
| New task assigned | admin creates a task | `/api/email/broadcast` | that domain + RAM tier |
| New announcement | admin posts a **manual** announcement | `/api/email/broadcast` | all approved students |
| Submission received (receipt) | student uploads a submission | `/api/email/self` | that student (own address only) |
| Deadline reminder | daily cron, task due ≤48h, not yet submitted | `/api/cron/deadline-reminders` | matching students, once per task |

> Note: only *manual* announcements email everyone. Task creation already posts its own
> announcement, so it emails via the task path only — no double-send.

### Multi-recipient / deadline-reminder setup
The broadcast + reminder paths need to read many students' emails, so they use extra secrets:
```
SUPABASE_SERVICE_ROLE_KEY=...   # server-only; used by the cron (bypasses RLS). Supabase → Settings → API
CRON_SECRET=...                 # any long random string; protects /api/cron/*
```
1. Add both to Vercel (main project) + `.env.local`.
2. Run **`supabase/024_email_reminders.sql`** (adds the `task_deadline_reminders` de-dup table).
3. `vercel.json` already schedules the reminder cron **daily at 09:00 UTC**. Vercel automatically sends
   `Authorization: Bearer $CRON_SECRET` with cron requests, which the route verifies.
   - Hobby plan allows daily crons; the job looks 48h ahead so a once-a-day run still catches everyone.
   - Manual test: `GET /api/cron/deadline-reminders?secret=YOUR_CRON_SECRET`.
4. **Sending to students needs a *verified domain*** (§2) — the `onboarding@resend.dev` test sender only
   delivers to your own Resend account address, so cohort-wide email won't reach students until the domain
   is verified.

## 6. Don't bulk-send from the Namecheap mailbox — use Resend / portal announcements
`contact@zerodayreapers.me` (Namecheap Private Email) is a **mailbox for receiving replies**, not a bulk
sender. It enforces a strict outbound cap per rolling 60 minutes, so sending to many people at once — e.g.
a 34-person **BCC in Outlook** — trips the limit and the whole batch is rejected:

```
554 5.7.1 <DATA>: Data command rejected: Reject: too many messages from sender in last 60 minutes
```

If you hit this, the mailbox is locked out for ~1 hour. Don't work around it with batching — use the right
tool for multi-recipient email:

- **Post a portal Announcement** (Admin panel) with **"Email all students"** checked — it fans out
  **individually via Resend** (never BCC), so it never touches the mailbox limit. Task emails already go
  only to that task's **Department + RAM** tier.
- Or send a one-off from the **Resend dashboard** (Broadcasts) once the domain is verified.
- Leave the Namecheap mailbox as the **reply-to inbox** only (`RESEND_REPLY_TO`).

**Rule of thumb: Namecheap = inbox, Resend = sending.**
