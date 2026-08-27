-- 101_carry_referral_on_signup.sql — Carry a Cohort 2 application's referral onto the new account (Phase 11).
-- Run after 100. Idempotent. When someone signs up, look up their waitlist application by email and, if it
-- carried a validated referral (referred_by), stamp it onto the new profile. This converts the referrer's
-- "Applied" into "Joined" even when the person signs up WITHOUT clicking a ?ref= link.
--
-- Precedence: the passive ?ref= flow (attribute_referral) only fills referred_by when it's still null, so
-- this deliberate, form-declared referral wins. The FK waitlist.referred_by is `on delete set null`, so a
-- since-deleted referrer resolves to null (never a broken link). Only the function body changes — the
-- existing on_auth_user_created trigger already calls it.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, full_name, domain_id, referred_by)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'full_name',
    nullif(new.raw_user_meta_data->>'domain_id','')::int,
    (select w.referred_by
       from public.waitlist w
      where lower(w.email) = lower(new.email)
        and w.referred_by is not null
      order by w.created_at desc
      limit 1)
  );
  return new;
end; $$;

-- One-time backfill: link any existing accounts that match a waitlist referral but don't yet have one
-- (idempotent — only fills nulls, so re-running is a no-op).
update public.profiles p
set referred_by = w.referred_by
from public.waitlist w
where lower(w.email) = lower(p.email)
  and w.referred_by is not null
  and p.referred_by is null;
