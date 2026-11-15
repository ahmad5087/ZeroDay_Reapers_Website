-- 124_announcement_audience.sql — Scope each announcement to one audience. Run after 123. Idempotent.
--
-- Until now every announcement was global: the read policy was `using (true)`, so every authenticated
-- user (every cohort + alumni + staff) saw every post. This adds a single-choice audience per post:
--   'all'    → portal-wide: everyone (the default — existing rows keep today's behaviour).
--   'cohort' → the ACTIVE cohort only (app_settings.current_cohort), excluding alumni. DYNAMIC: when the
--              founder advances the current cohort, a 'cohort' post re-targets to the new cohort and the
--              previous cohort stops seeing it (no cohort number is stored on the row).
--   'alumni' → alumni only (profiles.is_alumni = true).
-- Admins always see everything (to manage/delete). A viewer who is BOTH alumni and in the active cohort
-- counts as ALUMNI (alumni-wins): they get 'alumni' posts, not 'cohort' posts.
--
-- Only the SELECT policy changes; insert/update/delete (admin-only, schema.sql + 008) are untouched. The
-- column default keeps every existing announcement 'all', so nothing is retroactively hidden. Every read
-- path (the Announcements channel, the login popup, the top banner, the Notification Center, and realtime
-- postgres_changes) goes through this one table, so they all honour the audience automatically — the same
-- approach as the cohort chat cutoff (migration 116).

-- ---- (1) audience column ------------------------------------------------------------------------------
alter table public.announcements
  add column if not exists audience text not null default 'all'
  check (audience in ('all','cohort','alumni'));

-- ---- (2) caller attributes (security definer so the RLS policy reads them regardless of the caller's
--          grants/RLS — mirrors my_cohort() in migration 120 and my_cohort_start() in 116) -------------
-- Active cohort number, read past app_settings' own RLS.
create or replace function public.active_cohort()
returns int language sql stable security definer set search_path = public as $$
  select current_cohort from public.app_settings where id = true;
$$;
grant execute on function public.active_cohort() to authenticated;

-- Is the caller an alumnus? (missing profile row → false)
create or replace function public.my_is_alumni()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_alumni from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.my_is_alumni() to authenticated;

-- public.my_cohort() (migration 120) already returns the caller's cohort number parsed from member_id
-- (NULL when the caller has no 'Cohort<N>' segment — e.g. staff or unassigned).

-- ---- (3) audience-aware read policy -------------------------------------------------------------------
drop policy if exists "ann_read" on public.announcements;
create policy "ann_read" on public.announcements
  for select to authenticated using (
    public.is_admin()
    or audience = 'all'
    or (audience = 'alumni' and public.my_is_alumni())
    or (
      audience = 'cohort'
      and not public.my_is_alumni()
      and public.my_cohort() is not null
      and public.my_cohort() = public.active_cohort()
    )
  );
