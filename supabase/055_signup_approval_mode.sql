-- 055_signup_approval_mode.sql — Founder-toggleable "manual approval" for NEW signups.
-- Run in the Supabase SQL editor after 054. Idempotent (safe to re-run).
--
-- Default (auto-accept, the current behaviour): a brand-new signup is 'approved' the moment
-- they register; only a previously kicked/removed email lands in 'pending'. When a founder turns
-- MANUAL APPROVAL on, EVERY new signup starts 'pending' and must be Accepted in the Admin Panel
-- before they can enter the portal.
--
-- Composes with 042 (flag_incomplete_signup), which can only ever tighten status to 'pending' —
-- so a manual-approval signup stays pending, and an auto-accept signup with a missing field is
-- still held for review. This migration never loosens that guard.

-- ============ 1) SINGLE-ROW SETTINGS TABLE ============
create table if not exists public.app_settings (
  id                      boolean primary key default true check (id),   -- one row only (id is always true)
  require_signup_approval boolean not null default false,
  updated_at              timestamptz not null default now(),
  updated_by              uuid references public.profiles(id) on delete set null
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;

-- Any authenticated user may READ the flag (the Admin Panel renders the toggle from it; the signup
-- path reads it through the SECURITY DEFINER trigger regardless). No direct writes — the founder
-- changes it only through set_signup_approval_mode().
drop policy if exists "app_settings_read" on public.app_settings;
create policy "app_settings_read" on public.app_settings
  for select to authenticated using (true);

-- ============ 2) FOUNDER-ONLY: TOGGLE THE MODE ============
create or replace function public.set_signup_approval_mode(p_require boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Only a founder can change the signup approval mode.';
  end if;
  update public.app_settings
     set require_signup_approval = coalesce(p_require, false),
         updated_at = now(),
         updated_by = auth.uid()
   where id = true;
  perform public.log_admin_action(
    'set_signup_approval_mode', null,
    case when coalesce(p_require, false)
         then 'Manual approval ON — new signups start pending'
         else 'Auto-accept ON — new signups approved unless previously kicked' end
  );
end; $$;
grant execute on function public.set_signup_approval_mode(boolean) to authenticated;

-- ============ 3) RE-DEFINE handle_new_user (keeps every 033 field) TO HONOUR THE TOGGLE ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := new.raw_user_meta_data;
  user_status text;
  v_require_approval boolean;
  v_domain_id int := nullif(meta->>'domain_id','')::int;
  v_dept_key  text;
  v_dept_code text;
  v_year      int := extract(year from now())::int;
  v_seq       int;
  v_member_id text;
begin
  select require_signup_approval into v_require_approval from public.app_settings where id = true;

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

  insert into public.profiles (
    id, email, display_name, full_name, domain_id, gender, avatar_url, status, ram,
    discord_id, discord_username, classroom_confirmed,
    country, dial_code, phone, member_id
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
    v_member_id
  );
  return new;
end; $$;
