-- 110_public_profiles_best_intern.sql — expose is_best_intern on the public_profiles view so the chat
-- roster (and any other reader of the safe view) can highlight Best Interns. Run after 045. Idempotent.
--
-- Keeps 045's exact column order and appends is_best_intern at the end, so `create or replace` is valid
-- (no DROP ... CASCADE needed) and every existing caller — which selects named columns or * — keeps working.
create or replace view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, is_alumni, ram, country, member_id,
         linkedin_url, github_url, is_best_intern
  from public.profiles;

grant select on public.public_profiles to authenticated;
