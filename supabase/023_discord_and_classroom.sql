-- 023_discord_and_classroom.sql — signup join-gate fields (Discord + Google Classroom).
-- Run after 022. Idempotent; safe to re-run.
--
-- Adds discord_id / discord_username / classroom_confirmed to profiles, captured at signup
-- from auth metadata, and locks them from student self-edits (admins + SQL-editor bypass).
-- Extends the canonical handle_new_user + protect_profile_columns from 015 (keeps every
-- prior field: gender, avatar, status-from-kicked_emails, ram).

-- ---- columns ----
alter table public.profiles add column if not exists discord_id          text;
alter table public.profiles add column if not exists discord_username    text;
alter table public.profiles add column if not exists classroom_confirmed boolean not null default false;

-- ---- signup trigger: also store discord + classroom fields ----
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := new.raw_user_meta_data;
  user_status text;
begin
  if exists (select 1 from public.kicked_emails where lower(email) = lower(new.email)) then
    user_status := 'pending';
  else
    user_status := 'approved';
  end if;

  insert into public.profiles (
    id, email, display_name, full_name, domain_id, gender, avatar_url, status, ram,
    discord_id, discord_username, classroom_confirmed
  )
  values (
    new.id,
    new.email,
    coalesce(nullif(meta->>'display_name',''), split_part(new.email,'@',1)),
    meta->>'full_name',
    nullif(meta->>'domain_id','')::int,
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
    coalesce((nullif(meta->>'classroom_confirmed',''))::boolean, false)
  );
  return new;
end; $$;

-- ---- students can't change discord/classroom fields (admins can; SQL editor bypasses) ----
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare is_admin boolean;
begin
  if auth.uid() is null then return new; end if;
  select (role = 'admin') into is_admin from public.profiles where id = auth.uid();
  if coalesce(is_admin,false) = false then
    if old.domain_id is not null then new.domain_id := old.domain_id; end if;
    new.role                := old.role;
    new.banned              := old.banned;
    new.timeout_until       := old.timeout_until;
    new.status              := old.status;
    new.is_alumni           := old.is_alumni;
    new.payment_confirmed   := old.payment_confirmed;
    new.ram                 := old.ram;
    new.discord_id          := old.discord_id;
    new.discord_username    := old.discord_username;
    new.classroom_confirmed := old.classroom_confirmed;
  end if;
  return new;
end; $$;

-- Optional anti-abuse (uncomment once Discord OAuth is live) — one Discord account per portal
-- account. Left off by default so it never surprises honor-mode (null) signups.
create unique index if not exists profiles_discord_id_uniq
   on public.profiles (discord_id) where discord_id is not null;
