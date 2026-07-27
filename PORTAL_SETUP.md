# ZeroDay Reapers — Portal (Supabase) Setup

The portal lives at **`/portal`** in the main Next.js app. It's a signup-based
community: students create an account, pick one domain, and enter a live chat
room for that domain. One admin (you) moderates.

Everything runs on Supabase's free tier. The anon key is safe in the browser —
all real protection is enforced by Row-Level Security in `supabase/schema.sql`.

---

## 1. Create the Supabase project
1. Go to https://supabase.com → **New project** (free tier).
2. Once ready: **Settings → API** → copy the **Project URL** and **anon public** key.

## 2. Run the schema
Run these in the Supabase **SQL Editor** (New query → paste → Run) **in order** — each is idempotent:

1. [`supabase/schema.sql`](supabase/schema.sql) — base tables, RLS, triggers, lobby, avatars bucket, realtime.
2. `002` … `010` in order — tasks/submissions/documents + PII lockdown (002), gender + DM (003),
   task attachments (004), delete/approval (005), kicked-emails + payment proof (006), alumni + retention (007),
   automod + uncapped chat (008), link approval + pinning (009), immutable gender (010).
3. **`011_fixes.sql` — required corrective migration** (fixes broken column refs from 007, restores gender/avatar,
   de-fangs the Week-4 purge). Then `012` (safe previews), `013` (manual graduation + fee confirm),
   `014` (audit log + reports), `015` (RAM specs).

The authoritative migration list + one-line descriptions live in **[HANDOFF.md](HANDOFF.md) §3 and §7**.

## 2c. File storage — Cloudflare R2 (required for tasks + resumes)
Task PDFs and resumes are stored in **Cloudflare R2**, not Supabase. Follow
[`R2_SETUP.md`](R2_SETUP.md) to create the bucket + API token + CORS, then set the four
`R2_*` env vars locally and on Vercel. (Avatars still use Supabase Storage.)

## 2b. Magic links (optional passwordless login)
Email OTP is on by default in Supabase, so the "Email me a magic link" button on the login screen works
out of the box. New users who arrive via a magic link pick their domain on first entry. No extra setup.

## 3. Auth settings
- **Authentication → Providers** → keep **Email** enabled.
- For quick testing: **Authentication → Sign In / Providers → Email** → turn **Confirm email** OFF (users log in instantly).
- For production: turn **Confirm email** back ON. The signup screen already handles the "check your email" flow.

## 4. Environment variables
Create `.env.local` in the project root (see `.env.example`):
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
```
On **Vercel** (main project) → Settings → Environment Variables → add the same two → redeploy.

## 5. Create admin accounts (no student signup needed)
Admins do **not** sign up through the student flow and have **no domain**. There's a
dedicated admin login at **`/portal/admin`**.

1. Supabase → **Authentication → Users → Add user** → create each founder account
   (email + password). Do this for every admin, e.g. `alirazaa.mxm@gmail.com` and
   `0zerodayreapers0@gmail.com`. (A profile row is auto-created with no domain.)
2. Supabase → SQL Editor, promote them:
   ```sql
   update public.profiles set role='admin'
   where email in ('alirazaa.mxm@gmail.com','0zerodayreapers0@gmail.com');
   ```
3. Admins log in at **`/portal/admin`** → the admin panel opens directly (move students
   between domains, ban/unban, delete messages, post announcements). They can also open
   the chat, where they see **all** domain rooms + the lobby for moderation.

> The older path still works too: if an admin happened to sign up as a student, the
> same `update … set role='admin'` promotes them; a non-admin who visits `/portal/admin`
> is refused.

---

## What's included
- **Auth**: email + password, signup with domain dropdown, forgot-password.
- **Chat**: last 200 messages + live realtime, per-domain rooms + a **General Lobby** everyone can use.
- **Identity**: display name + avatar (colored initials, or upload a photo — stored in the `avatars` bucket).
- **Presence & typing**: green dot for online members, "X is typing…" indicator.
- **Announcements**: admin-posted, everyone reads (collapsible banner in chat).
- **Admin panel**: move a student's domain, ban/unban (mutes their composer), post/delete announcements. Admins can also soft-delete any message inline in chat.
- **Safety**: RLS (students only ever read/post their own room + lobby, can't change their own domain/role/ban), rate limit (5 msgs / 10s).

## Local dev
```
npm install
npm run dev
```
Open http://localhost:3000/portal

## Domains
`offensive` · `defensive` · `cloud` · `grc` · `forensics` · `ai` (+ `lobby` for everyone).
