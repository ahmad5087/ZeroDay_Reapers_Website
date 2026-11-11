-- 121_signup_linkedin_cv.sql — capture LinkedIn URL + an (optional) CV/resume at signup.
-- Run in the Supabase SQL editor after 120. Idempotent (safe to re-run).
--
-- Context:
--  * linkedin_url already exists on profiles (migration 044) and is intentionally NOT in
--    protect_profile_columns' locked list, so threading it through signup needs no column change
--    and no guard change — handle_new_user just copies it from the signup metadata.
--  * cv_key / cv_name point at the applicant's CV in R2. The file is uploaded (PDF only) during
--    signup via the public /api/r2/signup-cv-url route under a random `signup/<uuid>.pdf` key, so no
--    session is required; admins can read any R2 key (lib/r2.js ownsKey → admins bypass), applicants
--    cannot read other people's signup/ keys. Both columns are left out of the protect list on
--    purpose (same rationale as linkedin_url): a member may overwrite their own, nothing else.
--
-- This replaces handle_new_user with the exact body from 105 (per-cohort member IDs) plus the three
-- new metadata fields in the INSERT. Nothing else in the function changes.

alter table public.profiles add column if not exists cv_key  text;
alter table public.profiles add column if not exists cv_name text;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := new.raw_user_meta_data;
  user_status text;
  v_require_approval boolean;
  v_signups_open boolean;
  v_cohort int;
  v_domain_id int := nullif(meta->>'domain_id','')::int;
  v_dept_key  text;
  v_dept_code text;
  v_year      int := extract(year from now())::int;
  v_seq       int;
  v_member_id text;
  v_referred_by uuid;
begin
  select require_signup_approval, signups_open, current_cohort
    into v_require_approval, v_signups_open, v_cohort
    from public.app_settings where id = true;
  v_cohort := coalesce(v_cohort, 1);

  -- Founder-controlled hard close (default open) — blocks new self-signups when off.
  if coalesce(v_signups_open, true) = false then
    raise exception 'Signups are currently closed.';
  end if;

  if exists (select 1 from public.kicked_emails where lower(email) = lower(new.email)) then
    user_status := 'pending';
  elsif coalesce(v_require_approval, false) then
    user_status := 'pending';
  else
    user_status := 'approved';
  end if;

  if v_domain_id is not null then
    select key into v_dept_key from public.domains where id = v_domain_id;
    v_dept_code := public.dept_code_for(v_dept_key);
    if v_dept_code is not null then
      insert into public.member_id_seq (year, cohort, dept_code, last_seq)
        values (v_year, v_cohort, v_dept_code, 1)
        on conflict (year, cohort, dept_code) do update set last_seq = public.member_id_seq.last_seq + 1
        returning last_seq into v_seq;
      v_member_id := 'ZDR-' || v_year || '-Cohort' || v_cohort || '-' || v_dept_code || '-' || lpad(v_seq::text, 3, '0');
    end if;
  end if;

  select w.referred_by into v_referred_by
    from public.waitlist w
   where lower(w.email) = lower(new.email) and w.referred_by is not null
   order by w.created_at desc limit 1;

  insert into public.profiles (
    id, email, display_name, full_name, domain_id, gender, avatar_url, status, ram,
    discord_id, discord_username, classroom_confirmed,
    country, dial_code, phone, member_id, referred_by,
    linkedin_url, cv_key, cv_name
  )
  values (
    new.id,
    new.email,
    coalesce(nullif(meta->>'display_name',''), nullif(meta->>'full_name',''), split_part(new.email,'@',1)),
    nullif(meta->>'full_name',''),
    v_domain_id,
    nullif(meta->>'gender',''),
    case lower(nullif(meta->>'gender',''))
      when 'male'   then '/avatars/male.webp'
      when 'female' then '/avatars/female.webp'
      else null
    end,
    user_status,
    nullif(meta->>'ram',''),
    nullif(meta->>'discord_id',''),
    nullif(meta->>'discord_username',''),
    coalesce((nullif(meta->>'classroom_confirmed',''))::boolean, false),
    upper(nullif(meta->>'country','')),
    nullif(meta->>'dial_code',''),
    nullif(meta->>'phone',''),
    v_member_id,
    v_referred_by,
    nullif(meta->>'linkedin_url',''),
    nullif(meta->>'cv_key',''),
    nullif(meta->>'cv_name','')
  );
  return new;
end; $$;
