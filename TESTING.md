# Portal — Manual Test Guide

How to verify the fixes and the risky/destructive features yourself. Run
`011_fixes.sql` then `012_preview_functions.sql` in the Supabase SQL Editor first.

All the `select pg_get_functiondef(...)` / `information_schema` queries below are
**read-only** — safe to run anytime.

---

## C1 — Task submissions work again (was broken)
**SQL proof (read-only):** confirm the trigger now uses `user_id`, not `student_id`:
```sql
select pg_get_functiondef('public.auto_graduate_on_6_tasks'::regproc);
```
→ the body should say `where user_id = new.user_id`. No `student_id` anywhere.

**End-to-end (real test):**
1. Log in as a **student** → **Tasks** tab → upload a submission for any task.
   - Before 011: the insert errored (`column ... student_id does not exist`).
   - After 011: it saves and shows "submitted".
2. Log in as **admin** → **Submissions** → **Approve** it → no error.
3. (Optional graduation test) Approve 6 tasks for one student → that student's
   `is_alumni` flips true:
   ```sql
   select display_name, is_alumni from public.profiles where email = 'STUDENT_EMAIL';
   ```

## C2 — Gender + default avatar are set at signup (was dropped)
**SQL proof (read-only):** confirm the signup trigger inserts gender + avatar:
```sql
select pg_get_functiondef('public.handle_new_user'::regproc);
```
→ the INSERT column list should include `gender` and `avatar_url`, with the
`case ... '/avatars/male.webp' / '/avatars/female.webp'` block.

**End-to-end (real test):**
1. Sign up a throwaway account, pick **Male**, finish signup.
2. Check the row:
   ```sql
   select email, gender, avatar_url from public.profiles where email = 'TEST_EMAIL';
   ```
   → `gender = male`, `avatar_url = /avatars/male.webp`. Repeat with Female.
3. In chat, the new user's avatar shows the boy/girl image (not initials).
4. Clean up: delete the test account (Supabase → Authentication → Users → delete),
   or use the admin panel's delete.

## C3 — Week-4 purge only fires on task INSERT (not on edits)
**SQL proof (read-only):** check which events fire the trigger:
```sql
select event_manipulation
from information_schema.triggers
where trigger_name = 'trg_week4_unpaid_removal';
```
→ After 011 this returns **only `INSERT`** (before it returned `INSERT` *and* `UPDATE`).

**Safe behavioral test:** do NOT create a real week-4 task to test the purge — use the
preview instead (see M3 below). Editing a week-4 task after 011 no longer deletes anyone.

---

## M3 — Who would the Week-4 unpaid purge remove? (safe preview)
```sql
select * from public.audit_unpaid_preview();
```
→ Lists every non-admin account with **no payment proof** — exactly who
`audit_unpaid_interns()` / the Week-4 trigger would delete. Deletes nothing.
Only run the real `select public.audit_unpaid_interns();` when you truly intend to purge.

## M4 — What would the 75-day cleanup delete? (safe preview)
```sql
select public.cleanup_75day_preview();
```
→ Returns counts of submissions/documents/messages/dm_messages older than 75 days
plus a sample of the R2 keys that would be removed. Deletes nothing.
Only run the real `select public.cleanup_75day_intern_data();` when you intend to purge.

## M5 — Moderation (AutoMod) works and client/DB lists match
**Real test:**
1. As a **student**, send a chat message containing a banned word.
   → It's replaced by "⚠️ [Message removed by AutoMod …]" and you get a 10-minute timeout.
2. Confirm the timeout landed:
   ```sql
   select display_name, timeout_until from public.profiles where email = 'STUDENT_EMAIL';
   ```
3. As a **student**, send a message with a link (e.g. `example.com`).
   → With migration 009 it's marked `pending` for admin approval.
4. Admins are exempt — the same words/links from an admin post normally.

**List-sync check (read-only):** the client list (`app/portal/_lib.js` `BANNED_REGEX`)
and the DB list (`automod_check_message` in `008`) must stay identical. They match today;
if you edit one, edit the other.

---

## General: which migrations are applied?
Quick probes (domains are anon-readable; column probes error if the column is missing):
```sql
select key from public.domains order by sort;                 -- 'alumni' => 007 applied
select is_alumni from public.profiles limit 1;                -- ok => 007 applied
select link_status from public.messages limit 1;              -- ok => 009 applied
select payment_proof_url from public.profiles limit 1;        -- ok => 006 applied
```
