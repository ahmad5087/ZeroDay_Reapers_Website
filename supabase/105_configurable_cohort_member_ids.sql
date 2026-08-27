-- 105_configurable_cohort_member_ids.sql — Make the cohort in member IDs founder-configurable. Run after
-- 104. Idempotent. Until now the cohort was hardcoded 'Cohort1' in handle_new_user, so Cohort 2 signups
-- would get wrong IDs. This adds app_settings.current_cohort (founder sets it in the panel) and threads it
-- into both the member_id LABEL and the numbering SEQUENCE, so each cohort restarts at 001 per department.
--
-- Only the live handle_new_user upserts member_id_seq (the 029 backfill was one-time; the 033 upsert is in a
-- superseded handle_new_user), so adding `cohort` to the sequence key is safe.

-- ---- (1) current cohort setting + founder toggle -------------------------------------------------------
alter table public.app_settings
  add column if not exists current_cohort int not null default 1;

create or replace function public.set_current_cohort(p_cohort int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Only a founder can change the current cohort.';
  end if;
  if p_cohort is null or p_cohort < 1 or p_cohort > 99 then
    raise exception 'Cohort must be between 1 and 99.';
  end if;
  update public.app_settings
     set current_cohort = p_cohort, updated_at = now(), updated_by = auth.uid()
   where id = true;
  perform public.log_admin_action('set_current_cohort', null, 'Current cohort = ' || p_cohort);
end; $$;
grant execute on function public.set_current_cohort(int) to authenticated;

-- ---- (2) per-cohort numbering: add cohort to the sequence key ------------------------------------------
alter table public.member_id_seq
  add column if not exists cohort int not null default 1;

-- Repoint the primary key to (year, cohort, dept_code) so each cohort counts from 1 per department.
alter table public.member_id_seq drop constraint if exists member_id_seq_pkey;
alter table public.member_id_seq add primary key (year, cohort, dept_code);

-- ---- (3) handle_new_user: use the configured cohort in the label + sequence ----------------------------
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
    country, dial_code, phone, member_id, referred_by
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
    v_referred_by
  );
  return new;
end; $$;
