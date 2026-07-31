-- 044_linkedin_url.sql — let users link their LinkedIn (profile or company page) to their account.
-- Run in the Supabase SQL editor after 043. Idempotent (safe to re-run).
--
-- linkedin_url is intentionally NOT in protect_profile_columns' locked list, so a user can set
-- their own directly (profiles_update_own RLS scopes it to their row). Exposed via public_profiles
-- so a clickable icon can show in the chat members sidebar for networking.
alter table public.profiles add column if not exists linkedin_url text;

-- Recreate the safe view with the same columns as 029 + linkedin_url.
drop view if exists public.public_profiles cascade;
create view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, is_alumni, ram, country, member_id, linkedin_url
  from public.profiles;
grant select on public.public_profiles to authenticated;
