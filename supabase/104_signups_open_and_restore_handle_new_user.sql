-- 104_signups_open_and_restore_handle_new_user.sql — Run after 103. Idempotent. Two parts:
--
-- (A) CRITICAL FIX. Migration 101 redefined handle_new_user() from the OLD schema.sql baseline, which
--     accidentally dropped the rich signup logic added up through 055: the manual-approval mode, the
--     kicked-email guard, member_id generation, and every profile field beyond name/email/domain
--     (gender, avatar, ram, discord, country, dial_code, phone). This restores the full 055 body and
--     keeps 101's referral carry (referred_by copied from the applicant's waitlist row by email).
--
-- (B) NEW "signups open" switch. app_settings.signups_open (default TRUE) is a founder-controlled hard
--     gate on new self-signups, enforced inside handle_new_user. Toggle it in Founder → Settings. The
--     anon-callable signups_open() helper lets the logged-out signup screen show a friendly "closed"
--     message instead of a raw error.

-- ---- (B1) setting + founder toggle + anon reader --------------------------------------------------
alter table public.app_settings
  add column if not exists signups_open boolean not null default true;

create or replace function public.set_signups_open(p_open boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Only a founder can open or close signups.';
  end if;
  update public.app_settings
     set signups_open = coalesce(p_open, true), updated_at = now(), updated_by = auth.uid()
   where id = true;
  perform public.log_admin_action('set_signups_open', null,
    case when coalesce(p_open, true) then 'Signups OPEN' else 'Signups CLOSED' end);
end; $$;
grant execute on function public.set_signups_open(boolean) to authenticated;

-- Anon-callable so the logged-out signup screen can read the state (app_settings itself is admin/auth-only).
create or replace function public.signups_open()
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce((select signups_open from public.app_settings where id = true), true);
$$;
grant execute on function public.signups_open() to anon, authenticated;

-- ---- (A + B2) restore the full handle_new_user, plus referral carry + signups gate ----------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := new.raw_user_meta_data;
  user_status text;
  v_require_approval boolean;
  v_signups_open boolean;
  v_domain_id int := nullif(meta->>'domain_id','')::int;
  v_dept_key  text;
  v_dept_code text;
  v_year      int := extract(year from now())::int;
  v_seq       int;
  v_member_id text;
  v_referred_by uuid;
begin
  select require_signup_approval, signups_open
    into v_require_approval, v_signups_open
    from public.app_settings where id = true;

  -- Founder-controlled hard close (default open) — blocks new self-signups when off.
  if coalesce(v_signups_open, true) = false then
    raise exception 'Signups are currently closed.';
  end if;

  if exists (select 1 from public.kicked_emails where lower(email) = lower(new.email)) then
    user_status := 'pending';                 -- previously kicked/removed → always needs approval
  elsif coalesce(v_require_approval, false) then
    user_status := 'pending';                 -- founder turned manual approval on
  else
    user_status := 'approved';                -- auto-accept (default)
  end if;

  if v_domain_id is not null then
    select key into v_dept_key from public.domains where id = v_domain_id;
    v_dept_code := public.dept_code_for(v_dept_key);
    if v_dept_code is not null then
      insert into public.member_id_seq (year, dept_code, last_seq)
        values (v_year, v_dept_code, 1)
        on conflict (year, dept_code) do update set last_seq = public.member_id_seq.last_seq + 1
        returning last_seq into v_seq;
      v_member_id := 'ZDR-' || v_year || '-Cohort1-' || v_dept_code || '-' || lpad(v_seq::text, 3, '0');
    end if;
  end if;

  -- Carry a validated referral from the applicant's waitlist row (migration 101), matched by email.
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
