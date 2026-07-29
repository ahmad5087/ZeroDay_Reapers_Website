-- 029_country_phone_memberid.sql — signup country + phone, and department-based member IDs.
-- Run after 028. Idempotent; safe to re-run.
--
-- Adds: profiles.country (ISO-2, immutable for the user), dial_code, phone (editable in profile),
-- and member_id = ZDR-<year>-<DEPT>-<NNN> generated per department at signup (OS/DS/CS/GRC/DF/AIS).
-- country + member_id are exposed via public_profiles so the flag + ID show to everyone; phone stays private.

-- ---- columns ----
alter table public.profiles add column if not exists country   text;   -- ISO 3166-1 alpha-2 (e.g. 'PK')
alter table public.profiles add column if not exists dial_code text;   -- e.g. '+92' (tied to country)
alter table public.profiles add column if not exists phone     text;   -- national number, user-editable
alter table public.profiles add column if not exists member_id text;   -- ZDR-YYYY-DEPT-NNN
create unique index if not exists profiles_member_id_uniq on public.profiles (member_id) where member_id is not null;

-- ---- per-department, per-year sequence for the member ID ----
create table if not exists public.member_id_seq (
  year      int  not null,
  dept_code text not null,
  last_seq  int  not null default 0,
  primary key (year, dept_code)
);

-- domain key -> short department code used in the member ID
create or replace function public.dept_code_for(p_key text)
returns text language sql immutable as $$
  select case p_key
    when 'offensive' then 'OS'
    when 'defensive' then 'DS'
    when 'cloud'     then 'CS'
    when 'grc'       then 'GRC'
    when 'forensics' then 'DF'
    when 'ai'        then 'AIS'
    else null
  end;
$$;

-- ---- signup trigger: also store country/dial_code/phone + mint the member ID ----
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := new.raw_user_meta_data;
  user_status text;
  v_domain_id int := nullif(meta->>'domain_id','')::int;
  v_dept_key  text;
  v_dept_code text;
  v_year      int := extract(year from now())::int;
  v_seq       int;
  v_member_id text;
begin
  if exists (select 1 from public.kicked_emails where lower(email) = lower(new.email)) then
    user_status := 'pending';
  else
    user_status := 'approved';
  end if;

  -- Department-based member ID (only when a domain was chosen — i.e. interns, not admins).
  if v_domain_id is not null then
    select key into v_dept_key from public.domains where id = v_domain_id;
    v_dept_code := public.dept_code_for(v_dept_key);
    if v_dept_code is not null then
      insert into public.member_id_seq (year, dept_code, last_seq)
        values (v_year, v_dept_code, 1)
        on conflict (year, dept_code) do update set last_seq = public.member_id_seq.last_seq + 1
        returning last_seq into v_seq;
      v_member_id := 'ZDR-' || v_year || '-' || v_dept_code || '-' || lpad(v_seq::text, 3, '0');
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
    coalesce(nullif(meta->>'display_name',''), split_part(new.email,'@',1)),
    meta->>'full_name',
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

-- ---- column protection (extends 028): country/dial_code/member_id are not user-editable
--      (phone IS — that's the whole point). Keeps the 028 founder rules intact. ----
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare caller_role text; caller_founder boolean; target_is_staff boolean;
begin
  if auth.uid() is null then return new; end if;              -- SQL editor / service role bypass
  select role, is_founder into caller_role, caller_founder from public.profiles where id = auth.uid();
  target_is_staff := (old.role = 'admin' or coalesce(old.is_founder, false));

  if (new.is_founder is distinct from old.is_founder) and coalesce(caller_founder, false) = false then
    new.is_founder := old.is_founder;
  end if;

  if coalesce(caller_role, 'student') <> 'admin' then
    -- non-admin: lock every protected column. phone is intentionally NOT locked.
    if old.domain_id is not null then new.domain_id := old.domain_id; end if;
    new.role := old.role; new.banned := old.banned; new.timeout_until := old.timeout_until;
    new.status := old.status; new.is_alumni := old.is_alumni; new.payment_confirmed := old.payment_confirmed;
    new.ram := old.ram; new.discord_id := old.discord_id; new.discord_username := old.discord_username;
    new.classroom_confirmed := old.classroom_confirmed; new.is_founder := old.is_founder;
    new.country := old.country; new.dial_code := old.dial_code; new.member_id := old.member_id;
  elsif target_is_staff and coalesce(caller_founder, false) = false and auth.uid() <> old.id then
    -- a non-founder admin must not touch another admin/founder's protected columns.
    new.role := old.role; new.banned := old.banned; new.timeout_until := old.timeout_until;
    new.status := old.status; new.is_alumni := old.is_alumni; new.payment_confirmed := old.payment_confirmed;
    new.ram := old.ram; new.domain_id := old.domain_id;
    new.discord_id := old.discord_id; new.discord_username := old.discord_username;
    new.classroom_confirmed := old.classroom_confirmed; new.is_founder := old.is_founder;
    new.country := old.country; new.dial_code := old.dial_code; new.member_id := old.member_id;
  end if;
  -- member_id is system-managed: never allow a client (even an admin) to change an existing one.
  if old.member_id is not null then new.member_id := old.member_id; end if;
  return new;
end; $$;

-- ---- expose country + member_id to everyone (for the flag + ID); keep phone private ----
drop view if exists public.public_profiles cascade;
create view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, is_alumni, ram, country, member_id
  from public.profiles;
grant select on public.public_profiles to authenticated;

-- ---- backfill existing interns (member_id null) in signup order, per department + signup year ----
do $$
declare r record; v_code text; v_year int; v_seq int;
begin
  for r in
    select p.id, p.created_at, d.key
    from public.profiles p
    join public.domains d on d.id = p.domain_id
    where p.member_id is null and p.role = 'student'
    order by p.created_at asc
  loop
    v_code := public.dept_code_for(r.key);
    if v_code is null then continue; end if;
    v_year := extract(year from r.created_at)::int;
    insert into public.member_id_seq (year, dept_code, last_seq)
      values (v_year, v_code, 1)
      on conflict (year, dept_code) do update set last_seq = public.member_id_seq.last_seq + 1
      returning last_seq into v_seq;
    update public.profiles
       set member_id = 'ZDR-' || v_year || '-' || v_code || '-' || lpad(v_seq::text, 3, '0')
     where id = r.id;
  end loop;
end $$;
