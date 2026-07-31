-- 045_github_url.sql — let users link their GitHub to their account (mirrors 044 / LinkedIn).
-- Run in the Supabase SQL editor after 044. Idempotent (safe to re-run).
--
-- github_url is NOT in protect_profile_columns' locked list, so a user can set their own directly.
-- Exposed via public_profiles for the clickable icon in the chat members sidebar.
alter table public.profiles add column if not exists github_url text;

-- Recreate the safe view with 044's columns + github_url.
drop view if exists public.public_profiles cascade;
create view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, is_alumni, ram, country, member_id, linkedin_url, github_url
  from public.profiles;
grant select on public.public_profiles to authenticated;
