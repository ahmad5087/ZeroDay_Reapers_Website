-- 042_flag_incomplete_signup.sql — Guard against incomplete signups.
-- Run in the Supabase SQL editor after 041. Idempotent (safe to re-run).
--
-- The signup form already requires full name / gender / RAM / department / country / phone, but
-- that's browser-side only and can be bypassed (JS off, or hitting the auth API directly), which
-- is how sparse profiles like "email-prefix only" rows get created. This adds a server-side guard:
-- any NEW student profile missing a required field is created as 'pending' instead of 'approved',
-- so it lands in the admin "Pending Account Approvals" queue for review rather than going live.
--
-- Notes:
--   * Never blocks account creation (per product decision) — it only flags for review.
--   * INSERT-only, role='student' only: admin/founder promotion is an UPDATE and is unaffected;
--     admins/founders legitimately have no department/RAM.
--   * Existing rows are NOT touched (only new inserts). Complete the one existing sparse record
--     from the admin Members panel, or set it to 'pending' there to review it.

create or replace function public.flag_incomplete_signup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.role, 'student') = 'student' then
    if nullif(btrim(coalesce(new.full_name, '')), '') is null
       or nullif(btrim(coalesce(new.gender,  '')), '') is null
       or nullif(btrim(coalesce(new.ram,     '')), '') is null
       or new.domain_id is null
       or nullif(btrim(coalesce(new.country, '')), '') is null
       or nullif(btrim(coalesce(new.phone,   '')), '') is null then
      new.status := 'pending';
    end if;
  end if;
  return new;
end; $$;

-- Runs before handle_new_user's row is written (defaults are already applied at this point).
drop trigger if exists flag_incomplete_signup on public.profiles;
create trigger flag_incomplete_signup
  before insert on public.profiles
  for each row execute function public.flag_incomplete_signup();
