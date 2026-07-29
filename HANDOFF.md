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
  page.jsx                      # marketing homepage (services, internships, WhatsApp, CEO, testimonials, social/company links, contact)
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
  016_mentions.sql              # @mentions table + RLS + realtime (persistent mention inbox + beep)
  017_message_counts.sql        # admin-only RPCs: room_message_counts + global_message_counts (is_admin gated)
  018_submission_versioning.sql # submission_files history (version every attempt); submissions stays latest pointer
  019_bulk_approve.sql          # admin_bulk_approve_submissions(ids) RPC (audit-logged)
  020_task_extensions.sql       # task_extension_requests + admin_decide_extension RPC (student extra-time requests)
  021_security_hardening.sql    # OWASP fixes: public_profiles drops payment_proof_url; kicked_emails RLS (admin-only)
  022_admin_profile_edits.sql   # admin gender bypass on prevent_gender_update + admin_update_profile RPC
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
   then `012`, `013`, `014`, `015`, `016`, `017`, `018`, `019`, `020`, `021`, `022`, `023`, `024`, `025`, `026`, `027`, `028` (each idempotent; run all of them).
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

**Built 2026-07-27 batch (migrations 016–019 + client):**
- **@mentions (016):** autocomplete `@` picker in group chats; persistent mention inbox
  (unread bell, cleared on click); realtime Web-Audio beep when mentioned; `@Name` highlight.
- **Admin message counts (017):** per-room counts in the chat members sidebar (admin-only) +
  a global "Top contributors" leaderboard in the Admin panel (`room_message_counts` /
  `global_message_counts`, both `is_admin()`-gated SECURITY DEFINER).
- **Submission versioning (018):** every upload is kept — timestamped R2 keys
  (`submissions/{uid}/task-{taskId}-{ts}.ext`) + `submission_files` history; `submissions`
  remains the latest pointer for grading. Version-history dialogs for student + admin.
- **Admin bulk approve (019):** `admin_bulk_approve_submissions(ids)` + checkbox selection.
- **Extra-time requests (020):** students request more time per task (reason); admins Grant
  (new deadline = original due + N days) / Deny via `admin_decide_extension` (audit-logged).
  Student task card shows Pending/Granted/Denied and the overdue flag respects a granted extension.
- **Grade dialog:** canned-feedback presets + editable note (replaced `window.prompt`).
- **Workload dashboard:** per-domain pending/approved/rejected counts in the Admin panel.
- **6-week progress bar** in TasksScreen; **RAM tier badge** on student task cards.
- **DM typing indicator** (broadcast on `dm:{id}`).
- **First Blood:** first-ever approval of a task auto-posts an announcement.
- **R2 hardening:** per-kind file-type allowlist + max size + bound ContentType on
  upload-url; best-effort per-instance rate limiting on all `/api/r2/*` routes.
- **CAPTCHA:** Cloudflare Turnstile wired into `AuthScreen` (site key in code / env),
  verified end-to-end against Supabase. See `SECURITY_SETUP.md` §3.
- **Cosmetic:** dynamic `opengraph-image` for `/verify/[id]`; avatar status rings
  (admin red / alumni cyan).
- **Contact email** across site + portal is now `contact@zerodayreapers.me` (portfolio
  untouched). `PORTAL_SETUP.md` admin-account seed examples left as-is (login accounts, not contact).

**DONE (earlier phase-2 batch):**
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

**Approved to build next (owner decisions):** — ✅ all of the below were built in the
2026-07-27 batch (see §9). Kept here for the design rationale.
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

## 9c. Phase 3 — 2026-07-29 batch (Portal Feedback PDF)
Scope agreed with owner: (A) password UX, (B) signup Discord+Classroom gate, (C) Discord auto-join,
(D) email automation. **All four are code-complete + build-verified; C + D activate once the owner adds credentials.**

**Built (A — password UX, pure client):**
- `PasswordInput.jsx` — reusable field: show/hide toggle + live Caps-Lock warning. Used in
  `AuthScreen` (login + signup), `ProfileScreen` (change password), `AdminPanel` (change password).
- `AuthScreen` signup: password **strength meter** + requirements checklist **shown upfront**.
- Upload **success confirmation** toast in `TasksScreen` + `DocumentsScreen`.
- New **`DashboardScreen.jsx`** (nav tab in `ChatScreen`, `dashboard` view in `page.jsx`): progress %
  (approved/6), next-deadline live countdown, tiles (approved/pending/needs-changes/upcoming/late),
  computed badges, latest announcements + recent results. Reuses TasksScreen's task/submission/extension
  logic — RLS scopes tasks by domain+RAM. Alumni gated out like Tasks/Docs. Chat stays the default landing.

**Built (B — signup gate, no secrets):**
- `lib/classroom.js` — 18 hardcoded Classroom links keyed by domain `key` × RAM (from the TXT) + `DISCORD_INVITE`.
- `AuthScreen`: once Dept + RAM chosen, shows the matching Classroom link + "I've joined" checkbox, and a
  Discord step. **Create account disabled** until password valid + Classroom confirmed + Discord confirmed.
  Passes `classroom_confirmed` / `discord_id` / `discord_username` in signup metadata.
- **Graceful degrade (important):** Discord auto-join only activates when `NEXT_PUBLIC_DISCORD_CLIENT_ID`
  is set. Until then it falls back to **honor-mode** (invite link + checkbox) so **live signup never breaks**.
- Migration **`023_discord_and_classroom.sql`**: adds `discord_id` / `discord_username` /
  `classroom_confirmed` to `profiles`; extends the 015 `handle_new_user` + `protect_profile_columns`.
  ⚠ **Run 023 in Supabase.** (Safe to defer — until applied, the extra signup metadata is simply ignored;
  nothing breaks.)

**Built (C — Discord auto-join; inert until env set):** `/api/discord/start` + `/api/discord/callback`
(OAuth `identify guilds.join`, bot adds the user to the guild, popup posts result to the signup form).
Activate with `NEXT_PUBLIC_DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`,
`DISCORD_GUILD_ID` (numeric) + OAuth redirect `…/api/discord/callback` + bot in the server with
Create-Invite perm. Full guide: **`DISCORD_OAUTH_SETUP.md`**.

**Built (D — email automation; no-op until Resend + cron set):** shared `lib/email.js`,
`/api/email/broadcast` (admin, domain+RAM or all) + `/api/email/self` (student, own address only) +
`/api/cron/deadline-reminders` (service-role, de-duped). Client hooks: task-create → cohort;
**manual** announcement only → all (avoids the double-send, since global-task creation already inserts
an announcement); `admin_set_status` → selection result; graduate → certificate-ready; student upload
→ receipt. `024_email_reminders.sql` (de-dup marker) + `vercel.json` daily cron. Activate with a
**Resend verified domain** + `SUPABASE_SERVICE_ROLE_KEY` + `CRON_SECRET` (see `EMAIL_SETUP.md` §5).

## 9d. Phase 4 — 2026-07-29 batch (UX + engagement)
Owner-approved: modern polish (Portal only), simpler nav, Activity Timeline, Draft Save, Calendar,
Feedback/Rating (admin-approved → portal + marketing homepage; **portfolio deferred**). Build-verified.

- **Simpler nav:** `PortalMenu.jsx` — the portal header's button row is now the mentions bell + one
  **dropdown menu**. `ChatScreen` renders `<PortalMenu>`; `page.jsx` passes all `onOpen*` handlers.
- **Activity Timeline (`025`):** `activity_events` (RLS: read own) + `log_my_activity(type,meta)`
  SECURITY DEFINER. Client logs `login` (page.jsx, on SIGNED_IN, once/session) + `submission_created`
  (TasksScreen); DB triggers log `submission_graded` + `graduated`. `ActivityScreen.jsx` renders it.
- **Calendar (`025`):** `live_sessions` (admin write; dept-scoped read). `CalendarScreen.jsx` = month
  grid + agenda (task deadlines + sessions). Admins add/delete sessions in the Admin panel "Live Sessions".
- **Feedback/Rating (`026`):** `feedback` (program+portal stars + testimonial; **alumni** submit;
  pending→approved/rejected via `admin_set_feedback_status`, audit-logged) + `public_testimonials` view
  (anon-readable). `FeedbackScreen.jsx` (submit + view approved); Admin "Testimonials & Feedback" section
  approves; homepage `app/_components/Testimonials.jsx` shows approved reviews before the contact section.
- **Draft Save:** `lib/useDraft.js` (localStorage autosave hook) — wired into the Feedback testimonial
  box (reusable for other long-text forms).
- **Modern polish:** consistent card system on the new screens; `globals.css` adds smooth-scroll, an
  accessible keyboard focus ring, and reduced-motion support. No behavior change to existing screens.
- **Run migrations `025_activity_and_sessions.sql` + `026_feedback.sql`** (after 024).

## 9e. Phase 5 — 2026-07-29 batch (Security & Authentication)
Owner-approved. Build-verified. Already-existing pieces kept: admin 2FA (TOTP), audit log, RBAC via RLS,
CAPTCHA, forced-logout-on-password-change.

- **2FA both roles (existing Supabase TOTP):** enrollment in Profile is now **for all users** (opt-in for
  students). **Admins enforced** via `Require2FA.jsx` — `page.jsx` + `admin/page.jsx` block the panel until a
  verified factor exists (enrollment always reachable, so no lockout). **Student login** (`AuthScreen`) now
  does the TOTP challenge too (previously only `/portal/admin` did).
- **New-device email — all users (`027`):** `user_devices` table + `register_device(device_id,ua)` RPC
  (returns "is new" via `xmax=0`). On login (`page.jsx`, SIGNED_IN) the browser's localStorage `zdr_device_id`
  is registered; a new device → `emailSelf` alert + `new_device` activity event.
- **Security panel (Profile, all roles incl. admins):** Last Login (2nd-most-recent `login` activity event),
  Last Password Change (`profiles.password_changed_at`), Devices list + **"Log out everywhere"**
  (`signOut({scope:'global'})`), and **real per-device logout** — `revoke_device(device_id)` marks the row
  revoked; that device signs itself out via Realtime (`app/_components/SessionRevokeGuard.jsx`, mounted in
  layout). `register_device` clears `revoked_at` on re-login; `user_devices` has `replica identity full` +
  is in the realtime publication.
- **Password-change alert + marker:** Profile + Admin change-password now set `password_changed_at`, log a
  `password_changed` activity event, and `emailSelf` the user (on top of the existing global logout).
- **Idle auto-logout:** `lib/useIdleLogout.js` + `app/_components/IdleGuard.jsx` (mounted in `layout.jsx`) —
  signs out after **10 min** inactivity with a 1-min "still there?" warning. Inert without a session.
- **Brute force:** unchanged — relies on the existing CAPTCHA + Supabase rate limits (owner decision).
- **Run migration `027_security.sql`** (after 026).

## 9f. Phase 6 — 2026-07-30 (Trust & Professionalism — marketing homepage)
From the Portal Feedback PDF's "Trust & Professionalism" list. Goal: signal an active, genuine org. Pure
client (no migrations, no env). Build-verified.
- **Already covered:** admin-approved testimonials + intern reviews render on the homepage
  (§9d, `app/_components/Testimonials.jsx`) — this doubles as "Previous Intern Reviews".
- **Added this batch (`app/page.jsx`):** reusable `GitHubIcon` + `LinkedInIcon` inline SVGs (same style as
  `WhatsAppIcon`/`DiscordIcon`); constants `GITHUB`, `LINKEDIN_FOUNDER`, `LINKEDIN_COMPANY` at the top.
  - **Footer social bar:** LinkedIn (company page) + GitHub + Discord + WhatsApp icon links.
  - **CEO/Team section:** founder LinkedIn now reads from `LINKEDIN_FOUNDER` + a new GitHub button beside it.
  - Links used: GitHub `github.com/alee007-creator`, company LinkedIn `linkedin.com/company/134833925`,
    founder LinkedIn `linkedin.com/in/aliraza999`. Edit the constants to change them.
- **Deferred (owner will specify later):** additional **Mentor Profiles** (only the founder profile exists)
  and a dedicated **Success Stories** section (testimonials currently stand in). No Instagram/X/FB/YT handles
  provided yet — add more `*_Icon`s + constants + footer links the same way when they are.

## 9g. Phase 7 — 2026-07-30 (Extra security hardening — from feedback)
Feedback: cyber students will probe the portal, so tighten it. **Audit found 8 of 9 items already
covered; the one real gap was HTTP security headers.** Pure config/doc change, build-verified.
- **Added — Security headers (`next.config.mjs`):** `async headers()` sends HSTS (2y, includeSubDomains,
  preload), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geo/topics off), `X-DNS-Prefetch-Control`,
  and a **base CSP** (`base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'
  https://api.web3forms.com`). Also `poweredByHeader: false`. **CSP is a deliberate safe subset** — it does
  NOT set `script-src`/`connect-src`/`img-src`, so it can't break Turnstile/Supabase/R2. Full nonce-based CSP
  is documented as a follow-up in `SECURITY_SETUP.md` §5.
- **Already covered (verified in this audit, no change):**
  - *CSRF* — APIs auth via Supabase **bearer JWT** (header, localStorage session, not cookies) → cookie-CSRF N/A;
    Discord OAuth uses a validated `httpOnly`+`secure`+`sameSite` `state` cookie.
  - *File-upload + server-side validation* — `/api/r2/upload-url` type/size/ContentType + per-uid keys;
    `download-url`/`delete` gate via `ownsKey()`; every API route checks auth (`getAuthedUser` / admin role /
    `CRON_SECRET`); RLS validates all DB writes.
  - *CAPTCHA* — Turnstile on **every** auth action (not just after failures) + Supabase auth rate limits.
  - *Encryption* — TLS everywhere (HSTS-reinforced) + at-rest via Supabase/R2.
  - *Password storage* — Supabase Auth bcrypt; app never stores raw passwords; 12-char policy.
  - *Access control* — RLS + `is_admin()` + SECURITY DEFINER RPCs + `Require2FA` (admins) + per-uid R2 keys.
- **Minor known tradeoff (unchanged):** `/api/cron/deadline-reminders` accepts the `CRON_SECRET` via header
  **or** `?secret=` query (query form can appear in logs) — kept for manual triggering; Vercel Cron uses the header.

## 9h. Phase 8 — 2026-07-30 (Founder tier — super-admin over admins)
Owner wanted an account that works exactly like admin **plus** can delete/ban/edit **admin** accounts.
Build-verified. **Run migration `028_founder_role.sql` (after 027)**, then create the founder (SQL below).
- **Model:** a founder is `role='admin'` **+ `is_founder=true`** — inherits every admin capability
  automatically (no per-RPC changes). Extra power over admins is gated on `is_founder`.
- **`028_founder_role.sql`:**
  - Adds `profiles.is_founder` + `public.is_founder()` helper.
  - **Fixes the "can't delete an admin" bug:** `submissions.graded_by`, `task_extension_requests.decided_by`,
    `live_sessions.created_by`, `feedback.approved_by` were FKs to `profiles(id)` with the default
    (blocking) ON DELETE → now `on delete set null`. (These columns only ever hold an admin's id, which is
    why *students* deleted fine but *admins* didn't — from the app **and** the Supabase dashboard.)
  - Extends `protect_profile_columns`: only a founder may grant/revoke `is_founder` (blocks admin
    self-escalation); a non-founder admin can't modify another admin/founder's protected columns.
  - New `before delete on profiles` trigger `guard_staff_delete`: only a founder can delete an admin;
    a **founder can't be deleted via the app** (remove by SQL — avoids top-tier lockout). `auth.uid()` null
    (SQL editor / dashboard / service role) bypasses both — that's the escape hatch.
- **UI (`AdminPanel.jsx`):** `is_founder` added to the members query + `me`; helpers `iAmFounder` /
  `canManageAdmin(m)` / `canModerate(m)`. Admin rows now show **Ban/Unban + Edit + Delete** *only* when the
  viewer is a founder (never on another founder or your own row). "👑 Founder" badge + "Founder" role label.
  `admin/page.jsx` `me` select now includes `is_founder`.
- **Create a founder (Supabase SQL editor, once):**
  `update public.profiles set role='admin', is_founder=true where lower(email)=lower('FOUNDER_EMAIL');`
- **Not built (offered):** founder-driven role promotion (student↔admin) from the UI — currently done via SQL.

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
