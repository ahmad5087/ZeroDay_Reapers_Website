-- 039_founder_user_records.sql — founder-only consolidated record of every user's signup/profile
-- data in one place. Run after 038. Idempotent.
--
-- Surfaces ALL columns of public.profiles per user, plus auth metadata that lives in auth.users:
--   * has_password  — boolean; TRUE when a password hash exists. The password itself is NEVER
--                     exposed: auth.users.encrypted_password is a one-way salted bcrypt hash and
--                     is not selected here (and could not be decrypted anyway).
--   * last_sign_in_at, email_confirmed_at, auth_created_at — non-sensitive account timestamps.
--
-- ACCESS: founder-only. The view runs with the owner's (definer) rights so it can read auth.users,
-- but its WHERE clause returns rows only when public.is_founder() is true for the caller — so a
-- non-founder who queries it simply gets zero rows. Granted to `authenticated`, revoked from `anon`.

drop view if exists public.founder_user_records cascade;
create view public.founder_user_records as
  select
    p.*,
    (u.encrypted_password is not null) as has_password,
    u.last_sign_in_at,
    u.email_confirmed_at,
    u.created_at as auth_created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_founder();

revoke all on public.founder_user_records from anon;
grant select on public.founder_user_records to authenticated;
