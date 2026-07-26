# ZeroDay Reapers — Project Handoff

Handoff doc for any AI coding tool (Claude Code, Google Antigravity/Gemini, Cursor, etc.)
picking up this repo. Read this first, then the referenced files. Keep it updated as you work.

Repo: https://github.com/ahmad5087/ZeroDay_Reapers_Website
Live: https://zerodayreapers.me · Portal: /portal · Admin: /portal/admin

---

## 1. What this project is
A cybersecurity company site + a Supabase-backed **internship portal** (community chat,
task submissions, admin panel) + a personal **portfolio** app. Three deployables from one repo.

## 2. Architecture & stack
- **Main site + portal:** Next.js 16 (App Router), React 19, Tailwind CSS **v3** (JS config), JSX.
  Deployed on Vercel (root directory `.`). Domain `zerodayreapers.me`.
- **Portfolio:** separate Next.js app in `portfolio/`, Tailwind **v4**, TypeScript. Its own
  Vercel project (root directory `portfolio`, `basePath: /portfolio`). Served at
  `zerodayreapers.me/portfolio` via a rewrite in `next.config.mjs` (env `PORTFOLIO_URL`).
  Kept separate because the two Tailwind majors don't co-exist in one app.
- **Backend:** Supabase (Postgres + Auth + Realtime). Files (task PDFs + resumes) on
  **Cloudflare R2** (S3-compatible), avatars on Supabase Storage.
- **Brand tokens:** blood red `#e10600` / glow `#ff1a1a`, ink black `#050505`, monospace
  headings, red glow. Tailwind custom colors `blood`, `ink` in `tailwind.config.js`.

## 3. Directory map
```
app/
  page.jsx                      # marketing homepage (services, internships, WhatsApp, CEO, contact)
  verify/page.jsx               # certificate search
  verify/[id]/page.jsx          # certificate result (QR target)
  portal/
    page.jsx                    # orchestrator: auth gate → chat | tasks | docs | admin
    admin/page.jsx              # dedicated admin login (login-only) → AdminPanel
    _lib.js                     # domain colors, initials, avatar color, time fmt
    _components/
      AuthScreen.jsx            # signup(domain)/login/forgot/magic-link; 12-char pw policy
      ChatScreen.jsx            # per-domain + lobby chat, realtime, presence, typing, ann tab
      AnnouncementsChannel.jsx  # admin-post feed, everyone reacts (no replies), persistent
      TasksScreen.jsx           # student: view tasks, upload submission (R2), see grade
      DocumentsScreen.jsx       # student: resume + other docs (R2)
      DMScreen.jsx              # student<->admin DMs (shared admin inbox); students can't DM each other
  avatar/                       # source PNGs for default avatars (resized → public/avatars/*.webp)
      AdminPanel.jsx            # members(domain/ban/timeout/resume), tasks, submissions, announcements, my profile
  api/r2/
    upload-url/route.js         # presigned PUT (auth + own-folder key)
    download-url/route.js       # presigned GET (auth + ownsKey/admin)
    delete/route.js             # delete object (auth + ownsKey/admin)
lib/
  supabase.js                   # browser Supabase client (NEXT_PUBLIC_*)
  r2.js                         # server R2 (S3) client + presign + getAuthedUser + ownsKey
  r2client.js                   # browser helpers → call /api/r2/* with Supabase JWT
data/certificates.json          # certificate verification records
supabase/
  schema.sql                    # base: domains, profiles, messages, announcements(+reactions),
                                #   lobby room, avatars bucket, RLS, triggers, realtime, timeouts
  002_tasks_and_security.sql    # tasks, submissions, documents, PII lockdown (public_profiles view), is_admin()
  003_gender_and_dm.sql         # gender + default avatar on signup; dm_messages (student<->admin) + RLS
public/avatars/male.webp, female.webp  # default avatars by gender (resized from app/portal/avatar/*.png)
portfolio/                      # separate portfolio app (see its own files)
R2_SETUP.md · PORTAL_SETUP.md · DISCORD_SETUP.md · README.md · HANDOFF.md (this)
```

## 4. Environment variables
Main project (`.env.local` + Vercel):
```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co     # bare URL, NO /rest/v1
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
R2_ACCOUNT_ID=...            # server-only
R2_ACCESS_KEY_ID=...         # server-only
R2_SECRET_ACCESS_KEY=...     # server-only
R2_BUCKET=zdr-portal         # server-only
PORTFOLIO_URL=https://<portfolio-project>.vercel.app       # for /portfolio rewrite
```
Portfolio project: none required.
Never commit `.env.local`. Never put R2 secrets or Supabase service_role in client code.

## 5. Data model (Supabase)
- `domains` — 6 internship domains + `lobby`. Readable by anon (signup dropdown).
- `profiles` — one per auth user. `role` student|moderator|admin, `domain_id`, `banned`,
  `timeout_until`, `gender` (male|female), `avatar_url`. Signup trigger sets a default avatar
  (`/avatars/male.webp` | `/avatars/female.webp`) from gender; users can upload a custom one.
  **PII lockdown:** base table readable only by owner+admin; everyone reads names/avatars via
  the `public_profiles` VIEW.
- `dm_messages` — student↔admin direct messages (shared admin inbox: one thread per student, all
  admins participate). RLS makes student↔student DMs impossible; students only write their own
  thread, admins write any.
- `messages` — chat, per `domain_id` (+ lobby). Soft-delete via `deleted`. Rate-limited 5/10s.
- `announcements` + `announcement_reactions` — admin-post feed, everyone reacts.
- `tasks` — admin-created, per-domain or global, `week`, `due_at`.
- `submissions` — one per (task,user); `file_path` = **R2 key**; `status` submitted|approved|rejected;
  student edits re-queue (trigger). Admin grades.
- `documents` — resumes/other; `file_key` = **R2 key**.
- Helpers: `is_admin()`, admin RPCs `admin_set_domain/ban/timeout`.
- Security model: RLS everywhere; students only read/post own domain+lobby, can't change their
  own role/domain/ban/timeout; admins bypass via `is_admin()` / SECURITY DEFINER RPCs.

## 6. File storage flow (R2)
Browser never holds R2 secrets. `lib/r2client.js` gets the Supabase JWT → calls `/api/r2/*`
→ server (`lib/r2.js`) verifies the JWT, checks the key is in the caller's own `{uid}/` folder
(or admin), returns a 5-min presigned URL → browser PUTs/GETs directly to R2.
Keys: `submissions/{uid}/task-{taskId}.ext`, `documents/{uid}/resume.ext`, `documents/{uid}/<ts>-<name>`.

## 7. Setup checklist (fresh env)
1. `npm install`
2. Supabase: run `supabase/schema.sql`, then `002_tasks_and_security.sql`, then `003_gender_and_dm.sql`.
3. R2: follow `R2_SETUP.md` (bucket + token + CORS).
4. Set env vars (section 4) locally + Vercel; redeploy.
5. Create admins in Supabase Auth → `update public.profiles set role='admin' where email in (...)`.
6. Admins log in at `/portal/admin`; students sign up at `/portal`.

## 8. DONE so far
- Marketing site: hero, 6 services, internships (6 depts), WhatsApp community + 6 group links,
  Discord, CEO section, Web3Forms contact, footer. Certificate verify at `/verify` + `/verify/[id]`.
- Portfolio at `/portfolio` (rethemed, smooth scroll, LinkedIn content).
- Portal:
  - Auth: email+password (12-char strong policy w/ live checklist), magic-link option, forgot-pw.
  - Chat: per-domain rooms + lobby, realtime, presence (online dots), typing indicator, avatars.
  - Announcements channel: admin-post, react-only, persistent history.
  - Dedicated admin login `/portal/admin`; admins skip domain, see/moderate all rooms.
  - Admin panel: members (domain move, ban, **timeout** 5m–24h, resume view), tasks CRUD,
    submissions review (download from R2 + approve/reject + feedback), announcements CRUD, my profile.
  - Task submissions + grading (R2). Documents/resume upload (R2). PII lockdown.
  - Signup requires gender (Male/Female) → sets a default avatar; custom upload overrides it.
  - Direct messages: students message admins (shared inbox), admins DM any individual; no student↔student DMs.
- Ops: git author fixed to `2022-d-pharm-5087@tuf.edu.pk` (Vercel author-block fix).

## 9. TODO / NEXT (Phase 2 — not built yet)
- **Admin 2FA (TOTP)** — Supabase MFA enroll + challenge UI for `/portal/admin`. Highest security ROI.
- **Admin audit log** — table `admin_actions` + log inside admin RPCs (ban/timeout/domain/delete) + panel view.
- **Certificate auto-issue** — when all of a student's 6 tasks are `approved`, generate a cert ID and
  append to `data/certificates.json` (or move certs to a DB table) so `/verify` resolves it.
- **Email notifications** — task graded / new announcement, via Resend (free tier) + Supabase triggers/functions.
- **Server-side password policy** — mirror the 12-char rule in Supabase Auth settings (dashboard).
- **Report-message button** + optional profanity filter (client stub exists in the original spec).
- **Rate-limit signups** — enable Supabase CAPTCHA/hCaptcha on auth to stop bot signups.
- **Storage growth** — R2 free 10 GB covers ~1,000+ students; beyond that it's $0.015/GB-mo.
  Optional: self-host Supabase on Raspberry Pi (Docker + Cloudflare Tunnel + SSD + backups) — infra only, code unchanged.

## 10. Suggestions / gotchas for whoever continues
- **Tailwind:** main app is v3 (edit `tailwind.config.js`); portfolio is v4 (`@theme` in globals.css). Don't mix.
- **Supabase URL** must be the bare project URL — a trailing `/rest/v1` causes doubled paths / 404s.
- **RLS recursion:** don't reference `profiles` inside a `profiles` policy directly — use `is_admin()` (SECURITY DEFINER).
- **Realtime re-runs:** `alter publication ... add table` errors if already added — the schema wraps it in an
  idempotent `DO` block. Keep new realtime tables idempotent too.
- **Profile role changes via SQL editor:** `auth.uid()` is null there; the protect trigger bypasses when null so
  server-side/admin SQL edits work. Client edits stay locked.
- **R2 CORS:** browser PUT needs the bucket CORS to allow your origin (see R2_SETUP.md). 404/blocked upload = missing CORS.
- **Commits:** author email must be `2022-d-pharm-5087@tuf.edu.pk` or Vercel blocks the deploy
  ("commit author did not have contributing access").
- **Verify before shipping:** `npx next build` at repo root (main) and in `portfolio/`.
- **Idempotent SQL:** both schema files are safe to re-run; prefer `create ... if not exists` / `drop policy if exists`.
