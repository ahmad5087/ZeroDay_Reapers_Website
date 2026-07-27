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
      ChatScreen.jsx            # per-domain + lobby chat, realtime, presence, typing, ann tab (Docs tab hidden for admin)
      AnnouncementsChannel.jsx  # admin-post feed, everyone reacts (no replies), persistent
      TasksScreen.jsx           # student: view tasks (download R2 PDF), upload submission (R2), see grade
      DocumentsScreen.jsx       # student: resume + other docs (R2)
      DMScreen.jsx              # student<->admin DMs (shared admin inbox); students can't DM each other
  avatar/                       # source PNGs for default avatars (resized → public/avatars/*.webp)
      AdminPanel.jsx            # members(domain/ban/timeout; no resume), tasks(+R2 attach PDF & auto-announcements), submissions(Department/Domain wise + filter), announcements, my profile
  api/r2/
    upload-url/route.js         # presigned PUT (auth + own-folder key or admin task-pdf)
    download-url/route.js       # presigned GET (auth + ownsKey/admin/tasks read)
    delete/route.js             # delete object (auth + ownsKey/admin write)
lib/
  supabase.js                   # browser Supabase client (NEXT_PUBLIC_*)
  r2.js                         # server R2 (S3) client + presign + getAuthedUser + ownsKey(read/write options)
  r2client.js                   # browser helpers → call /api/r2/* with Supabase JWT
data/certificates.json          # certificate verification records
supabase/
  schema.sql                    # base: domains, profiles, messages, announcements(+reactions),
                                #   lobby room, avatars bucket, RLS, triggers, realtime, timeouts
  002_tasks_and_security.sql    # tasks(+file_path/file_name), submissions, documents, PII lockdown (public_profiles view), is_admin()
  003_gender_and_dm.sql         # gender + default avatar on signup; dm_messages (student<->admin) + RLS
  004_task_attachments.sql      # tasks.file_path / file_name (R2 PDF attachments)
  005_admin_delete_and_approval.sql # status (pending/approved/rejected), admin_delete_user, admin_set_status
  006_kicked_emails_and_payment_proof.sql # kicked_emails, payment_proof cols, Week-4 unpaid auto-remove
  007_alumni_and_retention.sql  # is_alumni, Alumni Group, (auto-graduate trigger — REMOVED in 013), 75-day cleanup
  008_automod_and_uncapped_chat.sql # automod trigger (NSFW→remove+10min timeout), admin delete policies, uncapped history
  009_link_approval_and_pinning.sql # messages.link_status (non-admin links pending), is_pinned/pinned_at on msgs/anns/dms
  010_immutable_gender.sql      # gender immutable once set (even for admins)
  011_fixes.sql                 # CORRECTIVE (required): 007 student_id/file_key→user_id/file_path; restore gender+avatar
                                #   in handle_new_user; Week-4 purge INSERT-only
  012_preview_functions.sql     # read-only audit_unpaid_preview() + cleanup_75day_preview() (delete nothing)
  013_manual_graduation_and_fee_confirm.sql # drop auto-graduate (Alumni=manual); payment_confirmed + admin_set_payment_confirmed
  014_audit_log_and_reports.sql # admin_actions (every admin RPC logs) + message_reports; log_admin_action()
  015_ram_specs.sql             # profiles.ram + tasks.ram (8/16/24GB); tasks_read filters by RAM; admin_set_ram
public/avatars/male.webp, female.webp  # default avatars by gender (resized from app/portal/avatar/*.png)
portfolio/                      # separate portfolio app (see its own files)
app/portal/_components/ProfileScreen.jsx  # student/admin profile edit; admin 2FA enroll; student payment-proof upload
app/api/notify/route.js         # admin→student email via Resend (task graded); lib/notify.js is the client helper
Docs: R2_SETUP · PORTAL_SETUP · DISCORD_SETUP · EMAIL_SETUP · SECURITY_SETUP · TESTING · README · HANDOFF (this)
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
RESEND_API_KEY=re_...        # server-only — email notifications (see EMAIL_SETUP.md); if unset, emails silently skipped
RESEND_FROM=ZeroDay Reapers <onboarding@resend.dev>   # server-only
PORTFOLIO_URL=https://<portfolio-project>.vercel.app       # for /portfolio rewrite
```
Portfolio project: none required.
Never commit `.env.local`. Never put R2 secrets, RESEND_API_KEY, or Supabase service_role in client code.

## 5. Data model (Supabase)
- `profiles` — one per auth user. `role` student|moderator|admin, `domain_id`, `banned`,
  `timeout_until`, `gender` (male|female, immutable), `avatar_url`, `status` (pending|approved|rejected),
  `payment_proof_url`, `payment_proof_submitted_at`, `payment_confirmed` (admin flag),
  `is_alumni`, `ram` (8GB|16GB|24GB — set at signup, immutable for students, admin-changeable via `admin_set_ram`).
  Signup trigger (`handle_new_user`, canonical version in 011/015) sets default avatar from gender + status from `kicked_emails`.
  **PII lockdown:** base table readable only by owner+admin; everyone reads names/avatars via the `public_profiles` VIEW.
  Column protection: `protect_profile_columns` trigger stops students changing role/domain/ban/timeout/status/is_alumni/payment_confirmed/ram (admins bypass; SQL-editor bypass when auth.uid() is null).
- `kicked_emails` — logs emails of accounts deleted/kicked by admins or auto-removed for non-payment. If a user registers again with a logged email, their account is set to `pending` instead of `approved`.
- `domains` — 6 internship domains + `lobby` + `alumni` (Alumni Group). Readable by anon.
- `dm_messages` — student↔admin direct messages (shared admin inbox: one thread per student, all
  admins participate). RLS makes student↔student DMs impossible; students only write their own
  thread, admins write any.
- `messages` — chat, per `domain_id` (+ lobby). Soft-delete via `deleted`. Rate-limited 5/10s.
- `announcements` + `announcement_reactions` — admin-post feed, everyone reacts.
- `tasks` — admin-created, per-domain or global, `week`, `due_at`, `file_path`/`file_name` (R2 task PDF),
  `ram` (8/16/24GB tier or null=all). `tasks_read` RLS filters by student's domain AND ram. Creating a task
  auto-posts an announcement to the domain chat (`messages`) or global `announcements`.
- `submissions` — one per (task,user); `file_path` = **R2 key** (`submissions/{uid}/task-{taskId}.ext`, overwrites);
  `status` submitted|approved|rejected; `graded_by`/`graded_at`/`feedback`; student edits re-queue (trigger). Admin grades.
  ⚠️ Two FKs to profiles (`user_id`, `graded_by`) → embeds MUST disambiguate, e.g. `profiles!submissions_user_id_fkey(...)`.
- `documents` — resumes/other; `file_key` = **R2 key**.
- `admin_actions` — audit log; every admin RPC calls `log_admin_action(...)`. Admin-read only. Panel view.
- `message_reports` — student reports a message; admin reviews/resolves in the panel.
- Helpers: `is_admin()`, `log_admin_action()`. Admin RPCs (all log to audit): `admin_set_domain/ban/timeout/status/alumni/payment_confirmed/ram`, `admin_delete_user`, `audit_unpaid_interns`, `cleanup_75day_intern_data`, `admin_set_ram`. Read-only previews: `audit_unpaid_preview()`, `cleanup_75day_preview()`.
- Security model: RLS everywhere; students only read/post own domain+lobby, can't change protected columns; admins bypass via `is_admin()` / SECURITY DEFINER RPCs. Automod (008) + link approval (009) + 5/10s rate limit enforce chat hygiene.

## 6. File storage flow (R2)
Browser never holds R2 secrets. `lib/r2client.js` gets the Supabase JWT → calls `/api/r2/*`
→ server (`lib/r2.js`) verifies the JWT, checks the key is in the caller's own `{uid}/` folder
(or admin, or read-only access for `tasks/`), returns a 5-min presigned URL → browser PUTs/GETs directly to R2.
Keys: `tasks/week-{week}-{ts}-{name}` (admin task PDF), `submissions/{uid}/task-{taskId}.ext`, `documents/{uid}/resume.ext`, `documents/{uid}/<ts>-<name>`.

## 7. Setup checklist (fresh env)
1. `npm install`
2. Supabase: run in order `supabase/schema.sql`, `002`…`010`, then **`011_fixes.sql`** (corrective — required),
   then `012`, `013`, `014`, `015` (each idempotent; run all of them).
   - `011` fixes: submissions column refs in 007 (`student_id`/`file_key` → `user_id`/`file_path`, which broke
     the auto-graduate trigger + 75-day cleanup), restores gender + default avatar in `handle_new_user`
     (006 had dropped them), and makes the Week-4 unpaid purge fire on INSERT only (was INSERT-or-UPDATE →
     any task edit re-ran a mass account delete).
   - `012` adds `audit_unpaid_preview()` and `cleanup_75day_preview()` — report what *would* be deleted, delete nothing.
   - `013` removes auto-graduation (Alumni is now manual via the Graduate button only) and adds an admin
     **fee-confirmation** flag (`payment_confirmed` + `admin_set_payment_confirmed`). Week-4 purge still targets
     students with no proof uploaded; `payment_confirmed` is a review marker only.
   - `014` adds the **admin audit log** (`admin_actions` + logging inside every admin RPC) and **message reports**
     (`message_reports`), both surfaced in the Admin panel.
   - `015` adds **RAM specs**: `profiles.ram` (8/16/24GB, chosen at signup, immutable for students, admin-changeable
     via `admin_set_ram`) and `tasks.ram` (tag a task to a RAM tier or leave null = all). `tasks_read` RLS now also
     filters by the student's RAM, so students only see tasks for their tier + untagged ones.
   - See `TESTING.md` for how to verify every fix + safely test the destructive features.
   - `SECURITY_SETUP.md` — dashboard toggles (enable TOTP for 2FA, server password policy, CAPTCHA, email confirm).
   - `EMAIL_SETUP.md` — Resend API key for task-graded emails (`RESEND_API_KEY` / `RESEND_FROM`).
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
  - Admin panel: members (domain move, ban, **timeout** 5m–24h), tasks CRUD,
    submissions review (download from R2 + approve/reject + feedback; **grouped Department/Domain wise** with interactive dropdown filter), announcements CRUD, my profile.
  - Task submissions + grading (R2). Documents/resume upload (R2 for students; removed from admin portal).
  - **Task PDF Attachments (R2):** Admins attach PDF/doc instructions when creating tasks; students download them via a dedicated "Download Task PDF" button in the Tasks tab.
  - **Automated Task Announcements:** Creating a task for a specific department automatically posts an announcement in that department's chat room (`messages`); creating a global task posts to the global Announcements feed.
  - **Admin Portal Resume Cleanup:** Removed Resume/CV upload and viewing features from the Admin portal (removed from Members list and hid the Docs tab for admins in navigation) since admins do not need a Resume/CV.
  - **Dynamic Email Redirects:** Passed explicit `emailRedirectTo: window.location.origin + "/portal"` during signup and magic link requests to prevent confirmation links from defaulting to `http://localhost:3000`.
  - **Global Online Presence & Admin Visibility:** Migrated online presence tracking to a portal-wide channel (`portal-presence`) in `page.jsx` so users show online across all screens, updated `ChatScreen.jsx` members query (`q.or("domain_id.eq..." + ",role.eq.admin")`) so Administrators are included in every department room, and split the right sidebar into two distinct sections: **Admins** (highlighted in blood red) and **Members** (intern candidates).
  - **Admin Account Deletion & Approval Workflow:** Added `admin_delete_user` and `admin_set_status` RPCs (migration `005_admin_delete_and_approval.sql`). Admins can permanently delete any member account from the Admin panel; deleted users who re-register start with `status = 'pending'`, triggering a dedicated "Account Pending Approval" screen upon login until an Admin accepts or rejects them from the "Pending Account Approvals" card in the Admin panel.
  - **Intern Profile Editing:** Intern candidates can edit their own profile (display name, full name, gender, custom avatar) directly from the Profile screen.
  - **Kicked/Deleted Re-Registration Gating:** When an admin deletes/kicks a user via `admin_delete_user`, their email is permanently logged in `kicked_emails`. If they register again with the same email, their account is marked `pending` (requiring admin approval), whereas brand new users are initially `approved` automatically!
  - **Fee Payment Proof & Week 4 Automated Removal:** Students must upload a fee payment screenshot in their Profile screen during weeks 1–3. When Week 4 tasks are published (or when an admin triggers the manual Week 4 Audit button in the Admin Panel), all unpaid intern accounts are automatically purged and logged in `kicked_emails`.
  - **Alumni Graduation & 75-Day Retention Cleanup:** When an intern reaches 6 approved task submissions, a PostgreSQL database trigger (`trg_auto_graduate`) automatically sets `is_alumni = true` (admins can also manually graduate/revoke Alumni status). Alumni lose access to domain rooms and the general lobby, gaining exclusive access to the **Alumni Group** and Announcements. An admin cleanup button runs `cleanup_75day_intern_data()`, which purges deliverables (submissions, documents, messages, payment proofs) older than 75 days while preserving intern accounts and admin records, and deletes archived files from Cloudflare R2.
  - Signup requires gender (Male/Female) → sets a default avatar; custom upload overrides it.
  - Direct messages: students message admins (shared inbox), admins DM any individual; no student↔student DMs.
  - **Manual graduation + fee confirm (013):** Alumni is manual-only (Graduate button); admin "Confirm Fee" flag.
  - **Audit log + reports (014):** every admin action logged; students report messages; both in the Admin panel.
  - **Admin 2FA (optional, TOTP):** enroll in Profile; code challenge at `/portal/admin` login (needs TOTP enabled in dashboard).
  - **Email on task graded (Resend):** `/api/notify`, best-effort; add `RESEND_API_KEY` per `EMAIL_SETUP.md`.
  - **RAM specs (015):** RAM chosen at signup (8/16/24GB), tasks tagged per RAM tier, `tasks_read` filters by RAM.
  - **Automod / link approval / pinning (008/009):** NSFW auto-removal + 10-min timeout; non-admin links held for approval; pin messages.
  - Nav "Portal" link temporarily hidden on the marketing site (route still live at `/portal`).
- Ops: git author fixed to `2022-d-pharm-5087@tuf.edu.pk` (Vercel author-block fix).

## 9. Phase 2 — status
**DONE (this batch):**
- **Admin 2FA (TOTP)** — optional per admin. Enroll in Profile → Two-Factor Authentication; code prompt at
  `/portal/admin` login. Needs TOTP enabled in the dashboard (see `SECURITY_SETUP.md`).
- **Admin audit log** — `admin_actions` (014), every admin RPC logs; viewable in the Admin panel.
- **Email notifications** — task graded emails via Resend (`/api/notify`); add the key per `EMAIL_SETUP.md`.
- **Report-message button** — students report messages; admins review in the Admin panel. Profanity/NSFW
  AutoMod already lived in `008` + `_lib.js`.
- **Server-side password policy** & **CAPTCHA signups** — dashboard-only; steps in `SECURITY_SETUP.md`
  (CAPTCHA also needs a small `AuthScreen` widget wire-up once a provider/site-key is chosen).

**NOT built (intentionally deferred):**
- **Certificate auto-issue** — when 6 tasks approved, mint a cert ID into `data/certificates.json` (or a DB
  table) so `/verify` resolves it.
- **Storage growth** — R2 free 10 GB covers ~1,000+ students; beyond that $0.015/GB-mo, or self-host Supabase
  on the Pi (infra only, code unchanged).

## 9b. Backlog — requested TODOs (NOT built; owner decisions recorded)
Owner reviewed a TODO list on this handoff. Status + decisions:

**Already done (do NOT rebuild):** `admin_actions` table + RLS (014); all destructive RPCs log to audit (014);
admin 2FA TOTP (optional); `/api/r2/download-url` path validation (`ownsKey` blocks peers' folders already);
`tasks.ram` covers the "lab requirement" idea (015).

**Approved to build next (owner decisions):**
- **Submission versioning** — owner wants **version every attempt** (timestamped R2 keys +
  a `submissions` history, not overwrite). This is a schema change: likely a new `submission_files`
  child table (submission_id, file_key, file_name, uploaded_at) or drop the (task_id,user_id) unique and
  keep many rows; keep "latest" pointer for grading. Key pattern: `submissions/{uid}/task-{taskId}-{ts}.ext`.
- **Admin bulk approve** — `admin_bulk_approve_submissions(ids uuid[])` RPC (SECURITY DEFINER, admin-gated,
  logs to audit) + checkbox selection in AdminPanel submissions.
- **Canned feedback dropdown** in the grade prompt (a short preset list; store as a const or a tiny table).
- **Workload dashboard** — counts of pending/approved/rejected per domain (a grouped query on `submissions`).
- **6-week progress bar** in `TasksScreen` (approved count / 6).
- **DM typing indicator** — reuse the broadcast pattern already in `ChatScreen` (presence/broadcast on a `dm:{id}` channel).
- **"First Blood"** — on first approval of a task, post an announcement (client-side after grade, or a DB trigger).
- **Cosmetic:** streak avatar borders; humor in empty states (keep tasteful — cybersecurity/PK audience);
  OG images for `/verify/[id]` via Next `opengraph-image`/`ImageResponse`.
- **R2 hardening:** enforce ContentLength/ContentType in `/api/r2/upload-url`; rate-limit the R2 routes
  (Upstash Redis or Vercel KV — free tiers). RAM/lab badges on student task cards.

**Owner decisions:** 2FA stays **optional** (not enforced). **No separate `lab_requirement`** column —
`tasks.ram` is sufficient (just add a RAM badge on student task cards). Submissions → **version every attempt**.

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
