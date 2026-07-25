-- ZeroDay Reapers — Portal schema. Run the whole file once in Supabase SQL Editor.
-- Includes the base spec + add-ons: general lobby room + avatar storage.

-- ========================= DOMAINS =========================
create table if not exists public.domains (
  id   serial primary key,
  key  text unique not null,
  name text not null,
  sort int  not null default 0
);
insert into public.domains (key,name,sort) values
 ('offensive','Offensive Security',1),
 ('defensive','Defensive Security',2),
 ('cloud','Cloud Security',3),
 ('grc','Governance, Risk & Compliance',4),
 ('forensics','Digital Forensics',5),
 ('ai','AI Security',6),
 ('lobby','General Lobby',7)          -- add-on: all-interns room
on conflict (key) do nothing;

-- ========================= PROFILES =========================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text not null,
  full_name    text,
  domain_id    int references public.domains(id),
  role         text not null default 'student' check (role in ('student','moderator','admin')),
  avatar_url   text,
  banned       boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ========================= MESSAGES =========================
create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  domain_id  int  not null references public.domains(id),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 2000),
  deleted    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_domain_time on public.messages (domain_id, created_at);

-- ========================= ANNOUNCEMENTS =========================
create table if not exists public.announcements (
  id         bigint generated always as identity primary key,
  title      text not null,
  body       text not null,
  created_at timestamptz not null default now()
);

-- =============== AUTO-CREATE PROFILE ON SIGNUP ===============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, full_name, domain_id)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'full_name',
    nullif(new.raw_user_meta_data->>'domain_id','')::int
  );
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===== PREVENT STUDENTS CHANGING THEIR OWN domain/role/ban =====
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare is_admin boolean;
begin
  select (role = 'admin') into is_admin from public.profiles where id = auth.uid();
  if coalesce(is_admin,false) = false then
    -- students may set their domain ONCE (while null), never change it afterwards
    if old.domain_id is not null then new.domain_id := old.domain_id; end if;
    new.role      := old.role;
    new.banned    := old.banned;
  end if;
  return new;
end; $$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- =============== ADMIN: MOVE STUDENT TO A DOMAIN ===============
create or replace function public.admin_set_domain(target uuid, new_domain int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.profiles set domain_id = new_domain where id = target;
end; $$;

-- =============== ADMIN: BAN / UNBAN A STUDENT ===============
create or replace function public.admin_set_ban(target uuid, is_banned boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.profiles set banned = is_banned where id = target;
end; $$;

-- =============== ANTI-SPAM RATE LIMIT (5 / 10s) ===============
create or replace function public.rate_limit_messages()
returns trigger language plpgsql as $$
declare c int;
begin
  select count(*) into c from public.messages
   where user_id = new.user_id and created_at > now() - interval '10 seconds';
  if c >= 5 then raise exception 'Slow down — you are sending messages too fast.'; end if;
  return new;
end; $$;
drop trigger if exists rl_messages on public.messages;
create trigger rl_messages before insert on public.messages
  for each row execute function public.rate_limit_messages();

-- ========================= RLS =========================
alter table public.domains       enable row level security;
alter table public.profiles      enable row level security;
alter table public.messages      enable row level security;
alter table public.announcements enable row level security;

-- domains: readable by anyone (signup dropdown needs it pre-auth)
drop policy if exists "domains_read" on public.domains;
create policy "domains_read" on public.domains
  for select to anon, authenticated using (true);

-- profiles: read all (needed to show names); update only your own row
drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles
  for select to authenticated using (true);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- messages: read your domain OR the lobby (admin reads all)
drop policy if exists "messages_read_own_domain" on public.messages;
create policy "messages_read_own_domain" on public.messages
  for select to authenticated using (
    domain_id = (select domain_id from public.profiles where id = auth.uid())
    or domain_id = (select id from public.domains where key = 'lobby')
    or (select role from public.profiles where id = auth.uid()) = 'admin'
  );
-- messages: insert into your domain OR the lobby, as yourself, if not banned
drop policy if exists "messages_insert_own_domain" on public.messages;
create policy "messages_insert_own_domain" on public.messages
  for insert to authenticated with check (
    user_id = auth.uid()
    and (
      domain_id = (select domain_id from public.profiles where id = auth.uid())
      or domain_id = (select id from public.domains where key = 'lobby')
    )
    and coalesce((select banned from public.profiles where id = auth.uid()), true) = false
  );
-- messages: only admin can update (used for soft-delete moderation)
drop policy if exists "messages_admin_update" on public.messages;
create policy "messages_admin_update" on public.messages
  for update to authenticated using (
    (select role from public.profiles where id = auth.uid()) = 'admin'
  );

-- announcements: everyone reads; only admin writes
drop policy if exists "ann_read" on public.announcements;
create policy "ann_read" on public.announcements
  for select to authenticated using (true);
drop policy if exists "ann_admin_write" on public.announcements;
create policy "ann_admin_write" on public.announcements
  for all to authenticated
  using ((select role from public.profiles where id = auth.uid()) = 'admin')
  with check ((select role from public.profiles where id = auth.uid()) = 'admin');

-- ========================= AVATARS (add-on) =========================
insert into storage.buckets (id, name, public)
  values ('avatars','avatars', true) on conflict (id) do nothing;
-- public read; each user may write only inside their own {uid}/ folder
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select to public using (bucket_id = 'avatars');
drop policy if exists "avatars_owner_write" on storage.objects;
create policy "avatars_owner_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ========================= REALTIME =========================
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.announcements;

-- ============ MAKE THE FOUNDER AN ADMIN (run after 1st signup) ============
-- update public.profiles set role='admin' where email = 'FOUNDER_EMAIL_HERE';
