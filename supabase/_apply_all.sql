-- _apply_all.sql — GENERATED full schema bundle: base schema + every numbered migration (002 → latest), in order.
-- Purpose: bring a DISPOSABLE Supabase project (the CI test DB, "zdr-ci-test") to full parity with production so
-- the RLS/authorization suite (scripts/rls-test.mjs) tests the current schema. Run the WHOLE file once in the
-- Supabase SQL Editor of the TEST project — NEVER production. Built for a clean/empty DB (deterministic apply);
-- most migrations are additive/idempotent so an in-place re-run also works, but a fresh DB is the guaranteed match.
-- Regenerate with: scripts/build-apply-all.sh

-- ============================================================================
-- ===== supabase/schema.sql (base) =====
-- ============================================================================
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
-- temporary mute: user cannot post until this time passes (null = not timed out)
alter table public.profiles add column if not exists timeout_until timestamptz;

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

-- Reactions on announcements (users can only react, not reply).
create table if not exists public.announcement_reactions (
  id              bigint generated always as identity primary key,
  announcement_id bigint not null references public.announcements(id) on delete cascade,
  user_id         uuid   not null references public.profiles(id) on delete cascade,
  emoji           text   not null,
  created_at      timestamptz not null default now(),
  unique (announcement_id, user_id, emoji)
);
-- so realtime DELETE events include the full row (needed to remove reactions live)
alter table public.announcement_reactions replica identity full;

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
  -- Privileged/server context (SQL Editor, service role) has no auth.uid() — allow it.
  if auth.uid() is null then return new; end if;
  select (role = 'admin') into is_admin from public.profiles where id = auth.uid();
  if coalesce(is_admin,false) = false then
    -- students may set their domain ONCE (while null), never change it afterwards
    if old.domain_id is not null then new.domain_id := old.domain_id; end if;
    new.role          := old.role;
    new.banned        := old.banned;
    new.timeout_until := old.timeout_until;
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

-- =============== ADMIN: TIMEOUT (temporary mute) ===============
-- minutes <= 0 or null clears the timeout.
create or replace function public.admin_set_timeout(target uuid, minutes int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.profiles
     set timeout_until = case when minutes is null or minutes <= 0 then null
                              else now() + make_interval(mins => minutes) end
   where id = target;
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
alter table public.domains                enable row level security;
alter table public.profiles               enable row level security;
alter table public.messages               enable row level security;
alter table public.announcements          enable row level security;
alter table public.announcement_reactions enable row level security;

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
      or (select role from public.profiles where id = auth.uid()) = 'admin'  -- admins post anywhere
    )
    and coalesce((select banned from public.profiles where id = auth.uid()), true) = false
    -- blocked while timed out (null timeout => allowed)
    and coalesce((select timeout_until from public.profiles where id = auth.uid()), to_timestamp(0)) < now()
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

-- announcement reactions: everyone reads; users add/remove only their own reaction
drop policy if exists "ann_react_read" on public.announcement_reactions;
create policy "ann_react_read" on public.announcement_reactions
  for select to authenticated using (true);
drop policy if exists "ann_react_insert" on public.announcement_reactions;
create policy "ann_react_insert" on public.announcement_reactions
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "ann_react_delete" on public.announcement_reactions;
create policy "ann_react_delete" on public.announcement_reactions
  for delete to authenticated using (user_id = auth.uid());

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
-- Idempotent: only add each table if it isn't already in the publication.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='announcements') then
    alter publication supabase_realtime add table public.announcements;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='announcement_reactions') then
    alter publication supabase_realtime add table public.announcement_reactions;
  end if;
end $$;

-- ============ MAKE THE FOUNDER AN ADMIN (run after 1st signup) ============
-- update public.profiles set role='admin' where email = 'FOUNDER_EMAIL_HERE';


-- ============================================================================
-- ===== supabase/002_tasks_and_security.sql =====
-- ============================================================================
-- ZeroDay Reapers — Portal Phase 1 migration.
-- Run once in Supabase SQL Editor AFTER schema.sql. Idempotent — safe to re-run.
-- Adds: task submissions + grading, private submissions bucket, PII lockdown.

-- ================= helper: am I an admin? (no RLS recursion) =================
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ========================= PII LOCKDOWN =========================
-- Base profiles table: only the owner or an admin may read full rows
-- (this hides email + full_name from other members).
drop policy if exists "profiles_read" on public.profiles;
drop policy if exists "profiles_read_self_or_admin" on public.profiles;
create policy "profiles_read_self_or_admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

-- Safe, everyone-readable projection for chat (names/avatars/role/domain only).
drop view if exists public.public_profiles cascade;
create or replace view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id from public.profiles;
grant select on public.public_profiles to authenticated;

-- ========================= TASKS =========================
create table if not exists public.tasks (
  id          bigint generated always as identity primary key,
  domain_id   int references public.domains(id),   -- null = applies to every domain
  week        int  not null,
  title       text not null,
  description text,
  file_path   text,
  file_name   text,
  due_at      timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists tasks_domain_week on public.tasks (domain_id, week);

-- ========================= SUBMISSIONS =========================
create table if not exists public.submissions (
  id           bigint generated always as identity primary key,
  task_id      bigint not null references public.tasks(id) on delete cascade,
  user_id      uuid   not null references public.profiles(id) on delete cascade,
  file_path    text,
  file_name    text,
  note         text,
  status       text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  feedback     text,
  graded_by    uuid references public.profiles(id),
  graded_at    timestamptz,
  submitted_at timestamptz not null default now(),
  unique (task_id, user_id)
);
create index if not exists submissions_user on public.submissions (user_id);

-- Students can't self-grade: any non-admin write re-queues the submission.
create or replace function public.protect_submission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.status    := 'submitted';
    new.feedback  := null;
    new.graded_by := null;
    new.graded_at := null;
  end if;
  return new;
end; $$;
drop trigger if exists protect_submission_trg on public.submissions;
create trigger protect_submission_trg before insert or update on public.submissions
  for each row execute function public.protect_submission();

-- ========================= RLS =========================
alter table public.tasks       enable row level security;
alter table public.submissions enable row level security;

-- tasks: students see global + their-domain tasks; admins see all; admins write
drop policy if exists "tasks_read" on public.tasks;
create policy "tasks_read" on public.tasks
  for select to authenticated using (
    domain_id is null
    or domain_id = (select domain_id from public.profiles where id = auth.uid())
    or public.is_admin()
  );
drop policy if exists "tasks_admin_write" on public.tasks;
create policy "tasks_admin_write" on public.tasks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- submissions: student sees/writes own; admin sees/updates all
drop policy if exists "subs_read" on public.submissions;
create policy "subs_read" on public.submissions
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "subs_insert" on public.submissions;
create policy "subs_insert" on public.submissions
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "subs_update" on public.submissions;
create policy "subs_update" on public.submissions
  for update to authenticated using (user_id = auth.uid() or public.is_admin());

-- ========================= DOCUMENTS (resume + other files) =========================
-- The binary lives in Cloudflare R2 (see R2_SETUP.md). We only store metadata here;
-- submissions.file_path and documents.file_key hold the R2 object key.
create table if not exists public.documents (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null default 'other' check (kind in ('resume','other')),
  file_key   text not null,
  file_name  text,
  created_at timestamptz not null default now()
);
create index if not exists documents_user on public.documents (user_id);

alter table public.documents enable row level security;
drop policy if exists "docs_read" on public.documents;
create policy "docs_read" on public.documents
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "docs_write" on public.documents;
create policy "docs_write" on public.documents
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "docs_delete" on public.documents;
create policy "docs_delete" on public.documents
  for delete to authenticated using (user_id = auth.uid());

-- NOTE: file storage is Cloudflare R2, not Supabase Storage. No storage bucket needed here
-- for tasks/resumes. (Avatars still use the Supabase 'avatars' bucket from schema.sql.)


-- ============================================================================
-- ===== supabase/003_gender_and_dm.sql =====
-- ============================================================================
-- ZeroDay Reapers — Portal Phase: gender/default avatar + admin DMs.
-- Run once in Supabase SQL Editor after 002. Idempotent.

-- ========================= GENDER + DEFAULT AVATAR =========================
alter table public.profiles add column if not exists gender text;
alter table public.profiles drop constraint if exists profiles_gender_chk;
alter table public.profiles add constraint profiles_gender_chk
  check (gender is null or gender in ('male','female'));

-- Signup trigger: store gender + pick the default avatar from it.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare meta jsonb := new.raw_user_meta_data;
begin
  insert into public.profiles (id, email, display_name, full_name, domain_id, gender, avatar_url)
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
    end
  );
  return new;
end; $$;

-- ========================= DIRECT MESSAGES (student <-> admins) =========================
-- One thread per student, shared by all admins. Students cannot DM each other.
create table if not exists public.dm_messages (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.profiles(id) on delete cascade, -- thread owner (the non-admin)
  sender_id  uuid not null references public.profiles(id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists dm_thread on public.dm_messages (student_id, created_at);
alter table public.dm_messages replica identity full;
alter table public.dm_messages enable row level security;

-- read: your own thread, or any admin
drop policy if exists "dm_read" on public.dm_messages;
create policy "dm_read" on public.dm_messages
  for select to authenticated using (student_id = auth.uid() or public.is_admin());

-- insert: a student may only write to THEIR OWN thread; an admin may write to any thread.
-- This makes student<->student DMs impossible (a student can't set student_id to someone else).
drop policy if exists "dm_insert" on public.dm_messages;
create policy "dm_insert" on public.dm_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and (
      (student_id = auth.uid() and not public.is_admin())
      or public.is_admin()
    )
  );

-- realtime (idempotent)
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='dm_messages') then
    alter publication supabase_realtime add table public.dm_messages;
  end if;
end $$;


-- ============================================================================
-- ===== supabase/004_task_attachments.sql =====
-- ============================================================================
-- ZeroDay Reapers — Portal Phase 4 migration: Add file attachment support to tasks.
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.

alter table public.tasks add column if not exists file_path text;
alter table public.tasks add column if not exists file_name text;


-- ============================================================================
-- ===== supabase/005_admin_delete_and_approval.sql =====
-- ============================================================================
-- ================== ACCOUNT APPROVAL STATUS ==================
alter table public.profiles add column if not exists status text not null default 'approved' check (status in ('pending', 'approved', 'rejected'));

-- Update public_profiles view to include status
drop view if exists public.public_profiles cascade;
create or replace view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status from public.profiles;
grant select on public.public_profiles to authenticated;

-- =============== AUTO-CREATE PROFILE ON SIGNUP WITH PENDING STATUS ===============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, full_name, domain_id, status)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'full_name',
    nullif(new.raw_user_meta_data->>'domain_id','')::int,
    'pending'
  );
  return new;
end; $$;

-- =============== ADMIN: SET APPROVAL STATUS ===============
create or replace function public.admin_set_status(target uuid, new_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.profiles set status = new_status where id = target;
end; $$;
grant execute on function public.admin_set_status(uuid, text) to authenticated;

-- =============== ADMIN: DELETE USER ACCOUNT ===============
create or replace function public.admin_delete_user(target_user_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized: only admins can delete users';
  end if;

  delete from public.profiles where id = target_user_id;
  delete from auth.users where id = target_user_id;
end; $$;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ===== PREVENT STUDENTS CHANGING THEIR OWN STATUS =====
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare is_admin boolean;
begin
  if auth.uid() is null then return new; end if;
  select (role = 'admin') into is_admin from public.profiles where id = auth.uid();
  if coalesce(is_admin,false) = false then
    if old.domain_id is not null then new.domain_id := old.domain_id; end if;
    new.role          := old.role;
    new.banned        := old.banned;
    new.timeout_until := old.timeout_until;
    new.status        := old.status;
  end if;
  return new;
end; $$;


-- ============================================================================
-- ===== supabase/006_kicked_emails_and_payment_proof.sql =====
-- ============================================================================
-- ================== KICKED EMAILS TRACKING ==================
create table if not exists public.kicked_emails (
  email text primary key,
  kicked_at timestamptz not null default now(),
  reason text
);

-- ================== PAYMENT PROOF COLUMNS ==================
alter table public.profiles add column if not exists payment_proof_url text;
alter table public.profiles add column if not exists payment_proof_submitted_at timestamptz;

drop view if exists public.public_profiles cascade;
create or replace view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, payment_proof_url from public.profiles;
grant select on public.public_profiles to authenticated;

-- =============== AUTO-CREATE PROFILE: INITIALLY APPROVED UNLESS PREVIOUSLY KICKED ===============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  user_status text;
begin
  if exists (select 1 from public.kicked_emails where lower(email) = lower(new.email)) then
    user_status := 'pending';
  else
    user_status := 'approved';
  end if;

  insert into public.profiles (id, email, display_name, full_name, domain_id, status)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'full_name',
    nullif(new.raw_user_meta_data->>'domain_id','')::int,
    user_status
  );
  return new;
end; $$;

-- =============== ADMIN: DELETE USER ACCOUNT AND RECORD IN KICKED_EMAILS ===============
create or replace function public.admin_delete_user(target_user_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized: only admins can delete users';
  end if;

  -- Record email in kicked_emails so re-registration requires approval
  insert into public.kicked_emails (email, reason)
  select lower(email), 'Admin deleted/kicked account' from public.profiles where id = target_user_id and email is not null
  on conflict (email) do update set kicked_at = now(), reason = 'Admin deleted/kicked account';

  delete from public.profiles where id = target_user_id;
  delete from auth.users where id = target_user_id;
end; $$;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- =============== ADMIN: SET APPROVAL STATUS (CLEARS KICKED STATUS IF APPROVED) ===============
create or replace function public.admin_set_status(target uuid, new_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.profiles set status = new_status where id = target;
  if new_status = 'approved' then
    delete from public.kicked_emails where lower(email) = (select lower(email) from public.profiles where id = target);
  end if;
end; $$;
grant execute on function public.admin_set_status(uuid, text) to authenticated;

-- =============== ADMIN/SYSTEM: AUDIT AND AUTO-REMOVE UNPAID INTERNS (WEEK 4) ===============
create or replace function public.audit_unpaid_interns()
returns int language plpgsql security definer set search_path = public, auth as $$
declare removed_count int := 0;
declare rec record;
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;

  for rec in select id, email from public.profiles where role <> 'admin' and payment_proof_url is null loop
    if rec.email is not null then
      insert into public.kicked_emails (email, reason) values (lower(rec.email), 'Auto-removed: No payment proof submitted by Week 4')
      on conflict (email) do update set kicked_at = now(), reason = 'Auto-removed: No payment proof submitted by Week 4';
    end if;

    delete from public.profiles where id = rec.id;
    delete from auth.users where id = rec.id;
    removed_count := removed_count + 1;
  end loop;

  return removed_count;
end; $$;
grant execute on function public.audit_unpaid_interns() to authenticated;

-- =============== TRIGGER: AUTO-REMOVE UNPAID INTERNS WHEN WEEK 4 TASK IS PUBLISHED ===============
create or replace function public.auto_remove_unpaid_on_week4()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare rec record;
begin
  if new.week >= 4 then
    for rec in select id, email from public.profiles where role <> 'admin' and payment_proof_url is null loop
      if rec.email is not null then
        insert into public.kicked_emails (email, reason) values (lower(rec.email), 'Auto-removed: No payment proof submitted by Week 4')
        on conflict (email) do update set kicked_at = now(), reason = 'Auto-removed: No payment proof submitted by Week 4';
      end if;

      delete from public.profiles where id = rec.id;
      delete from auth.users where id = rec.id;
    end loop;
  end if;
  return new;
end; $$;
drop trigger if exists trg_week4_unpaid_removal on public.tasks;
create trigger trg_week4_unpaid_removal
  after insert or update on public.tasks
  for each row execute function public.auto_remove_unpaid_on_week4();


-- ============================================================================
-- ===== supabase/007_alumni_and_retention.sql =====
-- ============================================================================
-- ================== ALUMNI GROUP & GRADUATION ==================
alter table public.profiles add column if not exists is_alumni boolean not null default false;

drop view if exists public.public_profiles cascade;
create or replace view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, payment_proof_url, is_alumni from public.profiles;
grant select on public.public_profiles to authenticated;

-- Insert Alumni Group into domains/rooms
insert into public.domains (key, name, sort) values ('alumni', 'Alumni Group', 8) on conflict (key) do nothing;

-- Admin RPC: set alumni status
create or replace function public.admin_set_alumni(target uuid, graduated boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.profiles set is_alumni = graduated where id = target;
end; $$;
grant execute on function public.admin_set_alumni(uuid, boolean) to authenticated;

-- Trigger: auto-graduate to Alumni when 6th task submission is approved
create or replace function public.auto_graduate_on_6_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  approved_count int;
begin
  if new.status = 'approved' then
    select count(*) into approved_count from public.submissions where student_id = new.student_id and status = 'approved';
    if approved_count >= 6 then
      update public.profiles set is_alumni = true where id = new.student_id;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_auto_graduate on public.submissions;
create trigger trg_auto_graduate
  after insert or update of status on public.submissions
  for each row execute function public.auto_graduate_on_6_tasks();

-- ================== 75-DAY DATA RETENTION CLEANUP ==================
create or replace function public.cleanup_75day_intern_data()
returns text[] language plpgsql security definer set search_path = public, auth as $$
declare
  expired_keys text[] := '{}';
  key text;
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;

  -- Collect file_keys from old submissions by non-admins (>75 days)
  for key in
    select s.file_key from public.submissions s
    join public.profiles p on p.id = s.student_id
    where p.role <> 'admin' and s.created_at < now() - interval '75 days' and s.file_key is not null
  loop
    expired_keys := array_append(expired_keys, key);
  end loop;

  -- Collect file_keys from old documents by non-admins (>75 days)
  for key in
    select d.file_key from public.documents d
    join public.profiles p on p.id = d.user_id
    where p.role <> 'admin' and d.created_at < now() - interval '75 days' and d.file_key is not null
  loop
    expired_keys := array_append(expired_keys, key);
  end loop;

  -- Delete old submissions
  delete from public.submissions where id in (
    select s.id from public.submissions s
    join public.profiles p on p.id = s.student_id
    where p.role <> 'admin' and s.created_at < now() - interval '75 days'
  );

  -- Delete old documents
  delete from public.documents where id in (
    select d.id from public.documents d
    join public.profiles p on p.id = d.user_id
    where p.role <> 'admin' and d.created_at < now() - interval '75 days'
  );

  -- Delete old messages in group chats
  delete from public.messages where id in (
    select m.id from public.messages m
    join public.profiles p on p.id = m.user_id
    where p.role <> 'admin' and m.created_at < now() - interval '75 days'
  );

  -- Delete old DM messages
  delete from public.dm_messages where id in (
    select dm.id from public.dm_messages dm
    join public.profiles p on p.id = dm.sender_id
    where p.role <> 'admin' and dm.created_at < now() - interval '75 days'
  );

  -- Clear payment proof if older than 75 days
  update public.profiles set payment_proof_url = null, payment_proof_submitted_at = null
  where role <> 'admin' and created_at < now() - interval '75 days';

  return expired_keys;
end; $$;
grant execute on function public.cleanup_75day_intern_data() to authenticated;

-- Update profile column protection to protect is_alumni
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare is_admin boolean;
begin
  if auth.uid() is null then return new; end if;
  select (role = 'admin') into is_admin from public.profiles where id = auth.uid();
  if coalesce(is_admin,false) = false then
    if old.domain_id is not null then new.domain_id := old.domain_id; end if;
    new.role          := old.role;
    new.banned        := old.banned;
    new.timeout_until := old.timeout_until;
    new.status        := old.status;
    new.is_alumni     := old.is_alumni;
  end if;
  return new;
end; $$;


-- ============================================================================
-- ===== supabase/008_automod_and_uncapped_chat.sql =====
-- ============================================================================
-- ================== AUTOMOD & 10-MINUTE TIMEOUT ==================
-- Automatically detect abuse/NSFW/slurs, timeout user for 10 mins, and remove message.

alter table public.dm_messages add column if not exists deleted boolean not null default false;

create or replace function public.automod_check_message()
returns trigger
language plpgsql
security definer
as $$
declare
  is_adm boolean;
  sender uuid;
begin
  if tg_table_name = 'dm_messages' then
    sender := new.sender_id;
  else
    sender := new.user_id;
  end if;

  select (role = 'admin') into is_adm from public.profiles where id = sender;

  if coalesce(is_adm, false) = false then
    if new.content ~* '\b(fuck|shit|bitch|asshole|cunt|dick|pussy|cock|bastard|whore|slut|nigger|faggot|retard|wank|twat|douche|jackass|motherfucker|bollocks|crap|piss|nsfw)\b' then
      -- Automatically timeout user for 10 minutes
      update public.profiles
      set timeout_until = now() + interval '10 minutes'
      where id = sender;

      -- Mark message as removed and flag content
      new.content := '⚠️ [Message removed by AutoMod: Abusive or NSFW language detected. User timed out for 10 minutes.]';
      new.deleted := true;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_automod_messages on public.messages;
create trigger trg_automod_messages
  before insert on public.messages
  for each row
  execute function public.automod_check_message();

drop trigger if exists trg_automod_dm on public.dm_messages;
create trigger trg_automod_dm
  before insert on public.dm_messages
  for each row
  execute function public.automod_check_message();

-- ================== ADMIN DELETE PERMISSIONS ==================
drop policy if exists "messages_admin_delete" on public.messages;
create policy "messages_admin_delete" on public.messages
  for delete to authenticated using (
    (select role from public.profiles where id = auth.uid()) = 'admin'
  );

drop policy if exists "dm_admin_update" on public.dm_messages;
create policy "dm_admin_update" on public.dm_messages
  for update to authenticated using (
    (select role from public.profiles where id = auth.uid()) = 'admin'
  );

drop policy if exists "dm_admin_delete" on public.dm_messages;
create policy "dm_admin_delete" on public.dm_messages
  for delete to authenticated using (
    (select role from public.profiles where id = auth.uid()) = 'admin'
  );

drop policy if exists "ann_admin_delete" on public.announcements;
create policy "ann_admin_delete" on public.announcements
  for delete to authenticated using (
    (select role from public.profiles where id = auth.uid()) = 'admin'
  );

-- ================== IDEMPOTENT PUBLIC_PROFILES VIEW ==================
drop view if exists public.public_profiles cascade;
create or replace view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, payment_proof_url, is_alumni from public.profiles;
grant select on public.public_profiles to authenticated;


-- ============================================================================
-- ===== supabase/009_link_approval_and_pinning.sql =====
-- ============================================================================
-- ================== LINK MODERATION & MESSAGE PINNING ==================

-- 1. Add columns for link moderation and pinning to messages
alter table public.messages add column if not exists link_status text not null default 'approved' check (link_status in ('approved', 'pending', 'rejected'));
alter table public.messages add column if not exists is_pinned boolean not null default false;
alter table public.messages add column if not exists pinned_at timestamptz;

-- 2. Add columns for pinning to announcements and DM messages
alter table public.announcements add column if not exists is_pinned boolean not null default false;
alter table public.announcements add column if not exists pinned_at timestamptz;
alter table public.dm_messages add column if not exists is_pinned boolean not null default false;
alter table public.dm_messages add column if not exists pinned_at timestamptz;

-- 3. Database Trigger: Automatically mark links sent by non-admins as pending approval
create or replace function public.check_link_approval()
returns trigger
language plpgsql
security definer
as $$
declare
  is_adm boolean;
begin
  select (role = 'admin') into is_adm from public.profiles where id = new.user_id;
  if coalesce(is_adm, false) = false then
    -- If message contains a web link or URL
    if new.content ~* '(https?://\s*[^\s]+|www\.\s*[^\s]+|\b[a-z0-9][a-z0-9.-]*\.(com|org|net|io|ai|pk|edu|gov|co|uk|us|ca|dev|app|tech|info|tv|gg|xyz|biz|au|de|fr|jp|cn|ru|br|nl|se|es|mil|int|site|online|store|shop|blog|club|vip|live|cloud|pro)\b(\/[^\s]*)?)' then
      new.link_status := 'pending';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_link_approval on public.messages;
create trigger trg_link_approval
  before insert on public.messages
  for each row
  execute function public.check_link_approval();

-- 4. Recreate public_profiles view idempotently
drop view if exists public.public_profiles cascade;
create or replace view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, payment_proof_url, is_alumni from public.profiles;
grant select on public.public_profiles to authenticated;


-- ============================================================================
-- ===== supabase/010_immutable_gender.sql =====
-- ============================================================================
-- ========================= IMMUTABLE GENDER AFTER CREATION =========================
-- Ensure gender cannot be modified by students or admins once set at account creation.

create or replace function public.prevent_gender_update()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.gender is distinct from old.gender and old.gender is not null then
    new.gender := old.gender;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_gender_update on public.profiles;
create trigger trg_prevent_gender_update
  before update on public.profiles
  for each row
  execute function public.prevent_gender_update();


-- ============================================================================
-- ===== supabase/011_fixes.sql =====
-- ============================================================================
-- ZeroDay Reapers — Corrective migration. Run once in Supabase SQL Editor after 010. Idempotent.
-- Fixes three confirmed defects introduced by earlier migrations:
--   C1  007 referenced submissions.student_id / submissions.file_key — the table has user_id / file_path.
--       (auto_graduate trigger errored on every submission insert/grade; cleanup used a non-existent column.)
--   C2  handle_new_user (006) dropped gender + default avatar — restored here alongside the kicked/status logic.
--   C3  Week-4 unpaid removal fired on INSERT *or UPDATE* — any later task edit re-ran a mass account delete.

-- ================= C1: auto-graduate uses the real column (user_id) =================
create or replace function public.auto_graduate_on_6_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
declare approved_count int;
begin
  if new.status = 'approved' then
    select count(*) into approved_count
      from public.submissions where user_id = new.user_id and status = 'approved';
    if approved_count >= 6 then
      update public.profiles set is_alumni = true where id = new.user_id;
    end if;
  end if;
  return new;
end; $$;

-- ================= C1: 75-day cleanup uses user_id + file_path on submissions =================
create or replace function public.cleanup_75day_intern_data()
returns text[] language plpgsql security definer set search_path = public, auth as $$
declare
  expired_keys text[] := '{}';
  key text;
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;

  -- submission files (submissions.file_path is the R2 key)
  for key in
    select s.file_path from public.submissions s
    join public.profiles p on p.id = s.user_id
    where p.role <> 'admin' and s.submitted_at < now() - interval '75 days' and s.file_path is not null
  loop
    expired_keys := array_append(expired_keys, key);
  end loop;

  -- document files (documents.file_key is the R2 key)
  for key in
    select d.file_key from public.documents d
    join public.profiles p on p.id = d.user_id
    where p.role <> 'admin' and d.created_at < now() - interval '75 days' and d.file_key is not null
  loop
    expired_keys := array_append(expired_keys, key);
  end loop;

  delete from public.submissions s
    using public.profiles p
    where p.id = s.user_id and p.role <> 'admin' and s.submitted_at < now() - interval '75 days';

  delete from public.documents d
    using public.profiles p
    where p.id = d.user_id and p.role <> 'admin' and d.created_at < now() - interval '75 days';

  delete from public.messages m
    using public.profiles p
    where p.id = m.user_id and p.role <> 'admin' and m.created_at < now() - interval '75 days';

  delete from public.dm_messages dm
    using public.profiles p
    where p.id = dm.sender_id and p.role <> 'admin' and dm.created_at < now() - interval '75 days';

  update public.profiles set payment_proof_url = null, payment_proof_submitted_at = null
    where role <> 'admin' and created_at < now() - interval '75 days';

  return expired_keys;
end; $$;

-- ================= C2: restore gender + default avatar in signup trigger =================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := new.raw_user_meta_data;
  user_status text;
begin
  -- previously kicked/deleted emails must be re-approved by an admin
  if exists (select 1 from public.kicked_emails where lower(email) = lower(new.email)) then
    user_status := 'pending';
  else
    user_status := 'approved';
  end if;

  insert into public.profiles (id, email, display_name, full_name, domain_id, gender, avatar_url, status)
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
    user_status
  );
  return new;
end; $$;

-- ================= C3: Week-4 unpaid removal only on INSERT (never on task edits) =================
drop trigger if exists trg_week4_unpaid_removal on public.tasks;
create trigger trg_week4_unpaid_removal
  after insert on public.tasks
  for each row execute function public.auto_remove_unpaid_on_week4();


-- ============================================================================
-- ===== supabase/012_preview_functions.sql =====
-- ============================================================================
-- ZeroDay Reapers — Read-only PREVIEW functions for the destructive operations.
-- Run once after 011. These DELETE NOTHING — they only report what *would* happen,
-- so you can test the Week-4 purge and 75-day cleanup safely before trusting them.
-- Admin-gated (in the SQL Editor auth.uid() is null, which is treated as privileged).

-- ---- Preview: who would the Week-4 unpaid purge remove? (M3) ----
create or replace function public.audit_unpaid_preview()
returns table(id uuid, email text, display_name text, domain_id int, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where profiles.id = auth.uid()) is distinct from 'admin'
     and auth.uid() is not null then
    raise exception 'not authorized';
  end if;
  return query
    select p.id, p.email, p.display_name, p.domain_id, p.created_at
    from public.profiles p
    where p.role <> 'admin' and p.payment_proof_url is null
    order by p.created_at;
end; $$;
grant execute on function public.audit_unpaid_preview() to authenticated;

-- ---- Preview: what would the 75-day cleanup delete? (M4) ----
create or replace function public.cleanup_75day_preview()
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if (select role from public.profiles where profiles.id = auth.uid()) is distinct from 'admin'
     and auth.uid() is not null then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'submissions_to_delete', (
      select count(*) from public.submissions s join public.profiles p on p.id = s.user_id
      where p.role <> 'admin' and s.submitted_at < now() - interval '75 days'),
    'documents_to_delete', (
      select count(*) from public.documents d join public.profiles p on p.id = d.user_id
      where p.role <> 'admin' and d.created_at < now() - interval '75 days'),
    'messages_to_delete', (
      select count(*) from public.messages m join public.profiles p on p.id = m.user_id
      where p.role <> 'admin' and m.created_at < now() - interval '75 days'),
    'dm_messages_to_delete', (
      select count(*) from public.dm_messages dm join public.profiles p on p.id = dm.sender_id
      where p.role <> 'admin' and dm.created_at < now() - interval '75 days'),
    'r2_keys_sample', (
      select coalesce(jsonb_agg(k), '[]'::jsonb) from (
        select s.file_path k from public.submissions s join public.profiles p on p.id = s.user_id
          where p.role <> 'admin' and s.submitted_at < now() - interval '75 days' and s.file_path is not null
        union all
        select d.file_key from public.documents d join public.profiles p on p.id = d.user_id
          where p.role <> 'admin' and d.created_at < now() - interval '75 days' and d.file_key is not null
        limit 20
      ) t)
  ) into result;
  return result;
end; $$;
grant execute on function public.cleanup_75day_preview() to authenticated;


-- ============================================================================
-- ===== supabase/013_manual_graduation_and_fee_confirm.sql =====
-- ============================================================================
-- ZeroDay Reapers — Manual graduation + admin fee confirmation. Run after 012. Idempotent.
-- 1. Graduation is now MANUAL only (admin presses Graduate) — remove the auto-graduate trigger.
-- 2. Add an admin "Confirm Fee" flag (payment_confirmed) separate from account status.
--    Note: the Week-4 purge still targets students with NO proof uploaded (payment_proof_url is null);
--    payment_confirmed is a review marker and does not affect removal.

-- ---- 1. Stop auto-graduation on 6 approved tasks (Graduate button remains) ----
drop trigger if exists trg_auto_graduate on public.submissions;

-- ---- 2. Fee confirmation flag ----
alter table public.profiles add column if not exists payment_confirmed boolean not null default false;

-- Admins only can confirm/unconfirm a student's fee.
create or replace function public.admin_set_payment_confirmed(target uuid, confirmed boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.profiles set payment_confirmed = confirmed where id = target;
end; $$;
grant execute on function public.admin_set_payment_confirmed(uuid, boolean) to authenticated;

-- Students may still upload their own payment_proof_url, but cannot self-confirm.
-- (Re-declare the guard with payment_confirmed added; keeps all existing protections.)
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare is_admin boolean;
begin
  if auth.uid() is null then return new; end if;
  select (role = 'admin') into is_admin from public.profiles where id = auth.uid();
  if coalesce(is_admin,false) = false then
    if old.domain_id is not null then new.domain_id := old.domain_id; end if;
    new.role              := old.role;
    new.banned            := old.banned;
    new.timeout_until     := old.timeout_until;
    new.status            := old.status;
    new.is_alumni         := old.is_alumni;
    new.payment_confirmed := old.payment_confirmed;
  end if;
  return new;
end; $$;


-- ============================================================================
-- ===== supabase/014_audit_log_and_reports.sql =====
-- ============================================================================
-- ZeroDay Reapers — Admin audit log + message reports. Run after 013. Idempotent.

-- ================= AUDIT LOG =================
create table if not exists public.admin_actions (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_name  text,
  action      text not null,
  target_id   uuid references public.profiles(id) on delete set null,
  target_name text,
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists admin_actions_time on public.admin_actions (created_at desc);
alter table public.admin_actions enable row level security;
drop policy if exists "audit_read" on public.admin_actions;
create policy "audit_read" on public.admin_actions
  for select to authenticated using (public.is_admin());
-- inserts happen only inside SECURITY DEFINER RPCs (which bypass RLS) — no client insert policy.

create or replace function public.log_admin_action(p_action text, p_target uuid, p_detail text)
returns void language plpgsql security definer set search_path = public as $$
declare a_name text; t_name text;
begin
  select display_name into a_name from public.profiles where id = auth.uid();
  select display_name into t_name from public.profiles where id = p_target;
  insert into public.admin_actions (actor_id, actor_name, action, target_id, target_name, detail)
  values (auth.uid(), a_name, p_action, p_target, t_name, p_detail);
end; $$;

-- ================= WIRE LOGGING INTO EVERY ADMIN RPC =================
create or replace function public.admin_set_domain(target uuid, new_domain int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then raise exception 'not authorized'; end if;
  update public.profiles set domain_id = new_domain where id = target;
  perform public.log_admin_action('domain_move', target, 'domain_id=' || new_domain);
end; $$;

create or replace function public.admin_set_ban(target uuid, is_banned boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then raise exception 'not authorized'; end if;
  update public.profiles set banned = is_banned where id = target;
  perform public.log_admin_action(case when is_banned then 'ban' else 'unban' end, target, null);
end; $$;

create or replace function public.admin_set_timeout(target uuid, minutes int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then raise exception 'not authorized'; end if;
  update public.profiles
     set timeout_until = case when minutes is null or minutes <= 0 then null else now() + make_interval(mins => minutes) end
   where id = target;
  perform public.log_admin_action('timeout', target, 'minutes=' || coalesce(minutes, 0));
end; $$;

create or replace function public.admin_set_status(target uuid, new_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then raise exception 'not authorized'; end if;
  update public.profiles set status = new_status where id = target;
  if new_status = 'approved' then
    delete from public.kicked_emails where lower(email) = (select lower(email) from public.profiles where id = target);
  end if;
  perform public.log_admin_action('set_status', target, new_status);
end; $$;

create or replace function public.admin_set_alumni(target uuid, graduated boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then raise exception 'not authorized'; end if;
  update public.profiles set is_alumni = graduated where id = target;
  perform public.log_admin_action(case when graduated then 'graduate' else 'revoke_alumni' end, target, null);
end; $$;

create or replace function public.admin_set_payment_confirmed(target uuid, confirmed boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then raise exception 'not authorized'; end if;
  update public.profiles set payment_confirmed = confirmed where id = target;
  perform public.log_admin_action(case when confirmed then 'confirm_fee' else 'revoke_fee' end, target, null);
end; $$;

create or replace function public.admin_delete_user(target_user_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized: only admins can delete users';
  end if;
  perform public.log_admin_action('delete_user', target_user_id, null); -- before delete (FK still valid)
  insert into public.kicked_emails (email, reason)
  select lower(email), 'Admin deleted/kicked account' from public.profiles where id = target_user_id and email is not null
  on conflict (email) do update set kicked_at = now(), reason = 'Admin deleted/kicked account';
  delete from public.profiles where id = target_user_id;
  delete from auth.users where id = target_user_id;
end; $$;

-- ================= MESSAGE REPORTS =================
create table if not exists public.message_reports (
  id          bigint generated always as identity primary key,
  message_id  bigint not null references public.messages(id) on delete cascade,
  reporter_id uuid   not null references public.profiles(id) on delete cascade,
  reason      text,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists message_reports_open on public.message_reports (resolved, created_at desc);
alter table public.message_reports enable row level security;
drop policy if exists "reports_insert" on public.message_reports;
create policy "reports_insert" on public.message_reports
  for insert to authenticated with check (reporter_id = auth.uid());
drop policy if exists "reports_read" on public.message_reports;
create policy "reports_read" on public.message_reports
  for select to authenticated using (public.is_admin());
drop policy if exists "reports_update" on public.message_reports;
create policy "reports_update" on public.message_reports
  for update to authenticated using (public.is_admin());


-- ============================================================================
-- ===== supabase/015_ram_specs.sql =====
-- ============================================================================
-- ZeroDay Reapers — RAM specs on signup + RAM-scoped tasks. Run after 014. Idempotent.
-- Students pick RAM (8GB/16GB/24GB) at signup; can't change it later. Admins can.
-- Tasks are tagged for a RAM tier (or 'All RAM' = null); students only see tasks for their RAM.

-- ---- profiles.ram ----
alter table public.profiles add column if not exists ram text;
alter table public.profiles drop constraint if exists profiles_ram_chk;
alter table public.profiles add constraint profiles_ram_chk
  check (ram is null or ram in ('8GB','16GB','24GB'));

-- ---- tasks.ram (null = every RAM tier) ----
alter table public.tasks add column if not exists ram text;
alter table public.tasks drop constraint if exists tasks_ram_chk;
alter table public.tasks add constraint tasks_ram_chk
  check (ram is null or ram in ('8GB','16GB','24GB'));

-- ---- signup trigger: store ram (keeps gender/avatar/status/kicked logic) ----
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

  insert into public.profiles (id, email, display_name, full_name, domain_id, gender, avatar_url, status, ram)
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
    nullif(meta->>'ram','')
  );
  return new;
end; $$;

-- ---- students can't change their own ram (admins can, via admin_set_ram) ----
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare is_admin boolean;
begin
  if auth.uid() is null then return new; end if;
  select (role = 'admin') into is_admin from public.profiles where id = auth.uid();
  if coalesce(is_admin,false) = false then
    if old.domain_id is not null then new.domain_id := old.domain_id; end if;
    new.role              := old.role;
    new.banned            := old.banned;
    new.timeout_until     := old.timeout_until;
    new.status            := old.status;
    new.is_alumni         := old.is_alumni;
    new.payment_confirmed := old.payment_confirmed;
    new.ram               := old.ram;
  end if;
  return new;
end; $$;

-- ---- admin changes a student's ram ----
create or replace function public.admin_set_ram(target uuid, new_ram text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then raise exception 'not authorized'; end if;
  update public.profiles set ram = new_ram where id = target;
  perform public.log_admin_action('set_ram', target, new_ram);
end; $$;
grant execute on function public.admin_set_ram(uuid, text) to authenticated;

-- ---- tasks visible to a student: matching domain AND matching RAM (or untagged) ----
drop policy if exists "tasks_read" on public.tasks;
create policy "tasks_read" on public.tasks
  for select to authenticated using (
    public.is_admin()
    or (
      (domain_id is null or domain_id = (select domain_id from public.profiles where id = auth.uid()))
      and (ram is null or ram = (select ram from public.profiles where id = auth.uid()))
    )
  );

-- expose ram on the safe view (handy for admin lists / badges)
drop view if exists public.public_profiles cascade;
create or replace view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, payment_proof_url, is_alumni, ram
  from public.profiles;
grant select on public.public_profiles to authenticated;


-- ============================================================================
-- ===== supabase/016_mentions.sql =====
-- ============================================================================
-- 016_mentions.sql — @mentions with a persistent inbox (unread badge) + realtime beep.
-- Idempotent: safe to re-run.

create table if not exists public.mentions (
  id                bigint generated always as identity primary key,
  message_id        bigint references public.messages(id) on delete cascade, -- optional link
  domain_id         int references public.domains(id),
  author_id         uuid not null references public.profiles(id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles(id) on delete cascade,
  content           text,               -- snapshot for the inbox preview
  read              boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists mentions_recipient
  on public.mentions (mentioned_user_id, read, created_at desc);

alter table public.mentions enable row level security;

-- Recipient (or an admin) can read their mentions.
drop policy if exists mentions_select on public.mentions;
create policy mentions_select on public.mentions
  for select using (mentioned_user_id = auth.uid() or public.is_admin());

-- Only the message author may create a mention, and only as themselves.
drop policy if exists mentions_insert on public.mentions;
create policy mentions_insert on public.mentions
  for insert with check (author_id = auth.uid());

-- Recipient can mark their own mentions read.
drop policy if exists mentions_update_own on public.mentions;
create policy mentions_update_own on public.mentions
  for update using (mentioned_user_id = auth.uid())
  with check (mentioned_user_id = auth.uid());

-- Realtime (idempotent add).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mentions'
  ) then
    alter publication supabase_realtime add table public.mentions;
  end if;
end $$;


-- ============================================================================
-- ===== supabase/017_message_counts.sql =====
-- ============================================================================
-- 017_message_counts.sql — admin-only message-count analytics.
-- SECURITY DEFINER so counts span all rooms; every function guards on is_admin().
-- Idempotent: safe to re-run.

-- Per-room counts (used in the chat members sidebar).
create or replace function public.room_message_counts(p_domain_id int)
returns table(user_id uuid, cnt bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
    select m.user_id, count(*)::bigint
    from public.messages m
    where m.domain_id = p_domain_id and m.deleted = false
    group by m.user_id;
end $$;

-- Global leaderboard across every group chat (used in the Admin panel).
create or replace function public.global_message_counts(p_limit int default 25)
returns table(user_id uuid, display_name text, domain_id int, cnt bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
    select m.user_id, pp.display_name, pp.domain_id, count(*)::bigint as c
    from public.messages m
    left join public.profiles pp on pp.id = m.user_id
    where m.deleted = false
    group by m.user_id, pp.display_name, pp.domain_id
    order by c desc
    limit greatest(1, p_limit);
end $$;

grant execute on function public.room_message_counts(int) to authenticated;
grant execute on function public.global_message_counts(int) to authenticated;


-- ============================================================================
-- ===== supabase/018_submission_versioning.sql =====
-- ============================================================================
-- 018_submission_versioning.sql — keep every submission attempt (not just the latest).
-- `submissions` stays the "current/latest" pointer used for grading; each uploaded
-- file is also recorded here as an immutable history row. Idempotent: safe to re-run.

create table if not exists public.submission_files (
  id            bigint generated always as identity primary key,
  submission_id bigint references public.submissions(id) on delete cascade,
  task_id       bigint references public.tasks(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  file_path     text not null,   -- R2 key: submissions/{uid}/task-{taskId}-{ts}.ext
  file_name     text,
  uploaded_at   timestamptz not null default now()
);

create index if not exists submission_files_lookup
  on public.submission_files (task_id, user_id, uploaded_at desc);

alter table public.submission_files enable row level security;

-- Owner (or admin) can read a submission's version history.
drop policy if exists subfiles_select on public.submission_files;
create policy subfiles_select on public.submission_files
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Students record their own versions; history is append-only (no update/delete policy).
drop policy if exists subfiles_insert on public.submission_files;
create policy subfiles_insert on public.submission_files
  for insert to authenticated with check (user_id = auth.uid());


-- ============================================================================
-- ===== supabase/019_bulk_approve.sql =====
-- ============================================================================
-- 019_bulk_approve.sql — admin bulk-approve submissions in one call.
-- SECURITY DEFINER, is_admin()-gated, logs to the audit trail. Idempotent.

create or replace function public.admin_bulk_approve_submissions(ids bigint[])
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.submissions
    set status = 'approved', graded_by = auth.uid(), graded_at = now()
    where id = any(ids) and status is distinct from 'approved';
  get diagnostics n = row_count;
  perform public.log_admin_action('bulk_approve_submissions', null, 'count=' || n);
  return n;
end $$;

grant execute on function public.admin_bulk_approve_submissions(bigint[]) to authenticated;


-- ============================================================================
-- ===== supabase/020_task_extensions.sql =====
-- ============================================================================
-- 020_task_extensions.sql — students can request extra time on a task; admins grant/deny.
-- Idempotent: safe to re-run.

create table if not exists public.task_extension_requests (
  id             bigint generated always as identity primary key,
  task_id        bigint not null references public.tasks(id) on delete cascade,
  user_id        uuid   not null references public.profiles(id) on delete cascade,
  reason         text,
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  extended_until timestamptz,           -- new deadline when approved
  decided_by     uuid references public.profiles(id),
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists ter_lookup on public.task_extension_requests (user_id, task_id, created_at desc);
create index if not exists ter_pending on public.task_extension_requests (status, created_at desc);

alter table public.task_extension_requests enable row level security;

-- Student reads own requests; admins read all.
drop policy if exists ter_select on public.task_extension_requests;
create policy ter_select on public.task_extension_requests
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Student creates their own requests. Decisions go through the RPC below
-- (SECURITY DEFINER), so there is intentionally no client UPDATE policy —
-- a student cannot approve their own request.
drop policy if exists ter_insert on public.task_extension_requests;
create policy ter_insert on public.task_extension_requests
  for insert to authenticated with check (user_id = auth.uid());

-- Admin grants or denies an extension (logs to the audit trail).
create or replace function public.admin_decide_extension(p_request_id bigint, p_approve boolean, p_extra_days int default 7)
returns void language plpgsql security definer set search_path = public as $$
declare r_user uuid; r_task bigint; r_due timestamptz;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select er.user_id, er.task_id, t.due_at into r_user, r_task, r_due
  from public.task_extension_requests er
  join public.tasks t on t.id = er.task_id
  where er.id = p_request_id;
  if r_user is null then raise exception 'request not found'; end if;

  update public.task_extension_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      extended_until = case when p_approve then coalesce(r_due, now()) + make_interval(days => greatest(1, p_extra_days)) else null end,
      decided_by = auth.uid(),
      decided_at = now()
  where id = p_request_id;

  perform public.log_admin_action(
    case when p_approve then 'grant_extension' else 'deny_extension' end,
    r_user,
    'task_id=' || r_task || case when p_approve then ' +' || greatest(1, p_extra_days) || 'd' else '' end);
end $$;

grant execute on function public.admin_decide_extension(bigint, boolean, int) to authenticated;


-- ============================================================================
-- ===== supabase/021_security_hardening.sql =====
-- ============================================================================
-- 021_security_hardening.sql — OWASP review fixes. Idempotent; safe to re-run.

-- (1) Stop leaking payment_proof_url via the public view.
-- Nothing reads it from the view (chat/DM only need name/avatar/role/alumni; admins
-- read the base profiles table under RLS). Recreate the view without it.
-- Payment proofs also move to private R2 storage (see app changes) — the value stored
-- in profiles.payment_proof_url becomes an R2 key, fetched via a presigned download.
drop view if exists public.public_profiles cascade;
create view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, is_alumni, ram
  from public.profiles;
grant select on public.public_profiles to authenticated;

-- (2) Lock down kicked_emails (PII: emails + reasons of removed users).
-- Only admins may read it via the API. The SECURITY DEFINER functions that write it
-- (handle_new_user, admin_delete_user, audit_unpaid_interns, admin_set_status) run as
-- the table owner and bypass RLS, so signup + removal flows keep working.
alter table public.kicked_emails enable row level security;

drop policy if exists kicked_emails_read on public.kicked_emails;
create policy kicked_emails_read on public.kicked_emails
  for select to authenticated using (public.is_admin());
-- No insert/update/delete policies: direct API writes are denied; only the
-- SECURITY DEFINER functions (which bypass RLS) modify this table.


-- ============================================================================
-- ===== supabase/022_admin_profile_edits.sql =====
-- ============================================================================
-- 022_admin_profile_edits.sql — admins can set gender (own + others) and edit any
-- user's core profile fields (never email/password). Idempotent; safe to re-run.

-- Allow ADMINS to change gender; non-admins stay locked once it's set.
-- auth.uid() null = SQL editor / service role → allowed.
create or replace function public.prevent_gender_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare acting_admin boolean;
begin
  if auth.uid() is null then return new; end if;
  select (role = 'admin') into acting_admin from public.profiles where id = auth.uid();
  if new.gender is distinct from old.gender
     and old.gender is not null
     and coalesce(acting_admin, false) = false then
    new.gender := old.gender; -- students can't change gender after signup
  end if;
  return new;
end; $$;

-- Admin edits another user's core profile (display name, full name, gender).
-- Email + password are auth.users concerns and are intentionally NOT touchable here.
create or replace function public.admin_update_profile(target uuid, p_display_name text, p_full_name text, p_gender text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.profiles set
    display_name = coalesce(nullif(btrim(p_display_name), ''), display_name),
    full_name    = nullif(btrim(coalesce(p_full_name, '')), ''),
    gender       = case when p_gender in ('male', 'female') then p_gender else gender end
  where id = target;
  perform public.log_admin_action('update_profile', target, 'edited name/gender');
end $$;

grant execute on function public.admin_update_profile(uuid, text, text, text) to authenticated;


-- ============================================================================
-- ===== supabase/023_discord_and_classroom.sql =====
-- ============================================================================
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


-- ============================================================================
-- ===== supabase/024_email_reminders.sql =====
-- ============================================================================
-- 024_email_reminders.sql — de-dup markers for the deadline-reminder cron. Run after 023. Idempotent.
-- One row per (task, student) once a reminder email has been sent, so the daily cron never
-- emails the same student twice for the same task. Written/read only by the service-role cron.

create table if not exists public.task_deadline_reminders (
  task_id bigint      not null references public.tasks(id)    on delete cascade,
  user_id uuid        not null references public.profiles(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

alter table public.task_deadline_reminders enable row level security;
-- No policies on purpose: the cron uses the service role (bypasses RLS); no client may touch it.


-- ============================================================================
-- ===== supabase/025_activity_and_sessions.sql =====
-- ============================================================================
-- 025_activity_and_sessions.sql — activity timeline + admin-managed live sessions. Run after 024. Idempotent.

-- ========================= ACTIVITY EVENTS =========================
create table if not exists public.activity_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,   -- login | submission_created | submission_graded | graduated
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_events_user_time on public.activity_events (user_id, created_at desc);

alter table public.activity_events enable row level security;

-- users read only their own events
drop policy if exists "activity_read_own" on public.activity_events;
create policy "activity_read_own" on public.activity_events
  for select to authenticated using (user_id = auth.uid());
-- (no client insert/update/delete policy: all writes go through the function/triggers below)

-- log an event for the current user — client calls this for login / submission_created
create or replace function public.log_my_activity(p_type text, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.activity_events (user_id, type, meta)
  values (auth.uid(), p_type, coalesce(p_meta, '{}'::jsonb));
end; $$;
grant execute on function public.log_my_activity(text, jsonb) to authenticated;

-- trigger: log when a submission is graded (approved/rejected)
create or replace function public.trg_log_submission_graded()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('approved','rejected') then
    insert into public.activity_events (user_id, type, meta)
    values (new.user_id, 'submission_graded', jsonb_build_object('task_id', new.task_id, 'status', new.status));
  end if;
  return new;
end; $$;
drop trigger if exists log_submission_graded on public.submissions;
create trigger log_submission_graded after update on public.submissions
  for each row execute function public.trg_log_submission_graded();

-- trigger: log when a student is graduated to alumni
create or replace function public.trg_log_graduated()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_alumni is distinct from old.is_alumni and new.is_alumni = true then
    insert into public.activity_events (user_id, type, meta) values (new.id, 'graduated', '{}'::jsonb);
  end if;
  return new;
end; $$;
drop trigger if exists log_graduated on public.profiles;
create trigger log_graduated after update on public.profiles
  for each row execute function public.trg_log_graduated();

-- ========================= LIVE SESSIONS =========================
create table if not exists public.live_sessions (
  id          bigint generated always as identity primary key,
  title       text not null,
  description text,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  join_url    text,
  domain_id   int references public.domains(id),  -- null = all departments
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists live_sessions_time on public.live_sessions (starts_at);

alter table public.live_sessions enable row level security;

-- read: sessions for your department or global; admins read all
drop policy if exists "sessions_read" on public.live_sessions;
create policy "sessions_read" on public.live_sessions
  for select to authenticated using (
    public.is_admin()
    or domain_id is null
    or domain_id = (select domain_id from public.profiles where id = auth.uid())
  );

-- only admins create/update/delete
drop policy if exists "sessions_admin_write" on public.live_sessions;
create policy "sessions_admin_write" on public.live_sessions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ============================================================================
-- ===== supabase/026_feedback.sql =====
-- ============================================================================
-- 026_feedback.sql — student feedback/ratings with admin approval + public testimonials.
-- Run after 025. Idempotent.

create table if not exists public.feedback (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  rating_program int  not null check (rating_program between 1 and 5),
  rating_portal  int  not null check (rating_portal between 1 and 5),
  body           text not null check (char_length(body) between 1 and 2000),
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  approved_by    uuid references public.profiles(id),
  approved_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists feedback_status_time on public.feedback (status, created_at desc);

alter table public.feedback enable row level security;

-- students submit their own feedback
drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own" on public.feedback
  for insert to authenticated with check (user_id = auth.uid());

-- read: your own rows, any approved row, or admin (all)
drop policy if exists "feedback_read" on public.feedback;
create policy "feedback_read" on public.feedback
  for select to authenticated using (
    user_id = auth.uid() or status = 'approved' or public.is_admin()
  );

-- approved rows are readable by anon too (public marketing site)
drop policy if exists "feedback_read_anon_approved" on public.feedback;
create policy "feedback_read_anon_approved" on public.feedback
  for select to anon using (status = 'approved');

-- admin approve/reject (audit-logged)
create or replace function public.admin_set_feedback_status(p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('pending','approved','rejected') then raise exception 'bad status'; end if;
  update public.feedback
     set status      = p_status,
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'approved' then now()      else approved_at end
   where id = p_id;
  perform public.log_admin_action('set_feedback_status', null, p_status);
end; $$;
grant execute on function public.admin_set_feedback_status(bigint, text) to authenticated;

-- public testimonials view: approved feedback + author display name/domain, safe columns only.
-- Owned by the migration role, so it reads under owner privileges (like public_profiles).
drop view if exists public.public_testimonials cascade;
create view public.public_testimonials as
  select f.id, p.display_name, d.name as domain,
         f.rating_program, f.rating_portal, f.body, f.created_at
  from public.feedback f
  join public.profiles p on p.id = f.user_id
  left join public.domains d on d.id = p.domain_id
  where f.status = 'approved'
  order by f.created_at desc;
grant select on public.public_testimonials to anon, authenticated;


-- ============================================================================
-- ===== supabase/027_security.sql =====
-- ============================================================================
-- 027_security.sql — device tracking (new-device alerts + active-devices list) + password-change marker.
-- Run after 026. Idempotent.

-- password-change marker (shown on the Security panel)
alter table public.profiles add column if not exists password_changed_at timestamptz;

-- known devices/browsers per user
create table if not exists public.user_devices (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  device_id  text not null,            -- random id persisted in the browser (localStorage)
  user_agent text,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  revoked_at timestamptz,                 -- set when this device is logged out from elsewhere
  unique (user_id, device_id)
);
create index if not exists user_devices_user on public.user_devices (user_id, last_seen desc);

alter table public.user_devices enable row level security;

drop policy if exists "devices_read_own" on public.user_devices;
create policy "devices_read_own" on public.user_devices
  for select to authenticated using (user_id = auth.uid());
-- users may forget their own devices from the Security panel
drop policy if exists "devices_delete_own" on public.user_devices;
create policy "devices_delete_own" on public.user_devices
  for delete to authenticated using (user_id = auth.uid());
-- inserts/updates go through register_device (SECURITY DEFINER) only

-- register a device on login; returns TRUE if it's new for this user (→ send a new-device alert).
create or replace function public.register_device(p_device_id text, p_user_agent text)
returns boolean language plpgsql security definer set search_path = public as $$
declare is_new boolean;
begin
  if auth.uid() is null then return false; end if;
  insert into public.user_devices (user_id, device_id, user_agent)
  values (auth.uid(), p_device_id, p_user_agent)
  on conflict (user_id, device_id)
    do update set last_seen = now(), user_agent = excluded.user_agent, revoked_at = null  -- a fresh login clears any prior revoke
  returning (xmax = 0) into is_new;   -- xmax = 0 ⇒ the row was INSERTed (new device), not updated
  return coalesce(is_new, false);
end; $$;
grant execute on function public.register_device(text, text) to authenticated;

-- Log out one specific device: mark it revoked. That device sees the change (Realtime) and
-- signs itself out. Users can only revoke their own devices.
create or replace function public.revoke_device(p_device_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update public.user_devices set revoked_at = now()
   where user_id = auth.uid() and device_id = p_device_id;
end; $$;
grant execute on function public.revoke_device(text) to authenticated;

-- Realtime so a revoked device is signed out promptly (full row so device_id is in the payload).
alter table public.user_devices replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='user_devices') then
    alter publication supabase_realtime add table public.user_devices;
  end if;
end $$;


-- ============================================================================
-- ===== supabase/028_founder_role.sql =====
-- ============================================================================
-- 028_founder_role.sql — Founder tier (a super-admin over the admin tier). Run after 027. Idempotent.
--
-- A FOUNDER is an admin (role='admin') carrying is_founder=true, so it inherits EVERY admin
-- capability automatically (is_admin(), all RLS, all admin RPCs) — nothing to special-case.
-- On top of that, ONLY a founder may delete / ban / edit other ADMIN accounts. Regular admins
-- keep managing students only. Enforced in the DB (triggers), so it holds even if a client is bypassed.
--
-- This migration also fixes the reason admins couldn't be deleted at all: four FKs pointed at the
-- admin who graded/decided/created/approved a row with the default (blocking) ON DELETE action.

-- 1) Founder flag ---------------------------------------------------------------------------------
alter table public.profiles add column if not exists is_founder boolean not null default false;

-- 2) Fix admin-referencing FKs so deleting an admin no longer violates a foreign key.
--    Keep the history row, just null out the reference to the departed admin.
alter table public.submissions              drop constraint if exists submissions_graded_by_fkey;
alter table public.submissions              add  constraint submissions_graded_by_fkey
  foreign key (graded_by)  references public.profiles(id) on delete set null;

alter table public.task_extension_requests  drop constraint if exists task_extension_requests_decided_by_fkey;
alter table public.task_extension_requests  add  constraint task_extension_requests_decided_by_fkey
  foreign key (decided_by) references public.profiles(id) on delete set null;

alter table public.live_sessions            drop constraint if exists live_sessions_created_by_fkey;
alter table public.live_sessions            add  constraint live_sessions_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.feedback                 drop constraint if exists feedback_approved_by_fkey;
alter table public.feedback                 add  constraint feedback_approved_by_fkey
  foreign key (approved_by) references public.profiles(id) on delete set null;

-- 3) Helper: is the caller a founder? (no RLS recursion, like is_admin) ---------------------------
create or replace function public.is_founder()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_founder = true);
$$;

-- 4) Column protection (extends 023): only a founder may grant/revoke is_founder, and a
--    NON-founder admin may not modify another admin/founder's protected columns.
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare caller_role text; caller_founder boolean; target_is_staff boolean;
begin
  if auth.uid() is null then return new; end if;              -- SQL editor / service role bypass
  select role, is_founder into caller_role, caller_founder from public.profiles where id = auth.uid();
  target_is_staff := (old.role = 'admin' or coalesce(old.is_founder, false));

  -- is_founder can only ever be granted/revoked by an existing founder.
  if (new.is_founder is distinct from old.is_founder) and coalesce(caller_founder, false) = false then
    new.is_founder := old.is_founder;
  end if;

  if coalesce(caller_role, 'student') <> 'admin' then
    -- non-admin: lock every protected column (original 023 behavior).
    if old.domain_id is not null then new.domain_id := old.domain_id; end if;
    new.role := old.role; new.banned := old.banned; new.timeout_until := old.timeout_until;
    new.status := old.status; new.is_alumni := old.is_alumni; new.payment_confirmed := old.payment_confirmed;
    new.ram := old.ram; new.discord_id := old.discord_id; new.discord_username := old.discord_username;
    new.classroom_confirmed := old.classroom_confirmed; new.is_founder := old.is_founder;
  elsif target_is_staff and coalesce(caller_founder, false) = false and auth.uid() <> old.id then
    -- a non-founder admin must not touch another admin/founder's protected columns.
    new.role := old.role; new.banned := old.banned; new.timeout_until := old.timeout_until;
    new.status := old.status; new.is_alumni := old.is_alumni; new.payment_confirmed := old.payment_confirmed;
    new.ram := old.ram; new.domain_id := old.domain_id;
    new.discord_id := old.discord_id; new.discord_username := old.discord_username;
    new.classroom_confirmed := old.classroom_confirmed; new.is_founder := old.is_founder;
  end if;
  return new;
end; $$;

-- 5) Deletion guard: an admin/founder row can only be deleted by a founder, and a founder
--    account can't be deleted through the app at all (remove via SQL to avoid a top-tier lockout).
--    auth.uid() is null (dashboard / SQL / service role) bypasses — that's the intended escape hatch.
create or replace function public.guard_staff_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return old; end if;             -- SQL editor / dashboard / service role bypass
  if (old.role = 'admin' or coalesce(old.is_founder, false)) then
    if not public.is_founder() then
      raise exception 'Only a founder can delete an admin account.';
    end if;
    if coalesce(old.is_founder, false) then
      raise exception 'A founder account cannot be deleted from the app — remove it via SQL.';
    end if;
  end if;
  return old;
end; $$;

drop trigger if exists trg_guard_staff_delete on public.profiles;
create trigger trg_guard_staff_delete
  before delete on public.profiles
  for each row execute function public.guard_staff_delete();

-- ------------------------------------------------------------------------------------------------
-- CREATE YOUR FOUNDER: the account must already exist (sign up / be an admin), then run once:
--   update public.profiles set role = 'admin', is_founder = true where lower(email) = lower('you@example.com');
-- (auth.uid() is null in the SQL editor, so the protect trigger lets this through.)
-- ------------------------------------------------------------------------------------------------


-- ============================================================================
-- ===== supabase/029_country_phone_memberid.sql =====
-- ============================================================================
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


-- ============================================================================
-- ===== supabase/030_admin_edit_country_id.sql =====
-- ============================================================================
-- 030_admin_edit_country_id.sql — let admins/founders edit a member's country + member_id.
-- Run after 029. Idempotent; safe to re-run.
--
-- 029 locked country/dial_code/member_id for everyone. Owner wants admins + founders to be able to
-- change an intern's country and their ZDR member ID (and their own country). Interns still can't
-- change their own country/ID (only their phone). Admins/founders never get a member ID themselves.

-- (1) Column protection: keep interns locked, but DROP the blanket member_id lock so admins/founders
--     can edit it. (Interns are still blocked via the non-admin branch, which reverts country/dial_code/
--     member_id. Non-founder admins still can't touch another admin/founder's protected columns.)
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
    -- non-admin (intern): locked. phone stays editable; country/dial_code/member_id do NOT.
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
  -- (no blanket member_id lock anymore — admins/founders may re-issue an intern's ID)
  return new;
end; $$;

-- (2) Extend admin_update_profile so admins/founders can also set country / dial_code / member_id.
--     New params default NULL = "leave unchanged" (keeps any old 4-arg callers safe). Empty string clears.
drop function if exists public.admin_update_profile(uuid, text, text, text);
create or replace function public.admin_update_profile(
  target uuid, p_display_name text, p_full_name text, p_gender text,
  p_country text default null, p_dial_code text default null, p_member_id text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;   -- is_admin() = admin or founder
  update public.profiles set
    display_name = coalesce(nullif(btrim(p_display_name), ''), display_name),
    full_name    = nullif(btrim(coalesce(p_full_name, '')), ''),
    gender       = case when p_gender in ('male', 'female') then p_gender else gender end,
    country      = case when p_country   is null then country   else nullif(upper(btrim(p_country)), '') end,
    dial_code    = case when p_dial_code is null then dial_code else nullif(btrim(p_dial_code), '')       end,
    member_id    = case when p_member_id is null then member_id else nullif(btrim(p_member_id), '')       end
  where id = target;
  perform public.log_admin_action('update_profile', target, 'edited name/gender/country/id');
end $$;
grant execute on function public.admin_update_profile(uuid, text, text, text, text, text, text) to authenticated;


-- ============================================================================
-- ===== supabase/031_replies_reactions.sql =====
-- ============================================================================
-- 031_replies_reactions.sql — message replies + emoji reactions for group chat AND DMs.
-- Run after 030. Idempotent. (Announcements stay reactions-only via their own table — untouched.)

-- ============ GROUP CHAT ============
alter table public.messages add column if not exists reply_to bigint references public.messages(id) on delete set null;

create table if not exists public.message_reactions (
  id         bigint generated always as identity primary key,
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id    uuid   not null references public.profiles(id) on delete cascade,
  emoji      text   not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create index if not exists message_reactions_msg on public.message_reactions (message_id);
alter table public.message_reactions replica identity full; -- DELETE events carry the row (live removal)
alter table public.message_reactions enable row level security;

drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions
  for select to authenticated using (true);
drop policy if exists message_reactions_insert on public.message_reactions;
create policy message_reactions_insert on public.message_reactions
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists message_reactions_delete on public.message_reactions;
create policy message_reactions_delete on public.message_reactions
  for delete to authenticated using (user_id = auth.uid());

-- ============ DIRECT MESSAGES ============
alter table public.dm_messages add column if not exists reply_to bigint references public.dm_messages(id) on delete set null;

create table if not exists public.dm_reactions (
  id            bigint generated always as identity primary key,
  dm_message_id bigint not null references public.dm_messages(id) on delete cascade,
  user_id       uuid   not null references public.profiles(id) on delete cascade,
  emoji         text   not null,
  created_at    timestamptz not null default now(),
  unique (dm_message_id, user_id, emoji)
);
create index if not exists dm_reactions_msg on public.dm_reactions (dm_message_id);
alter table public.dm_reactions replica identity full;
alter table public.dm_reactions enable row level security;

-- DM reactions are visible/insertable only by the thread's participants (student + admins).
drop policy if exists dm_reactions_select on public.dm_reactions;
create policy dm_reactions_select on public.dm_reactions
  for select to authenticated using (
    exists (select 1 from public.dm_messages dm
            where dm.id = dm_message_id and (dm.student_id = auth.uid() or public.is_admin()))
  );
drop policy if exists dm_reactions_insert on public.dm_reactions;
create policy dm_reactions_insert on public.dm_reactions
  for insert to authenticated with check (
    user_id = auth.uid() and exists (
      select 1 from public.dm_messages dm
      where dm.id = dm_message_id and (dm.student_id = auth.uid() or public.is_admin()))
  );
drop policy if exists dm_reactions_delete on public.dm_reactions;
create policy dm_reactions_delete on public.dm_reactions
  for delete to authenticated using (user_id = auth.uid());

-- ============ REALTIME ============
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dm_reactions') then
    alter publication supabase_realtime add table public.dm_reactions;
  end if;
end $$;


-- ============================================================================
-- ===== supabase/032_reply_notifications.sql =====
-- ============================================================================
-- 032_reply_notifications.sql — notify a message's author when someone replies to it.
-- Run after 031. Idempotent.
--
-- Reuses the mentions inbox (the 🔔 bell): a reply to your message drops a row into `mentions`
-- so you get the badge + beep + jump. A `kind` column distinguishes '@mention' from 'reply'.
alter table public.mentions add column if not exists kind text not null default 'mention'; -- 'mention' | 'reply'


-- ============================================================================
-- ===== supabase/033_cohort_reset_bestintern.sql =====
-- ============================================================================
-- 033_cohort_reset_bestintern.sql — Cohort ID format, founder reset RPCs, Best Intern + certificates.
-- Run after 032. Idempotent.

-- ============ 1) NEW ID FORMAT: ZDR-<year>-Cohort1-<DEPT>-NNN ============
-- Re-defines handle_new_user (keeps all 029 fields) with the Cohort segment, and makes
-- display_name fall back to FULL NAME (then email) since display name is now optional.
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

-- ============ 2) FOUNDER: reset the ID counters (next signup = -001 everywhere) ============
create or replace function public.reset_member_id_counters()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'Only a founder can reset ID counters.'; end if;
  delete from public.member_id_seq;                     -- next insert re-creates each dept at 1
  perform public.log_admin_action('reset_id_counters', null, 'zeroed all department counters');
end; $$;
grant execute on function public.reset_member_id_counters() to authenticated;

-- ============ 3) FOUNDER: full portal reset (fresh cohort) ============
-- Keeps: Founder/Admin/Alumni accounts, the Alumni-room chat, Testimonials & Feedback (alumni-owned).
-- Wipes: all other messages, announcements, all DMs, tasks/submissions/extensions, live sessions,
--        kicked_emails, and every current (non-alumni) intern account. Zeroes the ID counters.
create or replace function public.reset_portal()
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_alumni_id int;
begin
  if not public.is_founder() then raise exception 'Only a founder can reset the portal.'; end if;
  select id into v_alumni_id from public.domains where key = 'alumni';

  -- Chat + announcements (keep the alumni room). Reactions/reports/mentions cascade.
  delete from public.messages where domain_id is distinct from v_alumni_id;
  delete from public.announcements;
  delete from public.dm_messages;

  -- Tasks + everything derived from them.
  delete from public.submissions;
  delete from public.task_extension_requests;
  delete from public.task_deadline_reminders;
  delete from public.tasks;

  -- Calendar / live sessions.
  delete from public.live_sessions;

  -- Re-registration + ID counters → clean slate.
  delete from public.kicked_emails;
  delete from public.member_id_seq;

  -- Remove current interns (non-alumni students). Alumni/Admin/Founder are preserved.
  -- Deleting auth.users cascades to profiles (and their documents/devices/etc).
  delete from auth.users where id in (
    select id from public.profiles where role = 'student' and coalesce(is_alumni, false) = false
  );

  perform public.log_admin_action('reset_portal', null, 'full portal reset (kept founder/admin/alumni + alumni chat + feedback)');
end; $$;
grant execute on function public.reset_portal() to authenticated;

-- ============ 4) BEST INTERN (max 3 per department) ============
alter table public.profiles add column if not exists is_best_intern boolean not null default false;

create or replace function public.admin_set_best_intern(target uuid, val boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_dom int; v_cnt int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;   -- admins + founders
  if val then
    select domain_id into v_dom from public.profiles where id = target;
    select count(*) into v_cnt from public.profiles
      where is_best_intern = true and domain_id is not distinct from v_dom and id <> target;
    if v_cnt >= 3 then
      raise exception 'This department already has 3 Best Interns. Unmark one first.';
    end if;
  end if;
  update public.profiles set is_best_intern = val where id = target;
  perform public.log_admin_action(case when val then 'mark_best_intern' else 'unmark_best_intern' end, target, null);
end; $$;
grant execute on function public.admin_set_best_intern(uuid, boolean) to authenticated;

-- ============ 5) CERTIFICATES (admin uploads, alumni downloads) ============
-- R2 keys stored on the profile; files live under certificates/{uid}/ (R2 route allows admin write there).
alter table public.profiles add column if not exists certificate_key text;  -- internship / best-intern certificate
alter table public.profiles add column if not exists lor_key text;          -- letter of recommendation (best interns)

create or replace function public.admin_set_certificate(target uuid, p_certificate_key text, p_lor_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.profiles set
    certificate_key = case when p_certificate_key is null then certificate_key else nullif(p_certificate_key,'') end,
    lor_key         = case when p_lor_key is null then lor_key else nullif(p_lor_key,'') end
  where id = target;
  perform public.log_admin_action('set_certificate', target, null);
end; $$;
grant execute on function public.admin_set_certificate(uuid, text, text) to authenticated;

-- Expose the badge + cert presence via the public view is NOT needed; the alumni reads their own
-- base profile row (RLS lets owners read their full row), so certificate_key/lor_key/is_best_intern
-- are available to the owner directly.


-- ============================================================================
-- ===== supabase/034_dm_seen.sql =====
-- ============================================================================
-- 034_dm_seen.sql — DM read receipts (Received/Seen) + unread counts. Run after 033. Idempotent.
--
-- seen_at = when the *recipient* first viewed the message. Recipient is defined by sender role:
--   student's message  -> recipient is the admin side (any admin viewing the thread marks it seen)
--   admin's message    -> recipient is the thread's student (that student viewing marks it seen)
-- Unread-for-me = messages addressed to me with seen_at IS NULL. "Received" = row exists; "Seen" = seen_at set.

alter table public.dm_messages add column if not exists seen_at timestamptz;
create index if not exists dm_messages_unseen on public.dm_messages (student_id, seen_at);

-- Mark the messages *I* should see (in a thread) as seen. Safe to call on open.
--   p_student_id = the thread owner (student). Caller is either that student or an admin.
create or replace function public.mark_dm_seen(p_student_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean := public.is_admin();
begin
  if v_is_admin then
    -- an admin opened the thread → student's messages are now seen
    update public.dm_messages
       set seen_at = now()
     where student_id = p_student_id and seen_at is null
       and sender_id = p_student_id;                    -- messages the student sent
  elsif auth.uid() = p_student_id then
    -- the student opened their own thread → admins' messages are now seen
    update public.dm_messages
       set seen_at = now()
     where student_id = p_student_id and seen_at is null
       and sender_id <> p_student_id;                   -- messages an admin sent
  end if;
end; $$;
grant execute on function public.mark_dm_seen(uuid) to authenticated;


-- ============================================================================
-- ===== supabase/035_reset_safety.sql =====
-- ============================================================================
-- 035_reset_safety.sql — make Testimonials survive a full reset + harden reset_portal.
-- Run after 034. Idempotent.
--
-- WHY: feedback.user_id was ON DELETE CASCADE and ANY authenticated user (not only alumni) can
-- submit feedback. reset_portal() deletes current interns, which would cascade-delete their
-- approved testimonials — contradicting "keep Testimonials & Feedback". Fix: snapshot the author's
-- name/domain onto each feedback row, switch the FK to ON DELETE SET NULL, and read the snapshot in
-- the public_testimonials view so an approved testimonial survives even after its author is deleted.

-- 1) Snapshot columns + backfill from current authors.
alter table public.feedback add column if not exists author_name   text;
alter table public.feedback add column if not exists author_domain text;

update public.feedback f
   set author_name   = p.display_name,
       author_domain = d.name
  from public.profiles p
  left join public.domains d on d.id = p.domain_id
 where p.id = f.user_id and f.author_name is null;

-- 2) Capture the author snapshot automatically on every new feedback row.
create or replace function public.feedback_snapshot_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.author_name is null then
    select p.display_name, d.name into new.author_name, new.author_domain
    from public.profiles p left join public.domains d on d.id = p.domain_id
    where p.id = new.user_id;
  end if;
  return new;
end; $$;
drop trigger if exists trg_feedback_snapshot on public.feedback;
create trigger trg_feedback_snapshot before insert on public.feedback
  for each row execute function public.feedback_snapshot_author();

-- 3) Deleting the author must KEEP the testimonial → user_id nullable + ON DELETE SET NULL.
alter table public.feedback alter column user_id drop not null;
alter table public.feedback drop constraint if exists feedback_user_id_fkey;
alter table public.feedback add constraint feedback_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

-- 4) View reads the snapshot when the author profile is gone (LEFT JOIN + coalesce).
drop view if exists public.public_testimonials cascade;
create view public.public_testimonials as
  select f.id,
         coalesce(p.display_name, f.author_name)   as display_name,
         coalesce(d.name,         f.author_domain) as domain,
         f.rating_program, f.rating_portal, f.body, f.created_at
  from public.feedback f
  left join public.profiles p on p.id = f.user_id
  left join public.domains  d on d.id = p.domain_id
  where f.status = 'approved'
  order by f.created_at desc;
grant select on public.public_testimonials to anon, authenticated;

-- 5) Harden reset_portal: ABORT if the Alumni domain is missing (otherwise the
--    "keep alumni room" filter would delete EVERY message). Otherwise unchanged.
create or replace function public.reset_portal()
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_alumni_id int;
begin
  if not public.is_founder() then raise exception 'Only a founder can reset the portal.'; end if;
  select id into v_alumni_id from public.domains where key = 'alumni';
  if v_alumni_id is null then
    raise exception 'Alumni domain not found — aborting reset to avoid deleting all messages.';
  end if;

  delete from public.messages where domain_id is distinct from v_alumni_id;  -- keep the alumni room
  delete from public.announcements;
  delete from public.dm_messages;

  delete from public.submissions;              -- submission_files cascade
  delete from public.task_extension_requests;
  delete from public.task_deadline_reminders;
  delete from public.tasks;

  delete from public.live_sessions;
  delete from public.kicked_emails;
  delete from public.member_id_seq;

  -- Remove current interns (non-alumni students). Founder/Admin/Alumni preserved. Approved
  -- testimonials survive because feedback.user_id is now ON DELETE SET NULL (steps 1–4).
  delete from auth.users where id in (
    select id from public.profiles where role = 'student' and coalesce(is_alumni, false) = false
  );

  perform public.log_admin_action('reset_portal', null, 'full portal reset (kept founder/admin/alumni + alumni chat + feedback)');
end; $$;


-- ============================================================================
-- ===== supabase/036_chat_attachments.sql =====
-- ============================================================================
-- 036_chat_attachments.sql — file attachments in group chats. Run after 035. Idempotent.
-- Adds an optional R2 file reference to a message. Content still carries the caption (or the
-- file name) so the existing 1..2000 char_length check is satisfied. Announcements are a separate
-- table/flow and are intentionally NOT touched.
alter table public.messages add column if not exists file_key  text;  -- R2 key: chat/{uid}/...
alter table public.messages add column if not exists file_name text;  -- original file name


-- ============================================================================
-- ===== supabase/037_reset_where_clause.sql =====
-- ============================================================================
-- 037_reset_where_clause.sql — make the founder reset RPCs work under pg-safeupdate.
-- Run after 036. Idempotent.
--
-- WHY: the database has the `safeupdate` (pg-safeupdate) extension active, which rejects any
-- DELETE/UPDATE that has no WHERE clause with the error: "DELETE requires a WHERE clause".
-- The guard fires even inside SECURITY DEFINER functions (it hooks the executor), so both
-- reset_member_id_counters() and reset_portal() failed on their unqualified DELETEs.
--
-- FIX: give every full-table DELETE an always-true predicate. We use `ctid is not null` (a system
-- column present on every row) rather than `where true`, because the planner const-folds `true`
-- away — which would leave the plan with no qual and STILL trip the guard. `ctid is not null`
-- survives planning and matches every row, so the semantics are identical to an unqualified DELETE.

-- ============ FOUNDER: reset the ID counters (next signup = -001 everywhere) ============
create or replace function public.reset_member_id_counters()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'Only a founder can reset ID counters.'; end if;
  delete from public.member_id_seq where ctid is not null;   -- next insert re-creates each dept at 1
  perform public.log_admin_action('reset_id_counters', null, 'zeroed all department counters');
end; $$;
grant execute on function public.reset_member_id_counters() to authenticated;

-- ============ FOUNDER: full portal reset (fresh cohort) ============
-- Keeps: Founder/Admin/Alumni accounts, the Alumni-room chat, Testimonials & Feedback.
-- Aborts if the Alumni domain is missing (else the "keep alumni room" filter would wipe all messages).
create or replace function public.reset_portal()
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_alumni_id int;
begin
  if not public.is_founder() then raise exception 'Only a founder can reset the portal.'; end if;
  select id into v_alumni_id from public.domains where key = 'alumni';
  if v_alumni_id is null then
    raise exception 'Alumni domain not found — aborting reset to avoid deleting all messages.';
  end if;

  delete from public.messages where domain_id is distinct from v_alumni_id;  -- keep the alumni room (already qualified)
  delete from public.announcements where ctid is not null;
  delete from public.dm_messages where ctid is not null;

  delete from public.submissions where ctid is not null;              -- submission_files cascade
  delete from public.task_extension_requests where ctid is not null;
  delete from public.task_deadline_reminders where ctid is not null;
  delete from public.tasks where ctid is not null;

  delete from public.live_sessions where ctid is not null;
  delete from public.kicked_emails where ctid is not null;
  delete from public.member_id_seq where ctid is not null;

  -- Remove current interns (non-alumni students). Founder/Admin/Alumni preserved. Approved
  -- testimonials survive because feedback.user_id is ON DELETE SET NULL (migration 035).
  delete from auth.users where id in (
    select id from public.profiles where role = 'student' and coalesce(is_alumni, false) = false
  );

  perform public.log_admin_action('reset_portal', null, 'full portal reset (kept founder/admin/alumni + alumni chat + feedback)');
end; $$;
grant execute on function public.reset_portal() to authenticated;


-- ============================================================================
-- ===== supabase/038_portal_issues.sql =====
-- ============================================================================
-- 038_portal_issues.sql — let any user report a portal issue; admins triage them. Run after 037. Idempotent.
--
-- A permanent "Report a Portal Issue" box lives in every user's Profile. Rows are private: a user
-- sees only their own, admins see all. Author name/email are snapshotted on insert so a report
-- survives even if the reporter's account is later deleted (same pattern as feedback in 035).

create table if not exists public.portal_issues (
  id           bigint generated always as identity primary key,
  user_id      uuid references public.profiles(id) on delete set null,
  author_name  text,
  author_email text,
  category     text not null default 'other' check (category in ('bug','ui','access','account','other')),
  body         text not null check (char_length(body) between 1 and 2000),
  status       text not null default 'open' check (status in ('open','resolved')),
  resolved_by  uuid references public.profiles(id),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists portal_issues_status_time on public.portal_issues (status, created_at desc);

alter table public.portal_issues enable row level security;

-- A user files issues under their own id.
drop policy if exists "portal_issues_insert_own" on public.portal_issues;
create policy "portal_issues_insert_own" on public.portal_issues
  for insert to authenticated with check (user_id = auth.uid());

-- Read: your own rows, or admin (all).
drop policy if exists "portal_issues_read" on public.portal_issues;
create policy "portal_issues_read" on public.portal_issues
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Snapshot the reporter's name + email on insert (kept if the account is later deleted).
create or replace function public.portal_issue_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.author_name is null or new.author_email is null then
    select display_name, email into new.author_name, new.author_email
    from public.profiles where id = new.user_id;
  end if;
  return new;
end; $$;
drop trigger if exists trg_portal_issue_snapshot on public.portal_issues;
create trigger trg_portal_issue_snapshot before insert on public.portal_issues
  for each row execute function public.portal_issue_snapshot();

-- Admin: mark an issue resolved / reopen it (audit-logged).
create or replace function public.admin_set_issue_status(p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('open','resolved') then raise exception 'bad status'; end if;
  update public.portal_issues
     set status      = p_status,
         resolved_by = case when p_status = 'resolved' then auth.uid() else null end,
         resolved_at = case when p_status = 'resolved' then now()      else null end
   where id = p_id;
  perform public.log_admin_action('set_issue_status', null, p_status);
end; $$;
grant execute on function public.admin_set_issue_status(bigint, text) to authenticated;


-- ============================================================================
-- ===== supabase/039_founder_user_records.sql =====
-- ============================================================================
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


-- ============================================================================
-- ===== supabase/040_realtime_profiles.sql =====
-- ============================================================================
-- 040_realtime_profiles.sql — broadcast profile inserts/updates over Realtime so the founder
-- "User Records" panel and the admin member lists update live as people sign up / change.
-- Run after 039. Idempotent. RLS still applies to Realtime, so a client only receives rows it
-- is allowed to SELECT (admins/founders see all; a student only sees their own).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;


-- ============================================================================
-- ===== supabase/041_chat_privacy_receipts.sql =====
-- ============================================================================
-- 041_chat_privacy_receipts.sql — WhatsApp-style chat privacy + group read receipts.
-- Run in the Supabase SQL editor after 040. Idempotent (safe to re-run).
--
-- Adds:
--   * "Delete for everyone" by the author  -> hidden from other students, STILL visible to
--     admins/founders (moderation preserved), via messages.author_deleted / dm_messages.author_deleted.
--   * "Delete for me"                       -> per-user hide rows (message_hides / dm_message_hides).
--   * "Clear chat" (group rooms only)       -> per-user watermark (room_clears).
--   * Group "message info" read receipts    -> per-user-per-room last-read watermark (room_reads),
--     one row per user per room (scales to hundreds of members).

-- 1) Author "delete for everyone" flag (distinct from admin moderation `deleted`).
alter table public.messages    add column if not exists author_deleted boolean not null default false;
alter table public.dm_messages add column if not exists author_deleted boolean not null default false;

-- 2) Per-user "delete for me" hides.
create table if not exists public.message_hides (
  user_id    uuid   not null references public.profiles(id) on delete cascade,
  message_id bigint not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
create table if not exists public.dm_message_hides (
  user_id       uuid   not null references public.profiles(id) on delete cascade,
  dm_message_id bigint not null references public.dm_messages(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, dm_message_id)
);

-- 3) Per-user "clear chat" watermark (group rooms only; Announcements are never cleared).
-- NOTE: domain_id is a plain int (NOT a FK to domains). A table with FKs to both profiles and
-- domains reads to PostgREST as a junction table, which makes the profiles->domains embed
-- ambiguous (PGRST201) and breaks the portal's profile query. domains are static, so we skip the FK.
create table if not exists public.room_clears (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  domain_id  int  not null,
  cleared_at timestamptz not null default now(),
  primary key (user_id, domain_id)
);

-- 4) Per-user per-room last-read watermark → drives "message info" seen/unseen.
create table if not exists public.room_reads (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  domain_id    int  not null,                       -- plain int, not a FK to domains (see room_clears note)
  last_read_at timestamptz not null default now(),
  primary key (user_id, domain_id)
);

-- Heal existing installs (this file's first version added the domains FKs): drop them so the
-- profiles->domains embed is unambiguous again. Idempotent.
alter table public.room_clears drop constraint if exists room_clears_domain_id_fkey;
alter table public.room_reads  drop constraint if exists room_reads_domain_id_fkey;

-- ---- RLS ----
alter table public.message_hides    enable row level security;
alter table public.dm_message_hides enable row level security;
alter table public.room_clears      enable row level security;
alter table public.room_reads       enable row level security;

drop policy if exists mh_all on public.message_hides;
create policy mh_all on public.message_hides for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists dmh_all on public.dm_message_hides;
create policy dmh_all on public.dm_message_hides for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists rc_all on public.room_clears;
create policy rc_all on public.room_clears for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- room_reads: readable by any authenticated user (needed to compute who has seen a message),
-- writable only for your own row.
drop policy if exists rr_select on public.room_reads;
create policy rr_select on public.room_reads for select to authenticated using (true);
drop policy if exists rr_write on public.room_reads;
create policy rr_write on public.room_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 5) Author-only "delete for everyone" (staff still read it; students no longer see it).
create or replace function public.message_delete_for_everyone(p_message_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.messages set author_deleted = true
   where id = p_message_id and user_id = auth.uid();
  if not found then raise exception 'not your message'; end if;
end; $$;
grant execute on function public.message_delete_for_everyone(bigint) to authenticated;

create or replace function public.dm_delete_for_everyone(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.dm_messages set author_deleted = true
   where id = p_id and sender_id = auth.uid();
  if not found then raise exception 'not your message'; end if;
end; $$;
grant execute on function public.dm_delete_for_everyone(bigint) to authenticated;

-- 6) Watermark upserts.
create or replace function public.mark_room_read(p_domain_id int)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.room_reads (user_id, domain_id, last_read_at)
  values (auth.uid(), p_domain_id, now())
  on conflict (user_id, domain_id) do update set last_read_at = now();
end; $$;
grant execute on function public.mark_room_read(int) to authenticated;

create or replace function public.clear_room(p_domain_id int)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.room_clears (user_id, domain_id, cleared_at)
  values (auth.uid(), p_domain_id, now())
  on conflict (user_id, domain_id) do update set cleared_at = now();
end; $$;
grant execute on function public.clear_room(int) to authenticated;

-- 6b) Let an intern mark that they've joined their Google Classroom from their profile.
--     classroom_confirmed is otherwise locked for interns by protect_profile_columns, so a
--     direct update would be reverted — this security-definer RPC updates only the caller's row.
create or replace function public.set_classroom_confirmed(p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set classroom_confirmed = p_value where id = auth.uid();
end; $$;
grant execute on function public.set_classroom_confirmed(boolean) to authenticated;

-- 7) Realtime so hides / receipts sync live across a user's own tabs and devices.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='message_hides') then
    alter publication supabase_realtime add table public.message_hides;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dm_message_hides') then
    alter publication supabase_realtime add table public.dm_message_hides;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='room_clears') then
    alter publication supabase_realtime add table public.room_clears;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='room_reads') then
    alter publication supabase_realtime add table public.room_reads;
  end if;
end $$;


-- ============================================================================
-- ===== supabase/042_flag_incomplete_signup.sql =====
-- ============================================================================
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


-- ============================================================================
-- ===== supabase/043_late_comer_ack.sql =====
-- ============================================================================
-- 043_late_comer_ack.sql — one-time "you joined late" popup acknowledgement.
-- Run in the Supabase SQL editor after 042. Idempotent (safe to re-run).
--
-- "Late comer" STATUS is computed live (a student's signup time vs their department's Week-1 task
-- upload time), so no stored status column is needed and existing users are covered automatically.
-- This only records that the one-time popup has been dismissed, so it never shows again.
--
-- Note: late_comer_ack is intentionally NOT added to protect_profile_columns' locked list, so a
-- student can set their own flag directly (profiles_update_own RLS already scopes it to their row).
alter table public.profiles add column if not exists late_comer_ack boolean not null default false;


-- ============================================================================
-- ===== supabase/044_linkedin_url.sql =====
-- ============================================================================
-- 044_linkedin_url.sql — let users link their LinkedIn (profile or company page) to their account.
-- Run in the Supabase SQL editor after 043. Idempotent (safe to re-run).
--
-- linkedin_url is intentionally NOT in protect_profile_columns' locked list, so a user can set
-- their own directly (profiles_update_own RLS scopes it to their row). Exposed via public_profiles
-- so a clickable icon can show in the chat members sidebar for networking.
alter table public.profiles add column if not exists linkedin_url text;

-- Recreate the safe view with the same columns as 029 + linkedin_url.
drop view if exists public.public_profiles cascade;
create view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, is_alumni, ram, country, member_id, linkedin_url
  from public.profiles;
grant select on public.public_profiles to authenticated;


-- ============================================================================
-- ===== supabase/045_github_url.sql =====
-- ============================================================================
-- 045_github_url.sql — let users link their GitHub to their account (mirrors 044 / LinkedIn).
-- Run in the Supabase SQL editor after 044. Idempotent (safe to re-run).
--
-- github_url is NOT in protect_profile_columns' locked list, so a user can set their own directly.
-- Exposed via public_profiles for the clickable icon in the chat members sidebar.
alter table public.profiles add column if not exists github_url text;

-- Recreate the safe view with 044's columns + github_url.
drop view if exists public.public_profiles cascade;
create view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, is_alumni, ram, country, member_id, linkedin_url, github_url
  from public.profiles;
grant select on public.public_profiles to authenticated;


-- ============================================================================
-- ===== supabase/046_read_receipts_fix.sql =====
-- ============================================================================
-- 046_read_receipts_fix.sql — guarantee group "seen" read-receipts work on the live DB.
-- Symptom this fixes: "Message info" always shows "Seen by 0", because the room_reads watermark
-- table / mark_room_read RPC / grants weren't fully in place (or writes were silently failing).
-- Re-runnable and idempotent — safe to run on production even if 041 already applied.

-- Per-user per-room last-read watermark → drives "message info" seen/unseen.
-- domain_id is a plain int (NOT a FK to domains) on purpose — a FK here makes the
-- profiles->domains embed ambiguous to PostgREST and breaks other portal queries.
create table if not exists public.room_reads (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  domain_id    int  not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, domain_id)
);
alter table public.room_reads drop constraint if exists room_reads_domain_id_fkey;

-- RLS: any authenticated user may READ all watermarks (needed to compute who has seen a message);
-- each user may WRITE only their own row.
alter table public.room_reads enable row level security;
drop policy if exists rr_select on public.room_reads;
create policy rr_select on public.room_reads for select to authenticated using (true);
drop policy if exists rr_write on public.room_reads;
create policy rr_write on public.room_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Watermark upsert. security definer so it runs regardless of the caller's RLS, writing only their row.
create or replace function public.mark_room_read(p_domain_id int)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.room_reads (user_id, domain_id, last_read_at)
  values (auth.uid(), p_domain_id, now())
  on conflict (user_id, domain_id) do update set last_read_at = now();
end; $$;
grant execute on function public.mark_room_read(int) to authenticated;

-- Realtime so receipts sync live across a user's own tabs/devices.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='room_reads') then
    alter publication supabase_realtime add table public.room_reads;
  end if;
end $$;


-- ============================================================================
-- ===== supabase/047_submission_rubric.sql =====
-- ============================================================================
-- 047_submission_rubric.sql — per-rubric marks on accepted submissions. Run after 046. Idempotent.
-- Admin grades an approved submission on 4 axes (each /10); overall (/40) is the auto-summed total,
-- and the UI derives a percentage from it. Students can VIEW their marks but never set them.

alter table public.submissions add column if not exists score_completeness int;
alter table public.submissions add column if not exists score_accuracy     int;
alter table public.submissions add column if not exists score_evidence      int;
alter table public.submissions add column if not exists score_report        int;

alter table public.submissions drop constraint if exists submissions_scores_chk;
alter table public.submissions add constraint submissions_scores_chk check (
  (score_completeness is null or score_completeness between 0 and 10) and
  (score_accuracy     is null or score_accuracy     between 0 and 10) and
  (score_evidence     is null or score_evidence     between 0 and 10) and
  (score_report       is null or score_report       between 0 and 10)
);

-- Overall (/40) = sum of the four axes; NULL until at least one axis is scored.
-- Stored generated column keeps it always consistent with the parts (can't be set directly).
alter table public.submissions drop column if exists score_overall;
alter table public.submissions add column score_overall int
  generated always as (
    case
      when score_completeness is null and score_accuracy is null
       and score_evidence is null and score_report is null then null
      else coalesce(score_completeness, 0) + coalesce(score_accuracy, 0)
         + coalesce(score_evidence, 0) + coalesce(score_report, 0)
    end
  ) stored;

-- Students can't self-grade: any non-admin write re-queues the submission AND wipes the grade fields,
-- now including the rubric scores. (Extends the original protect_submission from migration 002.)
create or replace function public.protect_submission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.status             := 'submitted';
    new.feedback           := null;
    new.graded_by          := null;
    new.graded_at          := null;
    new.score_completeness := null;
    new.score_accuracy     := null;
    new.score_evidence     := null;
    new.score_report       := null;
  end if;
  return new;
end; $$;


-- ============================================================================
-- ===== supabase/048_announcement_attachments.sql =====
-- ============================================================================
-- 048_announcement_attachments.sql — optional file + link on announcements. Run after 047. Idempotent.
-- attachment_key is an R2 object key under announcements/… (world-readable to authed users; see lib/r2.js).
alter table public.announcements add column if not exists link_url        text;
alter table public.announcements add column if not exists attachment_key  text;
alter table public.announcements add column if not exists attachment_name text;
-- RLS unchanged: ann_read (any authenticated user) + ann_admin_write (admins only) already cover
-- these columns, and announcements is already in the realtime publication.


-- ============================================================================
-- ===== supabase/049_announcement_seen.sql =====
-- ============================================================================
-- 049_announcement_seen.sql — one-time "new announcement" login popup, tracked per ACCOUNT. After 048.
-- A pointer to the highest announcement id the user has already been shown. Existing rows default to 0,
-- so everyone gets the current newest announcement's popup once on their next login.
alter table public.profiles add column if not exists last_seen_announcement_id bigint not null default 0;

-- Advance the caller's pointer. security definer so protect_profile_columns can't revert it; only ever
-- moves forward (greatest), and only touches the caller's own row.
create or replace function public.mark_announcements_seen(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set last_seen_announcement_id = greatest(coalesce(last_seen_announcement_id, 0), p_id)
   where id = auth.uid();
end; $$;
grant execute on function public.mark_announcements_seen(bigint) to authenticated;


-- ============================================================================
-- ===== supabase/050_dm_attachments.sql =====
-- ============================================================================
-- 050_dm_attachments.sql — file attachments in DMs (student ↔ admin). Run after 049. Idempotent.
-- Files live in R2 under dm/{student_id}/… so ownsKey() limits download to that student + admins
-- (NOT the world-readable chat/ prefix — DMs are private).
alter table public.dm_messages add column if not exists file_key  text;
alter table public.dm_messages add column if not exists file_name text;
-- RLS unchanged: the existing dm_messages insert/select policies already gate by student_id / sender,
-- and content stays non-empty (the client stores the caption or the file name as the message text).


-- ============================================================================
-- ===== supabase/051_submission_rubric_decimals.sql =====
-- ============================================================================
-- 051_submission_rubric_decimals.sql — allow fractional rubric marks (e.g. 9.5/10). After 050. Idempotent.
-- Retypes the four rubric axes from int → numeric(4,2); overall (/40) stays the auto-summed total.

-- The generated overall depends on the four axes, so it must be dropped before retyping them.
alter table public.submissions drop column if exists score_overall;

alter table public.submissions alter column score_completeness type numeric(4,2);
alter table public.submissions alter column score_accuracy     type numeric(4,2);
alter table public.submissions alter column score_evidence      type numeric(4,2);
alter table public.submissions alter column score_report        type numeric(4,2);

-- Re-add overall (/40) as the numeric sum; NULL until at least one axis is scored.
alter table public.submissions add column score_overall numeric(5,2)
  generated always as (
    case
      when score_completeness is null and score_accuracy is null
       and score_evidence is null and score_report is null then null
      else coalesce(score_completeness, 0) + coalesce(score_accuracy, 0)
         + coalesce(score_evidence, 0) + coalesce(score_report, 0)
    end
  ) stored;

-- The 0..10 range check from 047 still holds for numeric values (9.5 is between 0 and 10).


-- ============================================================================
-- ===== supabase/052_founder_reset_password.sql =====
-- ============================================================================
-- 052_founder_reset_password.sql — let a FOUNDER set a new password for an intern/admin without
-- knowing the current one. Run after 051. Idempotent. Mirrors admin_delete_user's auth.users access.
--
-- Uses bcrypt via pgcrypto (the same scheme Supabase Auth/GoTrue uses), so the user can sign in with
-- the new password immediately. Guards: caller must be a founder; target must exist, must NOT be a
-- founder, and must not be the caller themselves.

create extension if not exists pgcrypto;

create or replace function public.founder_reset_password(target uuid, new_password text)
returns void language plpgsql security definer set search_path = public, auth, extensions as $$
declare tgt_is_founder boolean;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and coalesce(is_founder, false) = true) then
    raise exception 'founder only';
  end if;
  if new_password is null or length(new_password) < 8 then
    raise exception 'Password must be at least 8 characters.';
  end if;
  if target = auth.uid() then
    raise exception 'Use your own password change for your account.';
  end if;

  select coalesce(is_founder, false) into tgt_is_founder from public.profiles where id = target;
  if not found then raise exception 'User not found.'; end if;
  if tgt_is_founder then raise exception 'Cannot reset another founder''s password.'; end if;

  update auth.users
     set encrypted_password = crypt(new_password, gen_salt('bf')),
         updated_at = now()
   where id = target;

  perform public.log_admin_action('reset_password', target, 'founder reset password');
end; $$;

grant execute on function public.founder_reset_password(uuid, text) to authenticated;


-- ============================================================================
-- ===== supabase/053_milestones.sql =====
-- ============================================================================
-- 053_milestones.sql — a separate READ-ONLY feed for auto-posted achievements (First Blood + future
-- badges), kept out of Announcements so that channel stays for important manual posts. After 052. Idempotent.

create table if not exists public.milestones (
  id         bigint generated always as identity primary key,
  title      text not null,
  body       text not null,
  created_at timestamptz not null default now()
);

alter table public.milestones enable row level security;
-- Everyone reads; NOBODY writes from the client (no insert/update/delete policy at all). Only the
-- security-definer trigger below (which bypasses RLS) posts here — so it is display-only for everyone,
-- including admins and founders.
drop policy if exists milestones_read on public.milestones;
create policy milestones_read on public.milestones for select to authenticated using (true);

-- First Blood: when a submission first becomes 'approved' for its task, post a milestone. Moved
-- server-side from the client so it can't be raced/missed and can write to the locked table.
create or replace function public.emit_first_blood()
returns trigger language plpgsql security definer set search_path = public as $$
declare wk int; ttl text; sname text;
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if not exists (
      select 1 from public.submissions s
       where s.task_id = new.task_id and s.status = 'approved' and s.id <> new.id
    ) then
      select week, title into wk, ttl from public.tasks where id = new.task_id;
      select display_name into sname from public.profiles where id = new.user_id;
      insert into public.milestones (title, body)
      values (
        '🩸 First Blood',
        coalesce(sname, 'A reaper') || ' is first to clear Week ' || coalesce(wk::text, '?')
          || ' · ' || coalesce(ttl, 'a task') || '. Respect. Who''s next?'
      );
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists first_blood_trg on public.submissions;
create trigger first_blood_trg after insert or update on public.submissions
  for each row execute function public.emit_first_blood();

-- Realtime so new milestones appear live in the feed.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='milestones') then
    alter publication supabase_realtime add table public.milestones;
  end if;
end $$;


-- ============================================================================
-- ===== supabase/054_move_first_blood_to_milestones.sql =====
-- ============================================================================
-- 054_move_first_blood_to_milestones.sql — one-time: move existing "First Blood" posts out of
-- Announcements into the Milestones feed (they predate migration 053). Run AFTER 053.
-- Idempotent: once moved, the source rows are gone, so re-running matches nothing and is a no-op.

insert into public.milestones (title, body, created_at)
  select title, body, created_at
    from public.announcements
   where title ilike '%first blood%';

delete from public.announcements
 where title ilike '%first blood%';


-- ============================================================================
-- ===== supabase/055_signup_approval_mode.sql =====
-- ============================================================================
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


-- ============================================================================
-- ===== supabase/056_submission_change_requests.sql =====
-- ============================================================================
-- 056_submission_change_requests.sql — a student must get a FOUNDER-approved change request before
-- replacing an existing submission (whether it is still pending review or was rejected). The very
-- first upload for a task is free; every later replacement consumes one approved request. Enforced
-- server-side in protect_submission() so it can't be bypassed by hitting the API directly.
-- Run after 055. Idempotent.

create table if not exists public.submission_change_requests (
  id          bigint generated always as identity primary key,
  task_id     bigint not null references public.tasks(id) on delete cascade,
  user_id     uuid   not null references public.profiles(id) on delete cascade,
  reason      text,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by  uuid references public.profiles(id),
  decided_at  timestamptz,
  consumed_at timestamptz,                 -- set when the approved request is spent on a re-upload
  created_at  timestamptz not null default now()
);

create index if not exists scr_lookup  on public.submission_change_requests (user_id, task_id, created_at desc);
create index if not exists scr_pending  on public.submission_change_requests (status, created_at desc);
-- Only one open (pending) request per task per student — stops request spam.
create unique index if not exists scr_one_pending
  on public.submission_change_requests (task_id, user_id) where status = 'pending';

alter table public.submission_change_requests enable row level security;

-- Student reads own requests; admins/founders read all (needed for the review queue).
drop policy if exists scr_select on public.submission_change_requests;
create policy scr_select on public.submission_change_requests
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Student creates their OWN request only, and only in the 'pending' state. Decisions go through the
-- founder RPC below (SECURITY DEFINER), so there is intentionally no client UPDATE policy —
-- a student can neither approve their own request nor mark it consumed.
drop policy if exists scr_insert on public.submission_change_requests;
create policy scr_insert on public.submission_change_requests
  for insert to authenticated with check (user_id = auth.uid() and status = 'pending');

-- Founder-only: approve or deny a change request (logged to the audit trail).
create or replace function public.founder_decide_change_request(p_request_id bigint, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r_user uuid; r_task bigint; r_status text;
begin
  if not public.is_founder() then raise exception 'founder only'; end if;
  select user_id, task_id, status into r_user, r_task, r_status
    from public.submission_change_requests where id = p_request_id;
  if r_user is null then raise exception 'request not found'; end if;
  if r_status <> 'pending' then raise exception 'request already decided'; end if;

  update public.submission_change_requests
     set status     = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_request_id;

  perform public.log_admin_action(
    case when p_approve then 'approve_change_request' else 'deny_change_request' end,
    r_user,
    'task_id=' || r_task);
end $$;

grant execute on function public.founder_decide_change_request(bigint, boolean) to authenticated;

-- Extend protect_submission (last set in 047): keep the "students can't self-grade" wipes, and add
-- the change-request gate. A non-admin UPDATE (i.e. replacing an existing row — the upsert in
-- TasksScreen fires this) is allowed ONLY when a founder-approved, unused request exists; that
-- request is then consumed so the next replacement needs a fresh approval. Plain INSERTs (the first
-- submission for a task) are untouched. Admins/founders bypass the whole block.
create or replace function public.protect_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_req_id bigint;
begin
  if not public.is_admin() then
    new.status             := 'submitted';
    new.feedback           := null;
    new.graded_by          := null;
    new.graded_at          := null;
    new.score_completeness := null;
    new.score_accuracy     := null;
    new.score_evidence     := null;
    new.score_report       := null;

    if tg_op = 'UPDATE' then
      select r.id into v_req_id
        from public.submission_change_requests r
       where r.task_id = new.task_id
         and r.user_id = new.user_id
         and r.status  = 'approved'
         and r.consumed_at is null
       order by r.decided_at asc nulls last, r.id asc
       limit 1;

      if v_req_id is null then
        raise exception 'CHANGE_REQUEST_REQUIRED: A founder-approved change request is required before you can replace this submission.'
          using errcode = 'check_violation';
      end if;

      update public.submission_change_requests
         set consumed_at = now()
       where id = v_req_id;
    end if;
  end if;
  return new;
end; $$;

-- Trigger already exists from 002 (before insert or update); recreate defensively in case this
-- migration is applied to a database where it was dropped.
drop trigger if exists protect_submission_trg on public.submissions;
create trigger protect_submission_trg before insert or update on public.submissions
  for each row execute function public.protect_submission();

-- Realtime so the founder's change-request queue updates live (optional; harmless if already added).
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='submission_change_requests') then
    alter publication supabase_realtime add table public.submission_change_requests;
  end if;
end $$;


-- ============================================================================
-- ===== supabase/057_founder_grant_extension.sql =====
-- ============================================================================
-- 057_founder_grant_extension.sql — founder-initiated task extensions. Run after 056. Idempotent.
--
-- Until now, an extension only existed as a reaction to a student's request (admin_decide_extension
-- operates on an existing row, and the ter_insert RLS policy only lets a user create their OWN
-- request). This adds a founder-only RPC that PROACTIVELY grants a specific intern extra time on a
-- specific task — no prior request needed. If the intern already has a pending request for that
-- task, it approves that row instead of creating a duplicate, so the pending queue stays clean.

create or replace function public.admin_grant_extension(p_task_id bigint, p_user_id uuid, p_extra_days int default 7)
returns void language plpgsql security definer set search_path = public as $$
declare r_due timestamptz; v_days int; v_new_due timestamptz; v_existing bigint;
begin
  if not public.is_founder() then raise exception 'founder only'; end if;

  v_days := greatest(1, coalesce(p_extra_days, 7));
  select due_at into r_due from public.tasks where id = p_task_id;
  if not found then raise exception 'task not found'; end if;
  -- Extension deadline is measured from the task's original due date (or now if it had none),
  -- matching admin_decide_extension so both paths compute extended_until identically.
  v_new_due := coalesce(r_due, now()) + make_interval(days => v_days);

  -- Reuse the intern's latest still-pending request for this task if one exists; otherwise mint an
  -- already-approved row. Either way the newest row for (task,user) ends up approved with the new due.
  select id into v_existing from public.task_extension_requests
    where task_id = p_task_id and user_id = p_user_id and status = 'pending'
    order by created_at desc limit 1;

  if v_existing is not null then
    update public.task_extension_requests
       set status = 'approved', extended_until = v_new_due, decided_by = auth.uid(), decided_at = now()
     where id = v_existing;
  else
    insert into public.task_extension_requests
      (task_id, user_id, reason, status, extended_until, decided_by, decided_at)
    values
      (p_task_id, p_user_id, 'Granted by founder', 'approved', v_new_due, auth.uid(), now());
  end if;

  perform public.log_admin_action(
    'grant_extension', p_user_id,
    'task_id=' || p_task_id || ' +' || v_days || 'd (founder-initiated)');
end $$;

grant execute on function public.admin_grant_extension(bigint, uuid, int) to authenticated;


-- ============================================================================
-- ===== supabase/058_extension_until_datetime.sql =====
-- ============================================================================
-- 058_extension_until_datetime.sql — grant a task extension by an explicit deadline (date + time)
-- instead of a number of days. Run after 057. Idempotent.
--
-- Replaces admin_grant_extension(bigint, uuid, int) with admin_grant_extension(bigint, uuid,
-- timestamptz): the founder now sets the exact moment the extension runs until, and that value is
-- stored verbatim in extended_until (no more "original due + N days" math). The old int overload is
-- dropped so there's a single, unambiguous signature.

drop function if exists public.admin_grant_extension(bigint, uuid, int);

create or replace function public.admin_grant_extension(p_task_id bigint, p_user_id uuid, p_until timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare v_existing bigint;
begin
  if not public.is_founder() then raise exception 'founder only'; end if;
  if p_until is null then raise exception 'an extension date is required'; end if;
  if not exists (select 1 from public.tasks where id = p_task_id) then raise exception 'task not found'; end if;

  -- Reuse the intern's latest still-pending request for this task if one exists; otherwise mint an
  -- already-approved row. Either way the newest row for (task,user) ends up approved with p_until.
  select id into v_existing from public.task_extension_requests
    where task_id = p_task_id and user_id = p_user_id and status = 'pending'
    order by created_at desc limit 1;

  if v_existing is not null then
    update public.task_extension_requests
       set status = 'approved', extended_until = p_until, decided_by = auth.uid(), decided_at = now()
     where id = v_existing;
  else
    insert into public.task_extension_requests
      (task_id, user_id, reason, status, extended_until, decided_by, decided_at)
    values
      (p_task_id, p_user_id, 'Granted by founder', 'approved', p_until, auth.uid(), now());
  end if;

  perform public.log_admin_action(
    'grant_extension', p_user_id,
    'task_id=' || p_task_id || ' until '
      || to_char(p_until at time zone 'Asia/Karachi', 'YYYY-MM-DD HH24:MI') || ' PKT (founder-initiated)');
end $$;

grant execute on function public.admin_grant_extension(bigint, uuid, timestamptz) to authenticated;


-- ============================================================================
-- ===== supabase/059_secure_founder_user_records.sql =====
-- ============================================================================
-- 059_secure_founder_user_records.sql
-- Replace the public auth.users-backed founder_user_records view with a founder-only RPC.
--
-- Why: Supabase Security Advisor flags public-schema views that read auth.users
-- (auth_users_exposed), even when the view filters to founders. Keep auth.users
-- access behind an explicit SECURITY DEFINER function that rejects non-founders.

drop view if exists public.founder_user_records cascade;

create or replace function public.get_founder_user_records()
returns table (
  id uuid,
  email text,
  display_name text,
  full_name text,
  gender text,
  domain_id int,
  role text,
  status text,
  is_alumni boolean,
  is_founder boolean,
  country text,
  dial_code text,
  phone text,
  member_id text,
  ram text,
  discord_username text,
  has_password boolean,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  auth_created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_founder() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.email,
    p.display_name,
    p.full_name,
    p.gender,
    p.domain_id,
    p.role,
    p.status,
    p.is_alumni,
    p.is_founder,
    p.country,
    p.dial_code,
    p.phone,
    p.member_id,
    p.ram,
    p.discord_username,
    (u.encrypted_password is not null) as has_password,
    u.last_sign_in_at,
    u.email_confirmed_at,
    u.created_at as auth_created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  order by u.created_at desc;
end;
$$;

revoke all on function public.get_founder_user_records() from public;
grant execute on function public.get_founder_user_records() to authenticated;


-- ============================================================================
-- ===== supabase/060_group_read_receipts_rpc.sql =====
-- ============================================================================
-- 060_group_read_receipts_rpc.sql
-- Harden and fix group "message info" read receipts.
--
-- The client used to query room_reads directly. If table grants/RLS drifted on
-- production, that read failed silently and Message Info showed "Seen by 0".
-- Keep writes via mark_room_read(), but calculate seen/unseen through an RPC.

create table if not exists public.room_reads (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  domain_id    int  not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, domain_id)
);

alter table public.room_reads drop constraint if exists room_reads_domain_id_fkey;
alter table public.room_reads enable row level security;

drop policy if exists rr_select on public.room_reads;
create policy rr_select on public.room_reads for select to authenticated using (true);

drop policy if exists rr_write on public.room_reads;
create policy rr_write on public.room_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.room_reads from anon;
grant select, insert, update on public.room_reads to authenticated;

create or replace function public.mark_room_read(p_domain_id int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  insert into public.room_reads (user_id, domain_id, last_read_at)
  values (auth.uid(), p_domain_id, now())
  on conflict (user_id, domain_id) do update set last_read_at = now();
end;
$$;

revoke execute on function public.mark_room_read(int) from anon;
revoke execute on function public.mark_room_read(int) from public;
grant execute on function public.mark_room_read(int) to authenticated;

create or replace function public.get_message_read_receipts(p_message_id bigint)
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  role text,
  is_alumni boolean,
  domain_id int,
  country text,
  seen boolean,
  last_read_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.messages%rowtype;
  v_room_key text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_message
  from public.messages
  where id = p_message_id;

  if not found then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  if v_message.user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select key into v_room_key
  from public.domains
  where id = v_message.domain_id;

  return query
  select
    p.id,
    p.display_name,
    p.avatar_url,
    p.role,
    p.is_alumni,
    p.domain_id,
    p.country,
    coalesce(rr.last_read_at >= v_message.created_at, false) as seen,
    rr.last_read_at
  from public.profiles p
  left join public.room_reads rr
    on rr.user_id = p.id
   and rr.domain_id = v_message.domain_id
  where p.id <> auth.uid()
    and (
      p.role = 'admin'
      or (v_room_key = 'alumni' and p.is_alumni = true)
      or (v_room_key = 'lobby' and p.role <> 'admin' and p.is_alumni = false)
      or (v_room_key not in ('lobby', 'alumni') and p.domain_id = v_message.domain_id and p.is_alumni = false)
    )
  order by seen desc, p.display_name asc nulls last;
end;
$$;

revoke execute on function public.get_message_read_receipts(bigint) from anon;
revoke execute on function public.get_message_read_receipts(bigint) from public;
grant execute on function public.get_message_read_receipts(bigint) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_reads'
  ) then
    alter publication supabase_realtime add table public.room_reads;
  end if;
end $$;


-- ============================================================================
-- ===== supabase/061_fix_message_read_receipts_ambiguity.sql =====
-- ============================================================================
-- 061_fix_message_read_receipts_ambiguity.sql
-- Fix Postgres ambiguity in get_message_read_receipts().
--
-- In RETURNS TABLE functions, output column names such as id/domain_id/seen are
-- visible as PL/pgSQL variables. Qualify table columns and avoid ORDER BY output
-- names so Message Info does not fail with "column reference id is ambiguous".

create or replace function public.get_message_read_receipts(p_message_id bigint)
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  role text,
  is_alumni boolean,
  domain_id int,
  country text,
  seen boolean,
  last_read_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.messages%rowtype;
  v_room_key text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select msg.* into v_message
  from public.messages as msg
  where msg.id = p_message_id;

  if not found then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  if v_message.user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select d.key into v_room_key
  from public.domains as d
  where d.id = v_message.domain_id;

  return query
  select
    p.id,
    p.display_name,
    p.avatar_url,
    p.role,
    p.is_alumni,
    p.domain_id,
    p.country,
    coalesce(rr.last_read_at >= v_message.created_at, false) as seen,
    rr.last_read_at
  from public.profiles as p
  left join public.room_reads as rr
    on rr.user_id = p.id
   and rr.domain_id = v_message.domain_id
  where p.id <> auth.uid()
    and (
      p.role = 'admin'
      or (v_room_key = 'alumni' and p.is_alumni = true)
      or (v_room_key = 'lobby' and p.role <> 'admin' and p.is_alumni = false)
      or (v_room_key not in ('lobby', 'alumni') and p.domain_id = v_message.domain_id and p.is_alumni = false)
    )
  order by coalesce(rr.last_read_at >= v_message.created_at, false) desc, p.display_name asc nulls last;
end;
$$;

revoke execute on function public.get_message_read_receipts(bigint) from anon;
revoke execute on function public.get_message_read_receipts(bigint) from public;
grant execute on function public.get_message_read_receipts(bigint) to authenticated;


-- ============================================================================
-- ===== supabase/062_session_attendance.sql =====
-- ============================================================================
-- 062_session_attendance.sql - RSVP and check-in tracking for live sessions.
-- Run after 061. Idempotent.

create table if not exists public.live_session_attendance (
  id          bigint generated always as identity primary key,
  session_id  bigint not null references public.live_sessions(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'going' check (status in ('going','interested','not_going','attended')),
  checked_in_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (session_id, user_id)
);

create index if not exists lsa_session on public.live_session_attendance (session_id, status);
create index if not exists lsa_user on public.live_session_attendance (user_id, created_at desc);

alter table public.live_session_attendance enable row level security;

drop policy if exists lsa_select on public.live_session_attendance;
create policy lsa_select on public.live_session_attendance
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists lsa_insert_own on public.live_session_attendance;
create policy lsa_insert_own on public.live_session_attendance
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists lsa_update_own on public.live_session_attendance;
create policy lsa_update_own on public.live_session_attendance
  for update to authenticated using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create or replace function public.touch_live_session_attendance()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'attended' and new.checked_in_at is null then
    new.checked_in_at := now();
  end if;
  return new;
end $$;

drop trigger if exists touch_live_session_attendance_trg on public.live_session_attendance;
create trigger touch_live_session_attendance_trg
  before update on public.live_session_attendance
  for each row execute function public.touch_live_session_attendance();

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='live_session_attendance') then
    alter publication supabase_realtime add table public.live_session_attendance;
  end if;
end $$;


-- ============================================================================
-- ===== supabase/063_device_geo.sql =====
-- ============================================================================
-- 063_device_geo.sql - approximate city/country per known device + geo-aware register_device.
-- Run after 062. Idempotent. Location is best-effort (resolved client-side from the user's IP at login)
-- and only ever coarse city/country - no precise coordinates, no raw IP is stored.

alter table public.user_devices add column if not exists city    text;
alter table public.user_devices add column if not exists country text;

-- Replace register_device with a geo-aware version. Drop the old 2-arg form first so the new
-- defaulted 4-arg form isn't ambiguous with it; old 2-arg call sites still work via the defaults.
-- Still returns TRUE only when the device row is newly inserted (drives the new-device alert).
drop function if exists public.register_device(text, text);
create or replace function public.register_device(
  p_device_id  text,
  p_user_agent text,
  p_city       text default null,
  p_country    text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare is_new boolean;
begin
  if auth.uid() is null then return false; end if;
  insert into public.user_devices (user_id, device_id, user_agent, city, country)
  values (auth.uid(), p_device_id, p_user_agent, nullif(p_city, ''), nullif(p_country, ''))
  on conflict (user_id, device_id)
    do update set last_seen  = now(),
                  user_agent = excluded.user_agent,
                  -- keep the last known location if this login couldn't resolve one
                  city       = coalesce(nullif(excluded.city, ''), user_devices.city),
                  country    = coalesce(nullif(excluded.country, ''), user_devices.country),
                  revoked_at = null   -- a fresh login clears any prior revoke
  returning (xmax = 0) into is_new;   -- xmax = 0 => the row was INSERTed (new device), not updated
  return coalesce(is_new, false);
end; $$;
grant execute on function public.register_device(text, text, text, text) to authenticated;


-- ============================================================================
-- ===== supabase/064_login_streak.sql =====
-- ============================================================================
-- 064_login_streak.sql - daily login streaks for interns (admin/founder visibility + intern's own badge).
-- Run after 063. Idempotent. A "day" is a Pakistan (Asia/Karachi) calendar day, computed server-side so
-- the client clock/timezone can't skew it. One row per user per active day; streaks are derived, not stored.

create table if not exists public.daily_active (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  day        date not null,                       -- PKT calendar day the user opened the portal
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
create index if not exists daily_active_day on public.daily_active (day desc);

alter table public.daily_active enable row level security;

-- users read their own active-days; admins/founders read everyone's (for the engagement roster).
drop policy if exists daily_active_read on public.daily_active;
create policy daily_active_read on public.daily_active
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- no client insert/update/delete: writes go only through mark_active_today() below.

-- Heartbeat: record that the current user opened the portal today (PKT). Idempotent per day.
create or replace function public.mark_active_today()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.daily_active (user_id, day)
  values (auth.uid(), (now() at time zone 'Asia/Karachi')::date)
  on conflict (user_id, day) do nothing;
end; $$;
grant execute on function public.mark_active_today() to authenticated;

-- The current user's own streak (for the intern dashboard badge). Always returns exactly one row.
-- current_streak counts consecutive PKT days ending today OR yesterday (a streak stays "alive" until a
-- full day is missed); active_today is true only once they've opened the portal today.
create or replace function public.my_login_streak()
returns table (current_streak int, longest_streak int, last_active date, active_today boolean, total_days int)
language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'Asia/Karachi')::date as d),
  runs as (
    select day, day - (row_number() over (order by day))::int as grp
    from public.daily_active where user_id = auth.uid()
  ),
  islands as (
    select count(*)::int as len, max(day) as end_day from runs group by grp
  )
  select
    coalesce(max(case when i.end_day >= (select d from today) - 1 then i.len end), 0)::int,
    coalesce(max(i.len), 0)::int,
    max(i.end_day),
    coalesce(bool_or(i.end_day = (select d from today)), false),
    (select count(*)::int from public.daily_active where user_id = auth.uid())
  from islands i;
$$;
grant execute on function public.my_login_streak() to authenticated;

-- Admin/founder only: per-user streaks for every intern who has ever been active. Non-admins get no rows.
-- Interns who have never opened the portal simply won't appear (the client treats them as streak 0).
create or replace function public.get_login_streaks()
returns table (user_id uuid, current_streak int, longest_streak int, last_active date, active_today boolean, total_days int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
  with today as (select (now() at time zone 'Asia/Karachi')::date as d),
  runs as (
    select da.user_id, da.day,
           da.day - (row_number() over (partition by da.user_id order by da.day))::int as grp
    from public.daily_active da
  ),
  islands as (
    select r.user_id, count(*)::int as len, max(r.day) as end_day
    from runs r group by r.user_id, r.grp
  ),
  agg as (
    select i.user_id,
           coalesce(max(case when i.end_day >= (select d from today) - 1 then i.len end), 0)::int as current_streak,
           coalesce(max(i.len), 0)::int as longest_streak,
           max(i.end_day) as last_active
    from islands i group by i.user_id
  ),
  totals as (
    select da.user_id, count(*)::int as total_days from public.daily_active da group by da.user_id
  )
  select a.user_id, a.current_streak, a.longest_streak, a.last_active,
         (a.last_active = (select d from today)) as active_today,
         t.total_days
  from agg a join totals t on t.user_id = a.user_id;
end; $$;
grant execute on function public.get_login_streaks() to authenticated;


-- ============================================================================
-- ===== supabase/065_device_model_and_last_login.sql =====
-- ============================================================================
-- 065_device_model_and_last_login.sql - device model (Android Client Hints) + exact last-login/last-active
-- timestamps on the login-streak RPCs. Run after 064. Idempotent.

-- ---- device model (best-effort; only Android Chromium exposes it; iPhone/laptop stay null) ----
alter table public.user_devices add column if not exists device_model text;

-- register_device gains p_model. Drop the old 4-arg form so the defaulted 5-arg isn't ambiguous with it.
drop function if exists public.register_device(text, text, text, text);
create or replace function public.register_device(
  p_device_id  text,
  p_user_agent text,
  p_city       text default null,
  p_country    text default null,
  p_model      text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare is_new boolean;
begin
  if auth.uid() is null then return false; end if;
  insert into public.user_devices (user_id, device_id, user_agent, city, country, device_model)
  values (auth.uid(), p_device_id, p_user_agent, nullif(p_city, ''), nullif(p_country, ''), nullif(p_model, ''))
  on conflict (user_id, device_id)
    do update set last_seen     = now(),
                  user_agent    = excluded.user_agent,
                  city          = coalesce(nullif(excluded.city, ''), user_devices.city),
                  country       = coalesce(nullif(excluded.country, ''), user_devices.country),
                  device_model  = coalesce(nullif(excluded.device_model, ''), user_devices.device_model),
                  revoked_at    = null
  returning (xmax = 0) into is_new;
  return coalesce(is_new, false);
end; $$;
grant execute on function public.register_device(text, text, text, text, text) to authenticated;

-- ---- streak RPCs now also return exact last-login + last-active timestamps ----
-- last_login    = most recent actual sign-in (activity_events type='login')
-- last_active_at = most recent day the portal was opened (daily_active.created_at of that day)

drop function if exists public.my_login_streak();
create or replace function public.my_login_streak()
returns table (
  current_streak int, longest_streak int, last_active date, active_today boolean,
  total_days int, last_login timestamptz, last_active_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'Asia/Karachi')::date as d),
  runs as (
    select day, day - (row_number() over (order by day))::int as grp
    from public.daily_active where user_id = auth.uid()
  ),
  islands as (
    select count(*)::int as len, max(day) as end_day from runs group by grp
  )
  select
    coalesce(max(case when i.end_day >= (select d from today) - 1 then i.len end), 0)::int,
    coalesce(max(i.len), 0)::int,
    max(i.end_day),
    coalesce(bool_or(i.end_day = (select d from today)), false),
    (select count(*)::int from public.daily_active where user_id = auth.uid()),
    (select max(created_at) from public.activity_events where user_id = auth.uid() and type = 'login'),
    (select max(created_at) from public.daily_active where user_id = auth.uid())
  from islands i;
$$;
grant execute on function public.my_login_streak() to authenticated;

drop function if exists public.get_login_streaks();
create or replace function public.get_login_streaks()
returns table (
  user_id uuid, current_streak int, longest_streak int, last_active date,
  active_today boolean, total_days int, last_login timestamptz, last_active_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
  with today as (select (now() at time zone 'Asia/Karachi')::date as d),
  runs as (
    select da.user_id, da.day,
           da.day - (row_number() over (partition by da.user_id order by da.day))::int as grp
    from public.daily_active da
  ),
  islands as (
    select r.user_id, count(*)::int as len, max(r.day) as end_day
    from runs r group by r.user_id, r.grp
  ),
  agg as (
    select i.user_id,
           coalesce(max(case when i.end_day >= (select d from today) - 1 then i.len end), 0)::int as current_streak,
           coalesce(max(i.len), 0)::int as longest_streak,
           max(i.end_day) as last_active
    from islands i group by i.user_id
  ),
  totals as (
    select da.user_id, count(*)::int as total_days, max(da.created_at) as last_active_at
    from public.daily_active da group by da.user_id
  ),
  logins as (
    select ae.user_id, max(ae.created_at) as last_login
    from public.activity_events ae where ae.type = 'login' group by ae.user_id
  )
  select a.user_id, a.current_streak, a.longest_streak, a.last_active,
         (a.last_active = (select d from today)) as active_today,
         t.total_days, l.last_login, t.last_active_at
  from agg a
  join totals t on t.user_id = a.user_id
  left join logins l on l.user_id = a.user_id;
end; $$;
grant execute on function public.get_login_streaks() to authenticated;


-- ============================================================================
-- ===== supabase/066_lock_approved_submissions.sql =====
-- ============================================================================
-- 066_lock_approved_submissions.sql — once an intern's submission for a task (week) is APPROVED by an
-- admin/founder, that week is LOCKED for the intern: they can no longer upload a new version, replace
-- the submission, request a submission change, or request extra time for it. Admins/founders keep full
-- control (grading overrides, founder-granted extensions). The instant a submission is approved, any of
-- that intern's still-pending change/extension requests — plus an approved-but-unused change grant — are
-- auto-cancelled so they drop out of the review queues. Enforced server-side so it can't be bypassed by
-- hitting the API directly. Mirrors the client guard in TasksScreen. Run after 065. Idempotent.

-- 1) Allow a terminal 'cancelled' state on both request tables (used by the auto-cancel trigger below).
--    Drop whatever status CHECK exists (name may vary across environments) and re-add the widened one.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.submission_change_requests'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop execute format('alter table public.submission_change_requests drop constraint %I', c); end loop;
  alter table public.submission_change_requests
    add constraint submission_change_requests_status_check
    check (status in ('pending','approved','rejected','cancelled'));

  for c in
    select conname from pg_constraint
     where conrelid = 'public.task_extension_requests'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop execute format('alter table public.task_extension_requests drop constraint %I', c); end loop;
  alter table public.task_extension_requests
    add constraint task_extension_requests_status_check
    check (status in ('pending','approved','rejected','cancelled'));
end $$;

-- 2) Extend protect_submission (last set in 056): keep the "students can't self-grade" wipes and the
--    change-request gate, and add the approved-lock. A non-admin UPDATE whose EXISTING row is already
--    'approved' is refused outright — no unused change request can re-open it. (Founders/admins still
--    bypass the whole block, so a founder can override a verdict from the Admin Panel.)
create or replace function public.protect_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_req_id bigint;
begin
  if not public.is_admin() then
    new.status             := 'submitted';
    new.feedback           := null;
    new.graded_by          := null;
    new.graded_at          := null;
    new.score_completeness := null;
    new.score_accuracy     := null;
    new.score_evidence     := null;
    new.score_report       := null;

    if tg_op = 'UPDATE' then
      -- Approved is final for the intern: the week is locked, no replacement ever.
      if old.status = 'approved' then
        raise exception 'SUBMISSION_APPROVED_LOCKED: This week''s submission has been approved and can no longer be replaced.'
          using errcode = 'check_violation';
      end if;

      select r.id into v_req_id
        from public.submission_change_requests r
       where r.task_id = new.task_id
         and r.user_id = new.user_id
         and r.status  = 'approved'
         and r.consumed_at is null
       order by r.decided_at asc nulls last, r.id asc
       limit 1;

      if v_req_id is null then
        raise exception 'CHANGE_REQUEST_REQUIRED: A founder-approved change request is required before you can replace this submission.'
          using errcode = 'check_violation';
      end if;

      update public.submission_change_requests
         set consumed_at = now()
       where id = v_req_id;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists protect_submission_trg on public.submissions;
create trigger protect_submission_trg before insert or update on public.submissions
  for each row execute function public.protect_submission();

-- 3) Block a student from opening a NEW change/extension request once the week's submission is approved.
--    Admins/founders bypass (their SECURITY DEFINER RPCs, e.g. admin_grant_extension, still work).
create or replace function public.block_request_when_approved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and exists (
    select 1 from public.submissions s
     where s.task_id = new.task_id and s.user_id = new.user_id and s.status = 'approved'
  ) then
    raise exception 'SUBMISSION_APPROVED_LOCKED: This week''s submission has been approved — you can no longer request a change or extra time for it.'
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

drop trigger if exists scr_block_when_approved on public.submission_change_requests;
create trigger scr_block_when_approved before insert on public.submission_change_requests
  for each row execute function public.block_request_when_approved();

drop trigger if exists ter_block_when_approved on public.task_extension_requests;
create trigger ter_block_when_approved before insert on public.task_extension_requests
  for each row execute function public.block_request_when_approved();

-- 4) When a submission flips to 'approved' (grading, bulk-approve, any admin path), void that intern's
--    still-open requests for the task so they leave the review queues. A change grant that was approved
--    but never spent is revoked too; already-decided extensions stay as the historical record.
create or replace function public.cancel_requests_on_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.submission_change_requests
     set status = 'cancelled', decided_at = coalesce(decided_at, now())
   where task_id = new.task_id and user_id = new.user_id
     and (status = 'pending' or (status = 'approved' and consumed_at is null));

  update public.task_extension_requests
     set status = 'cancelled', decided_at = coalesce(decided_at, now())
   where task_id = new.task_id and user_id = new.user_id
     and status = 'pending';

  return new;
end; $$;

drop trigger if exists cancel_requests_on_approval_trg on public.submissions;
create trigger cancel_requests_on_approval_trg
  after update of status on public.submissions
  for each row when (new.status = 'approved' and old.status is distinct from 'approved')
  execute function public.cancel_requests_on_approval();


-- ============================================================================
-- ===== supabase/067_freely_replace_until_approved.sql =====
-- ============================================================================
-- 067_freely_replace_until_approved.sql — interns may now freely re-upload a submission while it is
-- pending review OR was rejected ("needs changes") — no founder-approved change request required. Only
-- an APPROVED submission stays locked (see 066). This supersedes the change-request gate that 056/066
-- put in protect_submission for non-admin UPDATEs. The submission_change_requests table, its RPC, and
-- the 066 block/cancel triggers are intentionally left in place (dormant / harmless) so any historical
-- rows and the founder review queue keep working. Run after 066. Idempotent.

create or replace function public.protect_submission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    -- Students can't self-grade: any non-admin write re-queues the submission and wipes grade fields.
    new.status             := 'submitted';
    new.feedback           := null;
    new.graded_by          := null;
    new.graded_at          := null;
    new.score_completeness := null;
    new.score_accuracy     := null;
    new.score_evidence     := null;
    new.score_report       := null;

    -- Approved is final: an approved submission can never be replaced by the intern (a founder can still
    -- reopen it from the Admin Panel by moving the status back to pending/rejected). Pending and rejected
    -- submissions are freely re-uploadable — the client-side deadline gate is the only remaining limit.
    if tg_op = 'UPDATE' and old.status = 'approved' then
      raise exception 'SUBMISSION_APPROVED_LOCKED: This week''s submission has been approved and can no longer be replaced.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists protect_submission_trg on public.submissions;
create trigger protect_submission_trg before insert or update on public.submissions
  for each row execute function public.protect_submission();


-- ============================================================================
-- ===== supabase/068_submission_feedback_history.sql =====
-- ============================================================================
-- 068_submission_feedback_history.sql — preserve marks + mentor feedback for every uploaded attempt.
-- Run after 067. Idempotent.
--
-- `submissions` remains the latest pointer. `submission_files` is the immutable upload history; these
-- columns snapshot the grade attached to each version so a rejected attempt is not lost on re-upload.

alter table public.submission_files add column if not exists status text not null default 'submitted';
alter table public.submission_files add column if not exists feedback text;
alter table public.submission_files add column if not exists graded_by uuid references public.profiles(id) on delete set null;
alter table public.submission_files add column if not exists graded_at timestamptz;
alter table public.submission_files add column if not exists score_completeness numeric(4,2);
alter table public.submission_files add column if not exists score_accuracy numeric(4,2);
alter table public.submission_files add column if not exists score_evidence numeric(4,2);
alter table public.submission_files add column if not exists score_report numeric(4,2);
alter table public.submission_files add column if not exists score_overall numeric(5,2)
  generated always as (
    case
      when score_completeness is null and score_accuracy is null
       and score_evidence is null and score_report is null then null
      else coalesce(score_completeness, 0) + coalesce(score_accuracy, 0)
         + coalesce(score_evidence, 0) + coalesce(score_report, 0)
    end
  ) stored;

alter table public.submission_files drop constraint if exists submission_files_status_check;
alter table public.submission_files add constraint submission_files_status_check
  check (status in ('submitted', 'approved', 'rejected'));

alter table public.submission_files drop constraint if exists submission_files_scores_check;
alter table public.submission_files add constraint submission_files_scores_check check (
  (score_completeness is null or score_completeness between 0 and 10) and
  (score_accuracy     is null or score_accuracy     between 0 and 10) and
  (score_evidence     is null or score_evidence     between 0 and 10) and
  (score_report       is null or score_report       between 0 and 10)
);

-- Older/current submissions may pre-date versioning. Create one history row so their current result
-- appears in the new views; existing versioned submissions are left untouched.
insert into public.submission_files (submission_id, task_id, user_id, file_path, file_name, uploaded_at)
select s.id, s.task_id, s.user_id, s.file_path, s.file_name, coalesce(s.submitted_at, now())
from public.submissions s
where s.file_path is not null
  and not exists (
    select 1 from public.submission_files sf
    where sf.task_id = s.task_id and sf.user_id = s.user_id
  );

-- Backfill the newest known attempt with the grade still present on `submissions`. Older overwritten
-- feedback cannot be reconstructed, but every decision made after this migration is preserved.
update public.submission_files sf
set status             = s.status,
    feedback           = s.feedback,
    graded_by          = s.graded_by,
    graded_at          = s.graded_at,
    score_completeness = s.score_completeness,
    score_accuracy     = s.score_accuracy,
    score_evidence     = s.score_evidence,
    score_report       = s.score_report
from public.submissions s
where sf.id = (
  select newest.id
  from public.submission_files newest
  where newest.task_id = s.task_id and newest.user_id = s.user_id
  order by newest.uploaded_at desc, newest.id desc
  limit 1
);

-- Students may append upload metadata, but cannot forge a verdict, feedback, grader, or marks.
drop policy if exists subfiles_insert on public.submission_files;
create policy subfiles_insert on public.submission_files
  for insert to authenticated with check (
    user_id = auth.uid()
    and status = 'submitted'
    and feedback is null and graded_by is null and graded_at is null
    and score_completeness is null and score_accuracy is null
    and score_evidence is null and score_report is null
  );

-- Every admin/founder grading path (single grade, bulk approval, founder override) updates the latest
-- upload snapshot. A student re-upload changes `submissions` to submitted before its new history row is
-- inserted; submitted updates are deliberately ignored so the previous rejected feedback remains intact.
create or replace function public.snapshot_submission_grade()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status not in ('approved', 'rejected') then return new; end if;

  update public.submission_files sf
  set status             = new.status,
      feedback           = new.feedback,
      graded_by          = new.graded_by,
      graded_at          = new.graded_at,
      score_completeness = new.score_completeness,
      score_accuracy     = new.score_accuracy,
      score_evidence     = new.score_evidence,
      score_report       = new.score_report
  where sf.id = (
    select newest.id
    from public.submission_files newest
    where newest.task_id = new.task_id and newest.user_id = new.user_id
    order by newest.uploaded_at desc, newest.id desc
    limit 1
  );
  return new;
end; $$;

drop trigger if exists snapshot_submission_grade_trg on public.submissions;
create trigger snapshot_submission_grade_trg
  after update of status, feedback, graded_by, graded_at,
    score_completeness, score_accuracy, score_evidence, score_report
  on public.submissions
  for each row execute function public.snapshot_submission_grade();



-- ============================================================================
-- ===== supabase/069_reliable_login_activity.sql =====
-- ============================================================================
-- 069_reliable_login_activity.sql — reliable daily heartbeat + real Auth last-sign-in timestamps.
-- Run after 068. Idempotent.

-- `created_at` remains the first portal visit on that PKT day; `last_seen_at` is refreshed by the
-- client heartbeat and gives admins a useful recent-activity time.
alter table public.daily_active add column if not exists last_seen_at timestamptz not null default now();
update public.daily_active set last_seen_at = created_at where last_seen_at is null;

create or replace function public.mark_active_today()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.daily_active (user_id, day, created_at, last_seen_at)
  values (auth.uid(), (now() at time zone 'Asia/Karachi')::date, now(), now())
  on conflict (user_id, day) do update set last_seen_at = excluded.last_seen_at;
end; $$;
grant execute on function public.mark_active_today() to authenticated;

-- Own streak. Auth's last_sign_in_at is authoritative; the activity-event value is only a fallback for
-- installations where the Auth timestamp is unavailable.
drop function if exists public.my_login_streak();
create or replace function public.my_login_streak()
returns table (
  current_streak int, longest_streak int, last_active date, active_today boolean,
  total_days int, last_login timestamptz, last_active_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'Asia/Karachi')::date as d),
  runs as (
    select da.day, da.day - (row_number() over (order by da.day))::int as grp
    from public.daily_active da where da.user_id = auth.uid()
  ),
  islands as (
    select count(*)::int as len, max(day) as end_day from runs group by grp
  ),
  streak as (
    select
      coalesce(max(case when i.end_day >= (select d from today) - 1 then i.len end), 0)::int as current_streak,
      coalesce(max(i.len), 0)::int as longest_streak
    from islands i
  ),
  totals as (
    select count(*)::int as total_days, max(da.day) as last_active, max(da.last_seen_at) as last_active_at
    from public.daily_active da where da.user_id = auth.uid()
  )
  select st.current_streak, st.longest_streak, t.last_active,
         coalesce(t.last_active = (select d from today), false), t.total_days,
         coalesce(
           (select u.last_sign_in_at from auth.users u where u.id = auth.uid()),
           (select max(ae.created_at) from public.activity_events ae where ae.user_id = auth.uid() and ae.type = 'login')
         ),
         t.last_active_at
  from streak st cross join totals t;
$$;
grant execute on function public.my_login_streak() to authenticated;

-- Admin/founder view returns every intern, including people with no heartbeat yet. This makes a missing
-- streak explicit (zero) while still showing their real Supabase Auth last sign-in.
drop function if exists public.get_login_streaks();
create or replace function public.get_login_streaks()
returns table (
  user_id uuid, current_streak int, longest_streak int, last_active date,
  active_today boolean, total_days int, last_login timestamptz, last_active_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
  with today as (select (now() at time zone 'Asia/Karachi')::date as d),
  interns as (
    select p.id from public.profiles p where p.role = 'student'
  ),
  runs as (
    select da.user_id, da.day,
           da.day - (row_number() over (partition by da.user_id order by da.day))::int as grp
    from public.daily_active da
  ),
  islands as (
    select r.user_id, count(*)::int as len, max(r.day) as end_day
    from runs r group by r.user_id, r.grp
  ),
  streak as (
    select i.user_id,
           coalesce(max(case when i.end_day >= (select d from today) - 1 then i.len end), 0)::int as current_streak,
           coalesce(max(i.len), 0)::int as longest_streak
    from islands i group by i.user_id
  ),
  totals as (
    select da.user_id, count(*)::int as total_days, max(da.day) as last_active,
           max(da.last_seen_at) as last_active_at
    from public.daily_active da group by da.user_id
  ),
  event_logins as (
    select ae.user_id, max(ae.created_at) as last_login
    from public.activity_events ae where ae.type = 'login' group by ae.user_id
  )
  select p.id,
         coalesce(s.current_streak, 0), coalesce(s.longest_streak, 0), t.last_active,
         coalesce(t.last_active = (select d from today), false), coalesce(t.total_days, 0),
         coalesce(u.last_sign_in_at, el.last_login), t.last_active_at
  from interns p
  left join streak s on s.user_id = p.id
  left join totals t on t.user_id = p.id
  left join auth.users u on u.id = p.id
  left join event_logins el on el.user_id = p.id;
end; $$;
grant execute on function public.get_login_streaks() to authenticated;



-- ============================================================================
-- ===== supabase/070_risk_cases.sql =====
-- ============================================================================
-- 070_risk_cases.sql — Intervention Case Management. Turn the computed "at-risk / Cohort Health"
-- label into a managed workflow: assign a mentor, choose a risk reason, record outreach, keep
-- PRIVATE staff notes, set a follow-up date, and resolve. Run after 069. Idempotent.
--
-- Design notes:
--  * "At risk" is today derived CLIENT-SIDE in AdminPanel (cohortHealth useMemo) from overdue /
--    rejected / zero-approved signals — there is no server record. These tables are the first
--    server representation, so a case persists across reloads and is shared across all admins.
--  * Rows are STAFF-ONLY and never visible to the intern: RLS grants SELECT to public.is_admin()
--    (founders inherit via is_admin), and every mutation flows through a SECURITY DEFINER RPC —
--    so there is deliberately NO client insert/update/delete policy (same hardening pattern as
--    admin_actions in 014 and message_reports).
--  * Every RPC audit-logs via public.log_admin_action(...) AND appends a timeline event.
--  * risk_reason values mirror the real client scoring signals plus manual reasons.

-- ============================== TABLES ==============================

create table if not exists public.risk_cases (
  id           bigint generated always as identity primary key,
  intern_id    uuid not null references public.profiles(id) on delete cascade,
  opened_by    uuid references public.profiles(id) on delete set null,
  mentor_id    uuid references public.profiles(id) on delete set null,
  risk_reason  text not null default 'other'
               check (risk_reason in ('overdue_tasks','rejected_work','no_approved_work','inactivity','unpaid_fee','late_comer','other')),
  severity     text not null default 'medium' check (severity in ('low','medium','high')),
  status       text not null default 'open'   check (status in ('open','monitoring','resolved')),
  summary      text check (summary is null or char_length(summary) <= 2000),
  follow_up_at timestamptz,
  opened_at    timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles(id) on delete set null,
  resolution   text check (resolution is null or char_length(resolution) <= 2000)
);
create index if not exists risk_cases_status_time on public.risk_cases (status, opened_at desc);
create index if not exists risk_cases_intern      on public.risk_cases (intern_id);
create index if not exists risk_cases_followup    on public.risk_cases (follow_up_at) where status <> 'resolved';
-- At most one ACTIVE (non-resolved) case per intern — prevents duplicates.
create unique index if not exists risk_cases_one_active on public.risk_cases (intern_id) where status <> 'resolved';

create table if not exists public.risk_case_notes (
  id          bigint generated always as identity primary key,
  case_id     bigint not null references public.risk_cases(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  author_name text,                                   -- snapshot: survives author deletion
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists risk_case_notes_case on public.risk_case_notes (case_id, created_at desc);

create table if not exists public.risk_case_events (
  id         bigint generated always as identity primary key,
  case_id    bigint not null references public.risk_cases(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  actor_name text,                                    -- snapshot
  kind       text not null
             check (kind in ('email','dm','call','meeting','status_change','mentor_assigned','note_added','follow_up_set','opened','system')),
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists risk_case_events_case on public.risk_case_events (case_id, created_at desc);

-- ===================== RLS: staff read-only; writes via RPC only =====================
-- SELECT limited to admins/founders. All writes go through the SECURITY DEFINER RPCs below
-- (which bypass RLS), so there is intentionally NO client insert/update/delete policy.

alter table public.risk_cases       enable row level security;
alter table public.risk_case_notes  enable row level security;
alter table public.risk_case_events enable row level security;

drop policy if exists "risk_cases_read" on public.risk_cases;
create policy "risk_cases_read" on public.risk_cases
  for select to authenticated using (public.is_admin());

drop policy if exists "risk_case_notes_read" on public.risk_case_notes;
create policy "risk_case_notes_read" on public.risk_case_notes
  for select to authenticated using (public.is_admin());

drop policy if exists "risk_case_events_read" on public.risk_case_events;
create policy "risk_case_events_read" on public.risk_case_events
  for select to authenticated using (public.is_admin());

-- ============================== HELPERS ==============================
-- Append a timeline event, snapshotting the caller's name. Internal: called only from the RPCs
-- below (each runs as SECURITY DEFINER, so no separate grant is required).
create or replace function public.risk_case_add_event(p_case bigint, p_kind text, p_detail text)
returns void language plpgsql security definer set search_path = public as $$
declare a_name text;
begin
  select display_name into a_name from public.profiles where id = auth.uid();
  insert into public.risk_case_events (case_id, actor_id, actor_name, kind, detail)
  values (p_case, auth.uid(), a_name, p_kind, p_detail);
end; $$;

-- ===================== RPCs (admin-gated, audit-logged) =====================

-- Open a case, or return the existing active one for that intern (idempotent for the "Open case" button).
create or replace function public.open_risk_case(
  p_intern uuid,
  p_reason text default 'other',
  p_severity text default 'medium',
  p_summary text default null,
  p_mentor uuid default null,
  p_follow_up timestamptz default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_reason not in ('overdue_tasks','rejected_work','no_approved_work','inactivity','unpaid_fee','late_comer','other')
    then raise exception 'bad reason'; end if;
  if p_severity not in ('low','medium','high') then raise exception 'bad severity'; end if;

  -- one active case per intern
  select id into v_id from public.risk_cases where intern_id = p_intern and status <> 'resolved' limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.risk_cases (intern_id, opened_by, mentor_id, risk_reason, severity, summary, follow_up_at)
  values (p_intern, auth.uid(), p_mentor, p_reason, p_severity, p_summary, p_follow_up)
  returning id into v_id;

  perform public.risk_case_add_event(v_id, 'opened', 'reason=' || p_reason || ', severity=' || p_severity);
  if p_mentor is not null then perform public.risk_case_add_event(v_id, 'mentor_assigned', null); end if;
  perform public.log_admin_action('open_risk_case', p_intern, p_reason);
  return v_id;
end; $$;

create or replace function public.assign_case_mentor(p_case bigint, p_mentor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_intern uuid; m_name text;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.risk_cases set mentor_id = p_mentor where id = p_case returning intern_id into v_intern;
  if v_intern is null then raise exception 'no such case'; end if;
  select display_name into m_name from public.profiles where id = p_mentor;
  perform public.risk_case_add_event(p_case, 'mentor_assigned', m_name);
  perform public.log_admin_action('assign_case_mentor', v_intern, m_name);
end; $$;

create or replace function public.add_case_note(p_case bigint, p_body text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_intern uuid; a_name text;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if char_length(coalesce(p_body, '')) < 1 then raise exception 'empty note'; end if;
  select intern_id into v_intern from public.risk_cases where id = p_case;
  if v_intern is null then raise exception 'no such case'; end if;
  select display_name into a_name from public.profiles where id = auth.uid();
  insert into public.risk_case_notes (case_id, author_id, author_name, body)
  values (p_case, auth.uid(), a_name, p_body) returning id into v_id;
  perform public.risk_case_add_event(p_case, 'note_added', null);
  perform public.log_admin_action('add_case_note', v_intern, null);
  return v_id;
end; $$;

-- Record an outreach touch (email / DM / call / meeting). For email, the client also calls
-- notifyUser() to actually send; this RPC just records that it happened on the timeline.
create or replace function public.log_case_outreach(p_case bigint, p_kind text, p_detail text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_intern uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_kind not in ('email','dm','call','meeting') then raise exception 'bad outreach kind'; end if;
  select intern_id into v_intern from public.risk_cases where id = p_case;
  if v_intern is null then raise exception 'no such case'; end if;
  perform public.risk_case_add_event(p_case, p_kind, p_detail);
  perform public.log_admin_action('case_outreach', v_intern, p_kind);
end; $$;

create or replace function public.set_case_status(p_case bigint, p_status text, p_resolution text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_intern uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('open','monitoring','resolved') then raise exception 'bad status'; end if;
  update public.risk_cases
     set status      = p_status,
         resolved_at = case when p_status = 'resolved' then now()      else null end,
         resolved_by = case when p_status = 'resolved' then auth.uid() else null end,
         resolution  = case when p_status = 'resolved' then p_resolution else null end
   where id = p_case returning intern_id into v_intern;
  if v_intern is null then raise exception 'no such case'; end if;
  perform public.risk_case_add_event(p_case, 'status_change', p_status);
  perform public.log_admin_action('set_case_status', v_intern, p_status);
end; $$;

create or replace function public.set_case_follow_up(p_case bigint, p_when timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare v_intern uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.risk_cases set follow_up_at = p_when where id = p_case returning intern_id into v_intern;
  if v_intern is null then raise exception 'no such case'; end if;
  perform public.risk_case_add_event(p_case, 'follow_up_set',
    case when p_when is null then null else to_char(p_when at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC' end);
  perform public.log_admin_action('set_case_follow_up', v_intern, null);
end; $$;

-- ============================== GRANTS ==============================
grant execute on function public.open_risk_case(uuid, text, text, text, uuid, timestamptz) to authenticated;
grant execute on function public.assign_case_mentor(bigint, uuid)               to authenticated;
grant execute on function public.add_case_note(bigint, text)                    to authenticated;
grant execute on function public.log_case_outreach(bigint, text, text)          to authenticated;
grant execute on function public.set_case_status(bigint, text, text)            to authenticated;
grant execute on function public.set_case_follow_up(bigint, timestamptz)        to authenticated;

-- Follow-up reminders: a scheduled job (Vercel Cron, service role) scans
--   select * from public.risk_cases where status <> 'resolved' and follow_up_at <= now();
-- and notifies the mentor — added in the Phase-3/Phase-0 scheduler work, not here.


-- ============================================================================
-- ===== supabase/071_feature_flags.sql =====
-- ============================================================================
-- 071_feature_flags.sql — Per-feature on/off switches so new work ships dark and a founder flips it
-- on when ready. An extensible key/value companion to app_settings (055). Run after 070. Idempotent.
--
-- Any authenticated user may READ the flags (the client gates UI from them). Only a founder writes,
-- through set_feature_flag(). is_feature_enabled(key) is a SECURITY DEFINER helper usable inside RLS
-- and other functions. Unknown keys read as false (disabled).

create table if not exists public.feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  label       text,                       -- human description for the admin toggle list
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

alter table public.feature_flags enable row level security;

drop policy if exists "feature_flags_read" on public.feature_flags;
create policy "feature_flags_read" on public.feature_flags
  for select to authenticated using (true);
-- No client writes — founders change flags only through set_feature_flag().

-- Seed the roadmap feature keys (all OFF). Safe to re-run: existing rows keep their current state.
insert into public.feature_flags (key, label) values
  ('interventions',          'Intervention case management (Phase 1)'),
  ('competency_matrix',      'Competency matrix & skill passport (Phase 2)'),
  ('resource_library',       'Resource & knowledge library (Phase 3)'),
  ('weekly_digest',          'Weekly cohort digest & action center (Phase 3)'),
  ('office_hours',           'Mentor office hours & booking (Phase 4)'),
  ('passkeys',               'WebAuthn passkey authentication (Phase 5)'),
  ('submission_similarity',  'Content-based submission similarity (Phase 6)'),
  ('alumni_board',           'Alumni opportunities board (Phase 7)'),
  ('case_studies',           'Public case studies & publishing (Phase 7)'),
  ('client_portal',          'Website lead & client portal (Phase 8)')
on conflict (key) do nothing;

-- Read a flag (unknown → false). SECURITY DEFINER so it also works inside RLS / other definer fns.
create or replace function public.is_feature_enabled(p_key text)
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce((select enabled from public.feature_flags where key = p_key), false);
$$;
grant execute on function public.is_feature_enabled(text) to authenticated;

-- Founder-only: flip a flag (audit-logged). Creates the key if it doesn't exist yet.
create or replace function public.set_feature_flag(p_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Only a founder can change feature flags.';
  end if;
  insert into public.feature_flags (key, enabled, updated_at, updated_by)
  values (p_key, coalesce(p_enabled, false), now(), auth.uid())
  on conflict (key) do update
    set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
  perform public.log_admin_action('set_feature_flag', null, p_key || '=' || coalesce(p_enabled, false)::text);
end; $$;
grant execute on function public.set_feature_flag(text, boolean) to authenticated;


-- ============================================================================
-- ===== supabase/072_notifications.sql =====
-- ============================================================================
-- 072_notifications.sql — One shared, persistent notifications feed any feature can write to
-- (case follow-ups, weekly digest, booking reminders, opportunities). The existing Notification
-- Center (NotificationsScreen) aggregates mentions/announcements/grades live; this table is the
-- durable, per-user store new features push into. Run after 071. Idempotent.
--
-- A user reads and marks read ONLY their own rows. Inserts come from an admin (a case → notify the
-- intern) or the service role (the digest cron). auth.uid() IS NULL is the service-role bypass,
-- matching the convention in 028 (protect_profile_columns / guard_staff_delete).

create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null default 'generic'
              check (kind in ('generic','case','digest','booking','resource','opportunity','system')),
  title       text not null check (char_length(title) between 1 and 200),
  body        text check (body is null or char_length(body) <= 2000),
  link        text,                                    -- optional in-portal route/anchor to open
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_time   on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

-- Read your own notifications only.
drop policy if exists "notifications_read_own" on public.notifications;
create policy "notifications_read_own" on public.notifications
  for select to authenticated using (user_id = auth.uid());
-- No client insert/update/delete — writes go through the RPCs below (mark-read is own-row only).

-- Push a notification to one user. Allowed for any admin, or the service role (auth.uid() null).
create or replace function public.push_notification(
  p_user uuid, p_title text, p_body text default null, p_kind text default 'generic', p_link text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_kind not in ('generic','case','digest','booking','resource','opportunity','system') then
    raise exception 'bad kind';
  end if;
  insert into public.notifications (user_id, kind, title, body, link)
  values (p_user, p_kind, p_title, p_body, p_link)
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.push_notification(uuid, text, text, text, text) to authenticated;

-- Mark one of MY notifications read.
create or replace function public.mark_notification_read(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.notifications set read_at = now()
   where id = p_id and user_id = auth.uid() and read_at is null;
end; $$;
grant execute on function public.mark_notification_read(bigint) to authenticated;

-- Mark ALL of MY notifications read.
create or replace function public.mark_all_notifications_read()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null;
end; $$;
grant execute on function public.mark_all_notifications_read() to authenticated;


-- ============================================================================
-- ===== supabase/073_resource_library.sql =====
-- ============================================================================
-- 073_resource_library.sql — Department/week resource & knowledge library with full-text search,
-- bookmarks, and completion tracking. Run after 072. Idempotent. Gated in-app by `resource_library`.
--
-- Admins publish resources (is_published); everyone authenticated reads published rows, admins also
-- see drafts. Bookmarks/progress are per-user (own rows via RLS). Resource writes go through admin
-- RPCs (audit-logged). "Versioning" is a version counter bumped on edit (full history is a later add).

create table if not exists public.resources (
  id           bigint generated always as identity primary key,
  title        text not null check (char_length(title) between 1 and 200),
  description  text check (description is null or char_length(description) <= 2000),
  kind         text not null default 'link' check (kind in ('guide','recording','template','tool','link')),
  url          text,                          -- external link, or null when the file lives in R2
  r2_key       text,                          -- uploaded file key in R2, or null
  domain_id    int references public.domains(id) on delete set null,   -- null = all departments
  week         int check (week is null or (week between 0 and 52)),
  version      int not null default 1,
  is_published boolean not null default false,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  search       tsvector generated always as (
                 to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))
               ) stored
);
create index if not exists resources_pub    on public.resources (is_published, domain_id, week);
create index if not exists resources_search on public.resources using gin (search);

create table if not exists public.resource_bookmarks (
  user_id     uuid   not null references public.profiles(id) on delete cascade,
  resource_id bigint not null references public.resources(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, resource_id)
);

create table if not exists public.resource_progress (
  user_id      uuid   not null references public.profiles(id) on delete cascade,
  resource_id  bigint not null references public.resources(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, resource_id)
);

alter table public.resources          enable row level security;
alter table public.resource_bookmarks enable row level security;
alter table public.resource_progress  enable row level security;

-- Read: published rows to everyone; drafts to admins. No client writes (admins use the RPCs below).
drop policy if exists "resources_read" on public.resources;
create policy "resources_read" on public.resources
  for select to authenticated using (is_published or public.is_admin());

-- Bookmarks / progress: users manage their own rows.
drop policy if exists "bookmarks_rw" on public.resource_bookmarks;
create policy "bookmarks_rw" on public.resource_bookmarks
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "progress_rw" on public.resource_progress;
create policy "progress_rw" on public.resource_progress
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Admin: create (p_id null) or update a resource. Bumps version + updated_at on edit.
create or replace function public.upsert_resource(
  p_id bigint, p_title text, p_description text, p_kind text, p_url text, p_r2_key text,
  p_domain_id int, p_week int, p_publish boolean)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_kind not in ('guide','recording','template','tool','link') then raise exception 'bad kind'; end if;
  if char_length(coalesce(p_title,'')) < 1 then raise exception 'title required'; end if;

  if p_id is null then
    insert into public.resources (title, description, kind, url, r2_key, domain_id, week,
                                  is_published, published_by, published_at, created_by)
    values (p_title, p_description, p_kind, p_url, p_r2_key, p_domain_id, p_week,
            coalesce(p_publish, false),
            case when coalesce(p_publish, false) then auth.uid() end,
            case when coalesce(p_publish, false) then now() end,
            auth.uid())
    returning id into v_id;
    perform public.log_admin_action('create_resource', null, p_title);
  else
    update public.resources set
      title = p_title, description = p_description, kind = p_kind, url = p_url, r2_key = p_r2_key,
      domain_id = p_domain_id, week = p_week, version = version + 1, updated_at = now(),
      is_published = coalesce(p_publish, is_published),
      published_by = case when coalesce(p_publish, false) and not is_published then auth.uid() else published_by end,
      published_at = case when coalesce(p_publish, false) and published_at is null then now() else published_at end
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'no such resource'; end if;
    perform public.log_admin_action('update_resource', null, p_title);
  end if;
  return v_id;
end; $$;
grant execute on function public.upsert_resource(bigint, text, text, text, text, text, int, int, boolean) to authenticated;

create or replace function public.set_resource_published(p_id bigint, p_published boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.resources set
    is_published = coalesce(p_published, false),
    published_by = case when coalesce(p_published, false) then auth.uid() else published_by end,
    published_at = case when coalesce(p_published, false) and published_at is null then now() else published_at end,
    updated_at = now()
  where id = p_id;
  perform public.log_admin_action(case when coalesce(p_published, false) then 'publish_resource' else 'unpublish_resource' end, null, p_id::text);
end; $$;
grant execute on function public.set_resource_published(bigint, boolean) to authenticated;

create or replace function public.delete_resource(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  delete from public.resources where id = p_id;
  perform public.log_admin_action('delete_resource', null, p_id::text);
end; $$;
grant execute on function public.delete_resource(bigint) to authenticated;


-- ============================================================================
-- ===== supabase/074_weekly_digest.sql =====
-- ============================================================================
-- 074_weekly_digest.sql — idempotency log for the weekly cohort digest cron. Run after 073.
-- The digest is composed in app/api/cron/weekly-digest (service role, reads across RLS); this table
-- just guarantees each intern is emailed at most once per ISO week. Idempotent.

create table if not exists public.weekly_digest_log (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  week_of  date not null,               -- Monday (UTC) of the ISO week the digest covers
  sent_at  timestamptz not null default now(),
  primary key (user_id, week_of)
);
create index if not exists weekly_digest_log_week on public.weekly_digest_log (week_of);

alter table public.weekly_digest_log enable row level security;
-- Written only by the service-role cron (bypasses RLS); no client write policy. Admins may read it.
drop policy if exists "digest_log_read" on public.weekly_digest_log;
create policy "digest_log_read" on public.weekly_digest_log
  for select to authenticated using (public.is_admin());


-- ============================================================================
-- ===== supabase/075_office_hours.sql =====
-- ============================================================================
-- 075_office_hours.sql — Mentor office hours & booking (Phase 4). Run after 074. Idempotent.
-- Distinct from live_sessions (group RSVP, 025/062): these are limited-capacity slots an intern books
-- with a question. Admins create slots (RLS admin-write, like live_sessions). Bookings go through
-- capacity-checked SECURITY DEFINER RPCs. A no-show can auto-open a Phase-1 risk case. Flag: office_hours.

create table if not exists public.office_hour_slots (
  id           bigint generated always as identity primary key,
  mentor_id    uuid references public.profiles(id) on delete set null,
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  capacity     int not null default 1 check (capacity between 1 and 100),
  join_url     text,
  location     text,
  domain_id    int references public.domains(id) on delete set null,  -- null = all departments
  notes        text,
  booked_count int not null default 0,                                -- maintained by trigger, for display
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists office_hour_slots_time on public.office_hour_slots (starts_at);

create table if not exists public.office_hour_bookings (
  id         bigint generated always as identity primary key,
  slot_id    bigint not null references public.office_hour_slots(id) on delete cascade,
  intern_id  uuid   not null references public.profiles(id) on delete cascade,
  question   text check (question is null or char_length(question) <= 1000),
  status     text not null default 'booked' check (status in ('booked','cancelled','attended','no_show')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slot_id, intern_id)
);
create index if not exists office_hour_bookings_slot on public.office_hour_bookings (slot_id, status);
create index if not exists office_hour_bookings_intern on public.office_hour_bookings (intern_id);

alter table public.office_hour_slots    enable row level security;
alter table public.office_hour_bookings enable row level security;

-- Slots: read yours-or-global (like live_sessions); admins create/update/delete directly.
drop policy if exists "office_slots_read" on public.office_hour_slots;
create policy "office_slots_read" on public.office_hour_slots
  for select to authenticated using (
    public.is_admin()
    or domain_id is null
    or domain_id = (select domain_id from public.profiles where id = auth.uid())
  );
drop policy if exists "office_slots_admin_write" on public.office_hour_slots;
create policy "office_slots_admin_write" on public.office_hour_slots
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Bookings: read your own (or admin). All writes go through the RPCs below (no client write policy).
drop policy if exists "office_bookings_read" on public.office_hour_bookings;
create policy "office_bookings_read" on public.office_hour_bookings
  for select to authenticated using (intern_id = auth.uid() or public.is_admin());

-- Keep slot.booked_count in sync with active bookings (for capacity display).
create or replace function public.recount_office_hour_slot()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid bigint;
begin
  sid := coalesce(new.slot_id, old.slot_id);
  update public.office_hour_slots
     set booked_count = (select count(*) from public.office_hour_bookings
                          where slot_id = sid and status in ('booked','attended'))
   where id = sid;
  return null;
end; $$;
drop trigger if exists office_hour_bookings_recount on public.office_hour_bookings;
create trigger office_hour_bookings_recount
  after insert or update or delete on public.office_hour_bookings
  for each row execute function public.recount_office_hour_slot();

-- Intern books a slot (capacity-checked, serialized per slot). Re-activates a cancelled booking.
create or replace function public.book_office_hour(p_slot bigint, p_question text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_cap int; v_start timestamptz; v_mentor uuid; v_count int; v_id bigint; v_status text; a_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(p_slot);                       -- serialize concurrent bookings for this slot
  select capacity, starts_at, mentor_id into v_cap, v_start, v_mentor from public.office_hour_slots where id = p_slot;
  if v_cap is null then raise exception 'no such slot'; end if;
  if v_start <= now() then raise exception 'this slot has already started'; end if;

  select id, status into v_id, v_status from public.office_hour_bookings where slot_id = p_slot and intern_id = auth.uid();
  select count(*) into v_count from public.office_hour_bookings where slot_id = p_slot and status in ('booked','attended');

  if v_id is not null then
    if v_status <> 'cancelled' then raise exception 'you already booked this slot'; end if;
    if v_count >= v_cap then raise exception 'slot is full'; end if;
    update public.office_hour_bookings set status = 'booked', question = coalesce(p_question, question), updated_at = now() where id = v_id;
  else
    if v_count >= v_cap then raise exception 'slot is full'; end if;
    insert into public.office_hour_bookings (slot_id, intern_id, question) values (p_slot, auth.uid(), p_question) returning id into v_id;
  end if;

  if v_mentor is not null then                                 -- notify the mentor (definer insert bypasses RLS)
    select display_name into a_name from public.profiles where id = auth.uid();
    insert into public.notifications (user_id, kind, title, body)
    values (v_mentor, 'booking', 'New office-hours booking', coalesce(a_name, 'An intern') || ' booked your slot.');
  end if;
  return v_id;
end; $$;
grant execute on function public.book_office_hour(bigint, text) to authenticated;

create or replace function public.cancel_office_hour_booking(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.office_hour_bookings set status = 'cancelled', updated_at = now()
   where id = p_id and intern_id = auth.uid() and status <> 'cancelled';
end; $$;
grant execute on function public.cancel_office_hour_booking(bigint) to authenticated;

-- Admin marks attendance. A no-show optionally opens a Phase-1 risk case (guarded — interventions optional).
create or replace function public.mark_office_hour_attendance(p_booking bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_intern uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('booked','attended','no_show') then raise exception 'bad status'; end if;
  update public.office_hour_bookings set status = p_status, updated_at = now()
   where id = p_booking returning intern_id into v_intern;
  if v_intern is null then raise exception 'no such booking'; end if;
  perform public.log_admin_action('office_hour_attendance', v_intern, p_status);
  if p_status = 'no_show' then
    begin
      perform public.open_risk_case(v_intern, 'inactivity', 'medium', 'Missed a booked office-hours session.');
    exception when others then null;  -- interventions (070) is optional; never block attendance marking
    end;
  end if;
end; $$;
grant execute on function public.mark_office_hour_attendance(bigint, text) to authenticated;


-- ============================================================================
-- ===== supabase/076_webauthn.sql =====
-- ============================================================================
-- 076_webauthn.sql — Real WebAuthn passkeys (Phase 5). Run after 075. Idempotent. Flag: passkeys.
-- Credentials + short-lived challenges + hashed recovery codes, verified server-side in
-- app/api/webauthn/* with @simplewebauthn/server (service role). ADDITIVE: password login and
-- recovery codes always remain, so a user can never be locked out. Login step-up is per-user
-- opt-in via profiles.passkey_required (default false) — passwordless session-minting is deferred.

alter table public.profiles add column if not exists passkey_required boolean not null default false;

create table if not exists public.webauthn_credentials (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  credential_id text not null unique,          -- base64url credential id
  public_key    text not null,                 -- base64url of the COSE public key
  counter       bigint not null default 0,
  transports    text[],
  device_type   text,
  backed_up     boolean,
  nickname      text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists webauthn_credentials_user on public.webauthn_credentials (user_id);

create table if not exists public.webauthn_challenges (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles(id) on delete cascade,
  challenge  text not null,
  kind       text not null check (kind in ('register','auth')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists webauthn_challenges_user on public.webauthn_challenges (user_id, kind, created_at desc);

create table if not exists public.recovery_codes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  code_hash  text not null,                    -- sha256 hex of the plaintext code
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists recovery_codes_user on public.recovery_codes (user_id) where used_at is null;

alter table public.webauthn_credentials enable row level security;
alter table public.webauthn_challenges  enable row level security;
alter table public.recovery_codes       enable row level security;

-- Credentials: read your own (or admin), delete your own. Inserts/updates only via service-role routes.
drop policy if exists "webauthn_cred_read" on public.webauthn_credentials;
create policy "webauthn_cred_read" on public.webauthn_credentials
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "webauthn_cred_del" on public.webauthn_credentials;
create policy "webauthn_cred_del" on public.webauthn_credentials
  for delete to authenticated using (user_id = auth.uid());

-- Challenges + recovery codes: NO client policy (service-role routes only). RLS on with no policy
-- means authenticated clients cannot read/write; the service role bypasses RLS. This keeps the
-- recovery code_hash values unreadable by clients.

-- How many unused recovery codes the caller has (for the settings UI — never exposes the hashes).
create or replace function public.recovery_codes_remaining()
returns int language sql security definer set search_path = public stable as $$
  select count(*)::int from public.recovery_codes where user_id = auth.uid() and used_at is null;
$$;
grant execute on function public.recovery_codes_remaining() to authenticated;


-- ============================================================================
-- ===== supabase/077_submission_similarity.sql =====
-- ============================================================================
-- 077_submission_similarity.sql — Content-based submission similarity (Phase 6). Run after 076. Idempotent.
-- Extracted PDF text + a MinHash fingerprint per submission, plus admin-visible similarity pairs with
-- matched passages + a confidence score. Extraction/compare run in app/api/similarity/extract (service
-- role). Admin-only, HUMAN-IN-THE-LOOP: this flags for review, it never auto-penalizes. Flag: submission_similarity.

create table if not exists public.submission_text (
  submission_id bigint primary key references public.submissions(id) on delete cascade,
  content       text,
  char_len      int,
  minhash       bigint[],
  extracted_at  timestamptz not null default now()
);

create table if not exists public.similarity_pairs (
  id          bigint generated always as identity primary key,
  a_id        bigint not null references public.submissions(id) on delete cascade,
  b_id        bigint not null references public.submissions(id) on delete cascade,
  a_label     text,
  b_label     text,
  score       numeric not null default 0,               -- estimated Jaccard, 0..1
  matched     jsonb   not null default '[]'::jsonb,      -- shared passages, denormalized for the UI
  dismissed   boolean not null default false,
  computed_at timestamptz not null default now(),
  unique (a_id, b_id)
);
create index if not exists similarity_pairs_score on public.similarity_pairs (dismissed, score desc);

alter table public.submission_text  enable row level security;
alter table public.similarity_pairs enable row level security;

-- Admin-only read. Inserts/updates via the service-role extraction route (bypasses RLS).
drop policy if exists "submission_text_admin" on public.submission_text;
create policy "submission_text_admin" on public.submission_text
  for select to authenticated using (public.is_admin());

drop policy if exists "similarity_pairs_admin" on public.similarity_pairs;
create policy "similarity_pairs_admin" on public.similarity_pairs
  for select to authenticated using (public.is_admin());

-- Admin dismisses / restores a flagged pair (audit-logged).
create or replace function public.set_similarity_dismissed(p_id bigint, p_dismissed boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.similarity_pairs set dismissed = coalesce(p_dismissed, true) where id = p_id;
  perform public.log_admin_action(case when coalesce(p_dismissed, true) then 'dismiss_similarity' else 'restore_similarity' end, null, p_id::text);
end; $$;
grant execute on function public.set_similarity_dismissed(bigint, boolean) to authenticated;


-- ============================================================================
-- ===== supabase/078_alumni_board.sql =====
-- ============================================================================
-- 078_alumni_board.sql — Alumni opportunities board (Phase 7, #7). Run after 077. Idempotent.
-- Jobs / referrals / competitions / certifications / volunteer projects. Admins publish (admin-write
-- RLS, like live_sessions); interns + alumni browse published ones, save, and track applications.
-- Flag: alumni_board.

create table if not exists public.opportunities (
  id           bigint generated always as identity primary key,
  type         text not null default 'job' check (type in ('job','referral','competition','certification','volunteer')),
  title        text not null check (char_length(title) between 1 and 200),
  org          text,
  link         text,
  description  text check (description is null or char_length(description) <= 4000),
  location     text,
  posted_by    uuid references public.profiles(id) on delete set null,
  expires_at   timestamptz,
  is_published boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists opportunities_pub on public.opportunities (is_published, created_at desc);

create table if not exists public.opportunity_saves (
  user_id        uuid   not null references public.profiles(id) on delete cascade,
  opportunity_id bigint not null references public.opportunities(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (user_id, opportunity_id)
);

create table if not exists public.applications (
  id             bigint generated always as identity primary key,
  opportunity_id bigint not null references public.opportunities(id) on delete cascade,
  user_id        uuid   not null references public.profiles(id) on delete cascade,
  status         text not null default 'applied' check (status in ('saved','applied','interview','offer','rejected','withdrawn')),
  notes          text check (notes is null or char_length(notes) <= 2000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (opportunity_id, user_id)
);
create index if not exists applications_user on public.applications (user_id, updated_at desc);

alter table public.opportunities     enable row level security;
alter table public.opportunity_saves enable row level security;
alter table public.applications       enable row level security;

-- Opportunities: read published (or admin); admins create/update/delete directly.
drop policy if exists "opportunities_read" on public.opportunities;
create policy "opportunities_read" on public.opportunities
  for select to authenticated using (is_published or public.is_admin());
drop policy if exists "opportunities_admin_write" on public.opportunities;
create policy "opportunities_admin_write" on public.opportunities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Saves + applications: users own their rows (admins may read applications).
drop policy if exists "opp_saves_rw" on public.opportunity_saves;
create policy "opp_saves_rw" on public.opportunity_saves
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "applications_rw" on public.applications;
create policy "applications_rw" on public.applications
  for all to authenticated using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid());

create or replace function public.touch_application()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists touch_application_trg on public.applications;
create trigger touch_application_trg before update on public.applications
  for each row execute function public.touch_application();


-- ============================================================================
-- ===== supabase/079_posts.sql =====
-- ============================================================================
-- 079_posts.sql — Public case studies & knowledge publishing (Phase 7, #10). Run after 078. Idempotent.
-- Admin-authored posts (case studies / research / advisories / success stories) with SEO metadata,
-- rendered on the public site at /insights. Published posts are readable by ANON; drafts by admins
-- only. Admins write via admin-write RLS. Flag: case_studies.

create table if not exists public.posts (
  id           bigint generated always as identity primary key,
  type         text not null default 'case_study' check (type in ('case_study','research','advisory','success_story')),
  slug         text not null unique,
  title        text not null check (char_length(title) between 1 and 200),
  excerpt      text check (excerpt is null or char_length(excerpt) <= 500),
  body         text,                                   -- markdown
  cover_key    text,                                   -- optional R2 key
  seo_meta     jsonb not null default '{}'::jsonb,
  status       text not null default 'draft' check (status in ('draft','published')),
  author_id    uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists posts_pub on public.posts (status, published_at desc);

alter table public.posts enable row level security;

-- Published posts are public (anon + authenticated); drafts are admin-only. No `to` clause = all roles.
drop policy if exists "posts_read" on public.posts;
create policy "posts_read" on public.posts
  for select using (status = 'published' or public.is_admin());

-- Admins create/update/delete (anon can't — not authenticated).
drop policy if exists "posts_admin_write" on public.posts;
create policy "posts_admin_write" on public.posts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Ensure the public API role can read (RLS still gates rows to published).
grant select on public.posts to anon, authenticated;

create or replace function public.touch_post()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  if new.status = 'published' and new.published_at is null then new.published_at := now(); end if;
  return new;
end $$;
drop trigger if exists touch_post_trg on public.posts;
create trigger touch_post_trg before insert or update on public.posts
  for each row execute function public.touch_post();


-- ============================================================================
-- ===== supabase/080_client_portal.sql =====
-- ============================================================================
-- 080_client_portal.sql — Website lead & client portal (Phase 8, #9). Run after 079. Idempotent.
-- Structured service requests (scope questionnaire) replacing plain contact inquiries, an admin
-- pipeline (status + proposal), and a TOKEN-GATED client engagement view — no separate auth system:
-- each request carries a secret access_token and the client opens /engagement/<token>. Flag: client_portal.
--
-- SECURITY NOTES: the token is a bearer secret in the URL (anyone with the link can view). Binary
-- document exchange over R2 is a DEFERRED follow-up that warrants its own security review; this MVP
-- shares documents as links via engagement updates. All public access goes through the two RPCs below.

create table if not exists public.service_requests (
  id              bigint generated always as identity primary key,
  access_token    text not null unique,
  name            text,
  email           text,
  org             text,
  title           text not null,
  scope           jsonb not null default '{}'::jsonb,   -- questionnaire answers
  status          text not null default 'new'  check (status in ('new','triage','scoping','proposal','active','closed')),
  proposal_status text not null default 'none' check (proposal_status in ('none','draft','sent','accepted','declined')),
  proposal_amount numeric,
  proposal_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists service_requests_status on public.service_requests (status, created_at desc);

create table if not exists public.engagement_updates (
  id                bigint generated always as identity primary key,
  request_id        bigint not null references public.service_requests(id) on delete cascade,
  body              text,
  kind              text not null default 'update' check (kind in ('update','proposal','document','status')),
  link              text,                                -- shared link for kind='document'
  visible_to_client boolean not null default true,
  author_id         uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists engagement_updates_req on public.engagement_updates (request_id, created_at desc);

alter table public.service_requests   enable row level security;
alter table public.engagement_updates enable row level security;

-- Admin-only direct access. The public interacts ONLY through the SECURITY DEFINER RPCs below.
drop policy if exists "service_requests_admin" on public.service_requests;
create policy "service_requests_admin" on public.service_requests
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "engagement_updates_admin" on public.engagement_updates;
create policy "engagement_updates_admin" on public.engagement_updates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.touch_service_request()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists touch_service_request_trg on public.service_requests;
create trigger touch_service_request_trg before update on public.service_requests
  for each row execute function public.touch_service_request();

-- Public intake: create a request from the website, return the secret engagement token.
create or replace function public.submit_service_request(p_name text, p_email text, p_org text, p_title text, p_scope jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if char_length(coalesce(p_title, '')) < 1 or char_length(coalesce(p_email, '')) < 3 then
    raise exception 'title and email are required';
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.service_requests (access_token, name, email, org, title, scope)
  values (v_token, left(p_name, 120), left(p_email, 180), left(p_org, 180), left(p_title, 200), coalesce(p_scope, '{}'::jsonb));
  return v_token;
end; $$;
grant execute on function public.submit_service_request(text, text, text, text, jsonb) to anon, authenticated;

-- Token-gated read for the client engagement page (no login). Returns null for an unknown token.
create or replace function public.get_engagement(p_token text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare r public.service_requests;
begin
  select * into r from public.service_requests where access_token = p_token;
  if r.id is null then return null; end if;
  return jsonb_build_object(
    'title', r.title, 'name', r.name, 'org', r.org, 'status', r.status,
    'proposal_status', r.proposal_status, 'proposal_amount', r.proposal_amount, 'proposal_note', r.proposal_note,
    'created_at', r.created_at,
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('body', u.body, 'kind', u.kind, 'link', u.link, 'created_at', u.created_at) order by u.created_at desc)
      from public.engagement_updates u where u.request_id = r.id and u.visible_to_client), '[]'::jsonb)
  );
end; $$;
grant execute on function public.get_engagement(text) to anon, authenticated;


-- ============================================================================
-- ===== supabase/081_feature_flag_sql_editor.sql =====
-- ============================================================================
-- 081_feature_flag_sql_editor.sql — Let a founder flip flags from the Supabase SQL editor, and add
-- an in-app founder toggle. Run after 080. Idempotent.
--
-- WHY: set_feature_flag() (071) gated every write on is_founder(), which is
-- `exists(select 1 from profiles where id = auth.uid() and is_founder)`. In the Supabase SQL editor
-- there is NO JWT, so auth.uid() is NULL → is_founder() is false → the RAISE fired with
-- "Only a founder can change feature flags." — even for the actual founder. That made the documented
-- runbook (FEATURE_FLAGS.md, which says to run these from the SQL editor) impossible to follow.
--
-- FIX: enforce the founder check ONLY for real authenticated sessions. When auth.uid() is NULL
-- (SQL editor / service role) allow the write — exactly the "service-role bypass" escape hatch the
-- sibling founder guards in 028 (protect_profile_columns, guard_staff_delete) already use. A logged-in
-- non-founder is still rejected. This keeps the audit-log call (log_admin_action tolerates a NULL
-- actor: actor_id/actor_name just record NULL for an SQL-editor change).

create or replace function public.set_feature_flag(p_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Enforce founder-only for authenticated sessions only. auth.uid() IS NULL in the SQL editor /
  -- service role — the intended escape hatch (matches the guards in 028).
  if auth.uid() is not null and not public.is_founder() then
    raise exception 'Only a founder can change feature flags.';
  end if;
  insert into public.feature_flags (key, enabled, updated_at, updated_by)
  values (p_key, coalesce(p_enabled, false), now(), auth.uid())
  on conflict (key) do update
    set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
  perform public.log_admin_action('set_feature_flag', null, p_key || '=' || coalesce(p_enabled, false)::text);
end; $$;
grant execute on function public.set_feature_flag(text, boolean) to authenticated;

-- No schema change is needed for the in-app founder toggle (app/portal/_components/FeatureFlagsAdmin.jsx):
--   * a founder reads the flags through the existing "feature_flags_read" policy (071), and
--   * writes through set_feature_flag() above (auth.uid() is set + is_founder() true in-app).


-- ============================================================================
-- ===== supabase/082_skill_passport.sql =====
-- ============================================================================
-- 082_skill_passport.sql — Digital Skill Passport (Phase 9, spotlight). Run after 081. Idempotent.
-- Upgrades the Phase-2 Skill Passport (flag competency_matrix) into a shareable, VERIFIABLE credential:
--   * passport_shares — a per-intern secret token + public flag, OWNER-ONLY readable (a private
--     passport's token is never exposed to other clients),
--   * an optional per-task skill/tool tag list (tasks.skills),
--   * two RPCs — publish_passport() (owner opts in / mints the token) and the anon-safe
--     get_public_passport(token), which RECOMPUTES proficiency from approved rubric marks server-side,
--     so a shared credential can't be forged by editing the client.
-- Flag: skill_passport. Nothing is public until a founder flips the flag AND an intern publishes.
--
-- SECURITY: the token is a 64-hex bearer secret in the URL (anyone with the link can view a PUBLIC
-- passport, like the 080 engagement token). It unlocks only already-public data — a private passport
-- returns null for any token — and the token row is readable only by its owner.

-- 1) Optional per-task skill / tool tags, e.g. '{Burp Suite,OWASP}'. Null/empty → the passport falls
--    back to the intern's domain as the single skill, so it works before any task has been tagged.
alter table public.tasks add column if not exists skills text[];

-- 2) Per-intern share record (token + public flag). Owner-only RLS keeps the token from leaking; public
--    reads go exclusively through get_public_passport() (SECURITY DEFINER, below).
create table if not exists public.passport_shares (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  token      text not null unique,
  is_public  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.passport_shares enable row level security;

drop policy if exists "passport_shares_owner" on public.passport_shares;
create policy "passport_shares_owner" on public.passport_shares
  for select to authenticated using (user_id = auth.uid());
-- No client writes — the owner changes state only through publish_passport().

-- 3) Seed the feature flag (OFF). Safe to re-run; existing row keeps its state.
insert into public.feature_flags (key, label) values
  ('skill_passport', 'Digital skill passport — verifiable credential (Phase 9)')
on conflict (key) do nothing;

-- 4) Owner opts a public passport on/off; mints a token on first publish, then reuses it (stable link).
--    Returns the token while public, null while private. Authenticated; acts on the caller only.
create or replace function public.publish_passport(p_public boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.passport_shares (user_id, token, is_public)
  values (
    auth.uid(),
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    coalesce(p_public, false)
  )
  on conflict (user_id) do update set is_public = coalesce(p_public, false), updated_at = now()
  returning token into v_token;
  return case when coalesce(p_public, false) then v_token else null end;
end; $$;
grant execute on function public.publish_passport(boolean) to authenticated;

-- 5) Token-gated public read (anon). Recomputes the passport from APPROVED, rubric-graded submissions:
--    per-axis averages, an overall %, and per-skill "grip" (mean rubric-overall /40 → 0-100 % →
--    Novice/Proficient/Advanced). Null unless the token matches a share row with is_public = true.
create or replace function public.get_public_passport(p_token text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_uid uuid; p public.profiles; v_domain text; v_result jsonb;
begin
  if coalesce(p_token, '') = '' then return null; end if;
  select user_id into v_uid from public.passport_shares where token = p_token and is_public = true;
  if v_uid is null then return null; end if;
  select * into p from public.profiles where id = v_uid;
  if p.id is null then return null; end if;
  select name into v_domain from public.domains where id = p.domain_id;

  with subs as (
    select s.score_completeness c, s.score_accuracy a, s.score_evidence e, s.score_report r,
           s.score_overall o, s.graded_at, t.week, t.title,
           coalesce(nullif(t.skills, '{}'::text[]), array[coalesce(v_domain, 'General')]) as skills
    from public.submissions s
    join public.tasks t on t.id = s.task_id
    where s.user_id = p.id and s.status = 'approved' and s.graded_at is not null
  ),
  axes as (
    select jsonb_build_array(
      jsonb_build_object('key','completeness','label','Completeness','value', round(avg(c)::numeric, 1)),
      jsonb_build_object('key','accuracy',    'label','Accuracy',    'value', round(avg(a)::numeric, 1)),
      jsonb_build_object('key','evidence',    'label','Evidence',    'value', round(avg(e)::numeric, 1)),
      jsonb_build_object('key','report',      'label','Reporting',   'value', round(avg(r)::numeric, 1))
    ) j, count(o) n, round(avg(o) / 40 * 100) overall_pct from subs
  ),
  skills as (
    select sk as skill, round(avg(o) / 40 * 100) pct, count(o) n
    from subs, unnest(subs.skills) sk
    group by sk
  ),
  skills_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'skill', skill, 'pct', pct, 'tasks', n,
      'level', case when pct >= 80 then 'Advanced' when pct >= 60 then 'Proficient' else 'Novice' end
    ) order by pct desc nulls last), '[]'::jsonb) j from skills
  ),
  tasks_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'week', week, 'title', title, 'score', round(o::numeric, 1), 'graded_at', graded_at
    ) order by week), '[]'::jsonb) j from subs
  )
  select jsonb_build_object(
    'name',         coalesce(p.full_name, p.display_name, 'Intern'),
    'display_name', p.display_name,
    'member_id',    p.member_id,
    'domain',       v_domain,
    'overall_pct',  (select overall_pct from axes),
    'count',        (select n from axes),
    'axes',         (select j from axes),
    'skills',       (select j from skills_json),
    'tasks',        (select j from tasks_json),
    'issued_at',    p.created_at,
    'verified',     true
  ) into v_result;
  return v_result;
end; $$;
grant execute on function public.get_public_passport(text) to anon, authenticated;


-- ============================================================================
-- ===== supabase/083_console_v2_flag.sql =====
-- ============================================================================
-- 083_console_v2_flag.sql — Founder Console v2 (Phase 10) feature flag. Run after 082. Idempotent.
-- Client-only redesign of the admin console (grouped two-tier nav + ⌘K command palette + a "Home"
-- signal dashboard), fully additive in `AdminPanel.jsx` and gated by `console_v2`. No schema changes —
-- this migration only SEEDS the flag (OFF) so it shows up in Founder → Feature Flags. When the flag is
-- off the original flat tab strip renders unchanged.
insert into public.feature_flags (key, label) values
  ('console_v2', 'Founder Console v2 — grouped nav + command palette (Phase 10)')
on conflict (key) do nothing;


-- ============================================================================
-- ===== supabase/084_public_stats.sql =====
-- ============================================================================
-- 084_public_stats.sql — Public proof/trust stats (Phase 11 — growth). Run after 083. Idempotent.
-- One anon-safe RPC returning non-PII cohort/agency aggregates for the marketing site's "proof" section
-- (interns trained, alumni, certificates issued, approved deliverables, projects delivered). No table or
-- flag changes. Adjust the counted sets here if you want to expose a different headline number.
--
-- SECURITY: returns only counts (never rows/PII). SECURITY DEFINER so it reads past RLS for accurate
-- totals; granted to anon so the public landing page can call it without a session.

create or replace function public.get_public_stats()
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'interns_trained',      (select count(*) from public.profiles where role = 'student'),
    'alumni',               (select count(*) from public.profiles where is_alumni = true),
    'certificates_issued',  (select count(*) from public.profiles where certificate_key is not null),
    'deliverables_approved',(select count(*) from public.submissions where status = 'approved'),
    'projects_delivered',   (select count(*) from public.service_requests where status = 'closed')
  );
$$;
grant execute on function public.get_public_stats() to anon, authenticated;


-- ============================================================================
-- ===== supabase/085_lead_scoring.sql =====
-- ============================================================================
-- 085_lead_scoring.sql — Client-lead scoring (Phase 11 — growth). Run after 084. Idempotent.
-- Adds a 0-100 `score` to service_requests and computes it inside the existing anon intake RPC
-- (extends 080's submit_service_request, same signature) from the scope questionnaire — budget /
-- timeline / engagement type / org / detail. Lets ClientRequestsAdmin chase the hot leads first.
-- No new flag; scoring is on as soon as this is applied. Tune the weights below to taste.

alter table public.service_requests add column if not exists score int;

create or replace function public.submit_service_request(p_name text, p_email text, p_org text, p_title text, p_scope jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text; v_score int; b text; t text; ty text; d text;
begin
  if char_length(coalesce(p_title, '')) < 1 or char_length(coalesce(p_email, '')) < 3 then
    raise exception 'title and email are required';
  end if;

  b  := coalesce(p_scope->>'budget', '');
  t  := coalesce(p_scope->>'timeline', '');
  ty := lower(coalesce(p_scope->>'type', ''));
  d  := coalesce(p_scope->>'description', '');

  v_score := least(100,
      case when b like '%15k+%'    then 40
           when b like '%5k%15k%'  then 30
           when b like '%1k%5k%'   then 20
           when b like '%< $1k%'   then 8
           else 5 end
    + case when t = 'ASAP'   then 25
           when t like '2%4%' then 20
           when t like '1%3%' then 12
           else 6 end
    + case when ty like '%red team%' or ty like '%penetration%' or ty like '%audit%' then 15
           when ty like '%consult%'  or ty like '%training%' then 8
           else 3 end
    + case when char_length(coalesce(p_org, '')) > 1 then 10 else 0 end
    + case when char_length(d) > 80 then 10 else 0 end
  );

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.service_requests (access_token, name, email, org, title, scope, score)
  values (v_token, left(p_name, 120), left(p_email, 180), left(p_org, 180), left(p_title, 200), coalesce(p_scope, '{}'::jsonb), v_score);
  return v_token;
end; $$;
grant execute on function public.submit_service_request(text, text, text, text, jsonb) to anon, authenticated;


-- ============================================================================
-- ===== supabase/086_referrals.sql =====
-- ============================================================================
-- 086_referrals.sql — Referral & ambassador loops (Phase 11 — growth). Run after 085. Idempotent.
-- Per-user referral code + who-referred-whom attribution, plus RPCs to mint a code, attribute a signup,
-- and read stats (own count; founder sees a top-10 leaderboard). Reward fulfilment is intentionally
-- OUT of scope here — the founder decides the model (see docs/phases/PHASE-11-WEBSITE.md); this ships the
-- tracking + leaderboard. Flag: `referrals` (gates the visible share UI; attribution is inert until codes
-- exist, which only happens once the flag-gated share card hands them out).

alter table public.profiles add column if not exists referral_code text unique;
alter table public.profiles add column if not exists referred_by  uuid references public.profiles(id) on delete set null;

insert into public.feature_flags (key, label) values
  ('referrals', 'Referral & ambassador loops (Phase 11)')
on conflict (key) do nothing;

-- Caller mints (once) / returns their own short referral code.
create or replace function public.get_or_create_referral_code()
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select referral_code into v_code from public.profiles where id = auth.uid();
  if v_code is null then
    v_code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    update public.profiles set referral_code = v_code where id = auth.uid();
  end if;
  return v_code;
end; $$;
grant execute on function public.get_or_create_referral_code() to authenticated;

-- Set the CALLER's referrer from a code — once, never self, never overwrite an existing attribution.
create or replace function public.attribute_referral(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ref uuid;
begin
  if auth.uid() is null or coalesce(p_code, '') = '' then return; end if;
  select id into v_ref from public.profiles where referral_code = lower(p_code);
  if v_ref is null or v_ref = auth.uid() then return; end if;
  update public.profiles set referred_by = v_ref where id = auth.uid() and referred_by is null;
end; $$;
grant execute on function public.attribute_referral(text) to authenticated;

-- Caller's own referral count; founders additionally get the top-10 referrers leaderboard.
create or replace function public.referral_stats()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_mine int; v_board jsonb;
begin
  if auth.uid() is null then return null; end if;
  select count(*) into v_mine from public.profiles where referred_by = auth.uid();
  if public.is_admin() then
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', c) order by c desc), '[]'::jsonb) into v_board
    from (
      select coalesce(p.display_name, p.full_name, 'Intern') as name, count(r.id) as c
      from public.profiles p
      join public.profiles r on r.referred_by = p.id
      group by p.id, p.display_name, p.full_name
      order by c desc
      limit 10
    ) t;
  end if;
  return jsonb_build_object('mine', coalesce(v_mine, 0), 'leaderboard', v_board);
end; $$;
grant execute on function public.referral_stats() to authenticated;


-- ============================================================================
-- ===== supabase/087_subscribers.sql =====
-- ============================================================================
-- 087_subscribers.sql — Newsletter / lead capture (Phase 11 — growth). Run after 086. Idempotent.
-- Captures emails from the marketing site (Insights) so slow-burn leads aren't lost. Admin-only reads;
-- the public writes only through the anon `subscribe()` RPC. Sending the nurture drip reuses Resend and
-- is a founder-cadence decision (see docs/phases/PHASE-11-WEBSITE.md) — not wired to auto-send here.

create table if not exists public.subscribers (
  id           bigint generated always as identity primary key,
  email        text not null unique,
  source       text,
  unsubscribed boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.subscribers enable row level security;

drop policy if exists "subscribers_admin" on public.subscribers;
create policy "subscribers_admin" on public.subscribers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Public double-checks the email shape, then inserts (idempotent on email).
create or replace function public.subscribe(p_email text, p_source text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_email, '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email';
  end if;
  insert into public.subscribers (email, source)
  values (lower(left(p_email, 180)), left(nullif(p_source, ''), 60))
  on conflict (email) do nothing;
end; $$;
grant execute on function public.subscribe(text, text) to anon, authenticated;


-- ============================================================================
-- ===== supabase/088_waitlist.sql =====
-- ============================================================================
-- 088_waitlist.sql — Cohort waitlist / apply funnel (Phase 12 — growth: portal). Run after 087. Idempotent.
-- Public `/apply` collects demand between cohorts. Admin-only reads; the public writes only through the
-- anon `join_waitlist()` RPC. Flag `waitlist` gates whether the form is open (off → "not open" message),
-- so you can collect a waitlist, then open applications, without a deploy.

create table if not exists public.waitlist (
  id         bigint generated always as identity primary key,
  email      text not null unique,
  name       text,
  source     text,
  created_at timestamptz not null default now()
);
alter table public.waitlist enable row level security;

drop policy if exists "waitlist_admin" on public.waitlist;
create policy "waitlist_admin" on public.waitlist
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.feature_flags (key, label) values
  ('waitlist', 'Cohort waitlist / apply funnel (Phase 12)')
on conflict (key) do nothing;

create or replace function public.join_waitlist(p_email text, p_name text, p_source text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_email, '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email';
  end if;
  insert into public.waitlist (email, name, source)
  values (lower(left(p_email, 180)), left(nullif(p_name, ''), 120), left(nullif(p_source, ''), 60))
  on conflict (email) do nothing;
end; $$;
grant execute on function public.join_waitlist(text, text, text) to anon, authenticated;


-- ============================================================================
-- ===== supabase/089_grading_accelerators.sql =====
-- ============================================================================
-- 089_grading_accelerators.sql — Grading accelerators (Phase 12 — growth: portal). Run after 088. Idempotent.
-- Client-only admin-UX helpers in the grade dialog (rubric presets + keyboard submit) so grading is faster
-- and bigger cohorts stay reviewable. No schema change — just seeds the flag (OFF) so it appears in
-- Founder → Feature Flags. When off, the grade dialog is exactly as before.
insert into public.feature_flags (key, label) values
  ('grading_accelerators', 'Grading accelerators — rubric presets + keyboard submit (Phase 12)')
on conflict (key) do nothing;


-- ============================================================================
-- ===== supabase/090_re_engagement.sql =====
-- ============================================================================
-- 090_re_engagement.sql — Behavioral re-engagement (Phase 12 — growth: portal). Run after 089. Idempotent.
-- Supports a daily cron that nudges *engaged-but-stalling* interns (≥1 submission, but nothing in the last
-- STALE_DAYS) so fade-outs don't become drop-outs. De-dup table caps one nudge per intern per week; the
-- cron itself is gated by the `re_engagement` flag (SENDS EMAIL — enable in Wave 3). Founder controls the
-- threshold/copy in code + docs/phases/PHASE-12-PORTAL.md.

create table if not exists public.re_engagement_nudges (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  sent_on    date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);
create index if not exists re_engagement_nudges_user on public.re_engagement_nudges (user_id, sent_on desc);

alter table public.re_engagement_nudges enable row level security;
-- Writes happen only via the service-role cron (bypasses RLS). Admins may read for auditing.
drop policy if exists "re_engagement_admin_read" on public.re_engagement_nudges;
create policy "re_engagement_admin_read" on public.re_engagement_nudges
  for select to authenticated using (public.is_admin());

insert into public.feature_flags (key, label) values
  ('re_engagement', 'Behavioral re-engagement nudges — SENDS EMAIL (Phase 12)')
on conflict (key) do nothing;


-- ============================================================================
-- ===== supabase/091_self_serve_mentor.sql =====
-- ============================================================================
-- 091_self_serve_mentor.sql — Self-serve mentor (Phase 12 — growth: portal). Run after 090. Idempotent.
-- The Mentor screen already gives bounded, decision-tree guidance. This adds a KNOWLEDGE-BASE SEARCH over
-- the resource library's existing full-text index (migration 073's `resources.search` tsvector), so interns
-- can unblock themselves 24/7. No schema change — just seeds the `self_serve_mentor` flag (OFF). Curated FAQ
-- content is the founder's to add as resources (see docs/phases/PHASE-12-PORTAL.md).
insert into public.feature_flags (key, label) values
  ('self_serve_mentor', 'Self-serve mentor — knowledge-base search (Phase 12)')
on conflict (key) do nothing;


-- ============================================================================
-- ===== supabase/092_perf_indexes.sql =====
-- ============================================================================
-- 092_perf_indexes.sql — Targeted performance indexes (Phase 16 — scale). Run after 091. Idempotent.
-- The schema is already well-indexed; this closes the two real gaps on `submissions`, which only had a
-- (user_id) index. Everything that reads submissions BY TASK (deadline/re-engagement crons, bulk approve,
-- the Weekly Task Report's per-task grouping) and the passport/digest "approved BY USER" filters were doing
-- (user_id)-scan or seq-scan. These are additive B-tree indexes (no data change). Prefer a low-traffic
-- window; at current cohort size the build is near-instant. Cross-check the Supabase Performance advisor
-- (docs/phases/PHASE-16-PERFORMANCE.md) and drop anything it flags as redundant.

-- Task-scoped submission lookups: "who submitted task N", per-task grouping, grading.
create index if not exists submissions_task on public.submissions (task_id, user_id);

-- Per-user status filters: approved-by-user (Skill Passport, weekly digest, competency), rejected counts.
create index if not exists submissions_user_status on public.submissions (user_id, status);


-- ============================================================================
-- ===== supabase/093_data_export.sql =====
-- ============================================================================
-- 093_data_export.sql — Self-serve data export / GDPR (Phase 17 — quality). Run after 092. Idempotent.
-- An authenticated user can download everything the portal holds about them (profile + submissions +
-- activity) as one JSON blob, from their dashboard. Read-only, own-rows only (SECURITY DEFINER keyed on
-- auth.uid()). Account deletion stays admin-mediated (it must respect the kicked_emails / retention model).
create or replace function public.export_my_data()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v uuid; res jsonb;
begin
  v := auth.uid();
  if v is null then raise exception 'not authenticated'; end if;
  select jsonb_build_object(
    'exported_at', now(),
    'profile',     (select to_jsonb(p) from public.profiles p where p.id = v),
    'submissions', coalesce((select jsonb_agg(to_jsonb(s)) from public.submissions s where s.user_id = v), '[]'::jsonb),
    'activity',    coalesce((select jsonb_agg(to_jsonb(a)) from public.activity_events a where a.user_id = v), '[]'::jsonb)
  ) into res;
  return res;
end; $$;
grant execute on function public.export_my_data() to authenticated;


-- ============================================================================
-- ===== supabase/094_export_feedback_messages.sql =====
-- ============================================================================
-- 094_export_feedback_messages.sql — Extend the GDPR self-serve export (093) to also include the user's
-- own feedback, group-chat messages, and direct messages. Run after 093. Idempotent (create or replace).
-- Unchanged security posture: SECURITY DEFINER, own-rows only (keyed on auth.uid()), read-only, stable.
create or replace function public.export_my_data()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v uuid; res jsonb;
begin
  v := auth.uid();
  if v is null then raise exception 'not authenticated'; end if;
  select jsonb_build_object(
    'exported_at',     now(),
    'profile',         (select to_jsonb(p) from public.profiles p where p.id = v),
    'submissions',     coalesce((select jsonb_agg(to_jsonb(s)) from public.submissions s where s.user_id = v), '[]'::jsonb),
    'activity',        coalesce((select jsonb_agg(to_jsonb(a)) from public.activity_events a where a.user_id = v), '[]'::jsonb),
    'feedback',        coalesce((select jsonb_agg(to_jsonb(f)) from public.feedback f where f.user_id = v), '[]'::jsonb),
    'messages',        coalesce((select jsonb_agg(to_jsonb(m)) from public.messages m where m.user_id = v), '[]'::jsonb),
    -- DM threads the user owns (student_id) or sent into (sender_id); this is their own conversation.
    'direct_messages', coalesce((select jsonb_agg(to_jsonb(dm)) from public.dm_messages dm where dm.student_id = v or dm.sender_id = v), '[]'::jsonb)
  ) into res;
  return res;
end; $$;
grant execute on function public.export_my_data() to authenticated;


-- ============================================================================
-- ===== supabase/095_push_subscriptions.sql =====
-- ============================================================================
-- 095_push_subscriptions.sql — Web Push (Phase 17). Stores each browser/device push subscription so the
-- server can deliver Web Push notifications (VAPID / Web Push Protocol). Run after 094. Idempotent.
-- RLS: a user manages ONLY their own subscriptions; the server sends via the service role (bypasses RLS).
create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_own_select" on public.push_subscriptions;
create policy "push_own_select" on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists "push_own_insert" on public.push_subscriptions;
create policy "push_own_insert" on public.push_subscriptions
  for insert with check (user_id = auth.uid());

drop policy if exists "push_own_update" on public.push_subscriptions;
create policy "push_own_update" on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "push_own_delete" on public.push_subscriptions;
create policy "push_own_delete" on public.push_subscriptions
  for delete using (user_id = auth.uid());


-- ============================================================================
-- ===== supabase/096_cohort2_application_fields.sql =====
-- ============================================================================
-- 096_cohort2_application_fields.sql — Extend the waitlist into a full Cohort 2 application (Phase 12).
-- Run after 095. Idempotent. Adds the applicant fields the founder requires and a single validating RPC
-- `join_waitlist_v2(jsonb)` (anon-callable) that enforces every rule SERVER-SIDE — so the LinkedIn URL
-- format, RAM/domain/status/gender/experience enums, and "college required for students" all hold even if
-- the client is bypassed. Admin-only reads stay as defined in 088. The old join_waitlist() is left intact.

alter table public.waitlist
  add column if not exists phone          text,
  add column if not exists country        text,
  add column if not exists city           text,
  add column if not exists linkedin_url   text,
  add column if not exists domain         text,
  add column if not exists ram            int,
  add column if not exists current_status text,
  add column if not exists college        text,
  add column if not exists study_year     text,
  add column if not exists gender         text,
  add column if not exists experience     text,
  add column if not exists motivation     text;

create or replace function public.join_waitlist_v2(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email      text := lower(trim(coalesce(p->>'email', '')));
  v_name       text := trim(coalesce(p->>'name', ''));
  v_phone      text := trim(coalesce(p->>'phone', ''));
  v_country    text := trim(coalesce(p->>'country', ''));
  v_city       text := trim(coalesce(p->>'city', ''));
  v_linkedin   text := trim(coalesce(p->>'linkedin_url', ''));
  v_domain     text := trim(coalesce(p->>'domain', ''));
  v_ram        int  := nullif(p->>'ram', '')::int;
  v_status     text := trim(coalesce(p->>'current_status', ''));
  v_college    text := trim(coalesce(p->>'college', ''));
  v_study_year text := trim(coalesce(p->>'study_year', ''));
  v_gender     text := trim(coalesce(p->>'gender', ''));
  v_experience text := trim(coalesce(p->>'experience', ''));
  v_motivation text := trim(coalesce(p->>'motivation', ''));
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid_email'; end if;
  if v_name = '' then raise exception 'name_required'; end if;
  -- WhatsApp number with country code, e.g. +923001234567
  if v_phone !~ '^\+[0-9][0-9 ()\-]{6,18}$' then raise exception 'invalid_phone'; end if;
  if v_country = '' then raise exception 'country_required'; end if;
  if v_city = '' then raise exception 'city_required'; end if;
  -- LinkedIn profile shape: https://www.linkedin.com/in/<slug> (trailing slash optional)
  if v_linkedin !~ '^https://www\.linkedin\.com/in/[A-Za-z0-9%._-]+/?$' then raise exception 'invalid_linkedin'; end if;
  if v_domain not in ('Offensive Security','Defensive Security','Cloud Security','AI Security','GRC','Digital Forensics')
    then raise exception 'invalid_domain'; end if;
  if v_ram is null or v_ram not in (8,16,24) then raise exception 'invalid_ram'; end if;
  if v_status not in ('Student','Unemployed','Employed') then raise exception 'invalid_status'; end if;
  if v_status = 'Student' and v_college = '' then raise exception 'college_required'; end if;
  if v_status = 'Student' and v_study_year = '' then raise exception 'study_year_required'; end if;
  if v_gender not in ('Male','Female','Trans') then raise exception 'invalid_gender'; end if;
  if v_experience not in ('Beginner','Intermediate','Advanced') then raise exception 'invalid_experience'; end if;
  if char_length(v_motivation) < 10 then raise exception 'motivation_required'; end if;

  insert into public.waitlist
    (email, name, source, phone, country, city, linkedin_url, domain, ram, current_status, college, study_year, gender, experience, motivation)
  values
    (left(v_email,180), left(v_name,120), 'cohort-2', left(v_phone,40), left(v_country,80), left(v_city,80),
     left(v_linkedin,200), v_domain, v_ram, v_status, left(nullif(v_college,''),160), left(nullif(v_study_year,''),80),
     v_gender, v_experience, left(v_motivation,1200))
  on conflict (email) do update set
    name           = excluded.name,
    source         = excluded.source,
    phone          = excluded.phone,
    country        = excluded.country,
    city           = excluded.city,
    linkedin_url   = excluded.linkedin_url,
    domain         = excluded.domain,
    ram            = excluded.ram,
    current_status = excluded.current_status,
    college        = excluded.college,
    study_year     = excluded.study_year,
    gender         = excluded.gender,
    experience     = excluded.experience,
    motivation     = excluded.motivation;
end; $$;

grant execute on function public.join_waitlist_v2(jsonb) to anon, authenticated;


-- ============================================================================
-- ===== supabase/097_waitlist_decision.sql =====
-- ============================================================================
-- 097_waitlist_decision.sql — Admin accept/reject for Cohort 2 applications (Phase 12). Run after 096.
-- Idempotent. Adds a decision workflow to public.waitlist so an admin can Accept or Reject each applicant
-- (which triggers a confirmation email server-side, see app/api/apply/decision). Reads + updates are already
-- admin-only via the `waitlist_admin` policy from 088 — no new policy needed. `decided_by` references the
-- deciding admin's profile for an audit trail.

alter table public.waitlist
  add column if not exists decision    text not null default 'pending',
  add column if not exists decided_at  timestamptz,
  add column if not exists decided_by  uuid references public.profiles(id) on delete set null;

-- Constrain to the three valid states (drop-then-add so re-running stays idempotent).
alter table public.waitlist drop constraint if exists waitlist_decision_chk;
alter table public.waitlist
  add constraint waitlist_decision_chk check (decision in ('pending', 'accepted', 'rejected'));

create index if not exists waitlist_decision_idx on public.waitlist (decision, created_at desc);


-- ============================================================================
-- ===== supabase/098_referral_leaderboard.sql =====
-- ============================================================================
-- 098_referral_leaderboard.sql — Admin referral standings (Phase 11 — growth). Run after 097. Idempotent.
-- The referral loop (codes + `?ref=` capture + attribution + `referral_stats`) already ships; this adds the
-- OPERATIONAL view the founder needs to fulfil any of the three reward models — recognition, portal credit
-- per *approved* referral, and the "refer interns → become a community admin" path. Admin-only.
--
-- Returns, per referrer: total referred, how many of those became APPROVED students, and the list of who
-- they referred (name + status). Recognition = order by total; portal credit = the approved count.

create or replace function public.referral_leaderboard()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(row order by total_referred desc, approved_referred desc), '[]'::jsonb) into v
  from (
    select
      jsonb_build_object(
        'referrer_id', p.id,
        'name',        coalesce(p.display_name, p.full_name, 'Intern'),
        'member_id',   p.member_id,
        'total',       count(r.id),
        'approved',    count(r.id) filter (where r.status = 'approved'),
        'referred',    jsonb_agg(
                         jsonb_build_object(
                           'name',   coalesce(r.display_name, r.full_name, 'Intern'),
                           'status', coalesce(r.status, 'pending')
                         ) order by r.created_at
                       )
      ) as row,
      count(r.id) as total_referred,
      count(r.id) filter (where r.status = 'approved') as approved_referred
    from public.profiles p
    join public.profiles r on r.referred_by = p.id
    group by p.id, p.display_name, p.full_name, p.member_id
  ) t;
  return v;
end; $$;

grant execute on function public.referral_leaderboard() to authenticated;


-- ============================================================================
-- ===== supabase/099_mentor_starter_faqs.sql =====
-- ============================================================================
-- 099_mentor_starter_faqs.sql — Starter FAQ content for the self-serve mentor (Phase 12). Run after 098.
-- Idempotent (guarded by title). The self-serve mentor searches the resource library's full-text index
-- (073), so a curated FAQ = published `resources` rows. These are starter guides the founder can edit or
-- delete in Admin → Resources. Escalation target when the mentor can't answer: BOOK OFFICE HOURS (baked
-- into the "I'm stuck" entry below). Domain-agnostic (domain_id null) so every department sees them.

insert into public.resources (title, description, kind, is_published, published_at)
select v.title, v.description, 'guide', true, now()
from (values
  ('FAQ: How do I submit my weekly task?',
   'Open the Tasks tab in the portal, pick the current week''s task, and upload your submission (PDF or DOC). A mentor reviews every submission and marks it Approved or Rejected with written feedback. You can see your marks and feedback back in the Tasks tab.'),
  ('FAQ: What if I miss a deadline or need more time?',
   'Apply for an extension from the Tasks section in the portal. An admin can grant extra time until a specific date. If your submission was rejected, you resubmit by requesting an extension, then uploading a new version.'),
  ('FAQ: How is my work graded?',
   'Each submission is reviewed by a mentor and marked Approved or Rejected, with feedback. Approved tasks count toward your certificate. Rejected tasks must be corrected and resubmitted (request an extension to reopen the upload).'),
  ('FAQ: How do I earn the internship certificate?',
   'Complete all six weekly tasks on schedule and get each one approved. You then receive a verifiable ZeroDay Reapers internship completion certificate, which anyone can validate on our public certificate verification page.'),
  ('FAQ: What are the RAM / system requirements?',
   'Some tasks are assigned by RAM tier (8, 16, or 24 GB), so set your RAM correctly in your profile to get the right tasks. A Linux virtual machine or lab environment is strongly recommended for the practical work.'),
  ('FAQ: Is there a registration fee?',
   'Cohort 2 has a one-time registration fee of PKR 1,000, paid after Week 1. There are no other charges — the internship itself is remote and task-based.'),
  ('FAQ: What are office hours and how do I join?',
   'Office hours are scheduled live mentor sessions. Find upcoming sessions in the portal and join using the link shown. If you are blocked on a task, booking or attending office hours is the fastest way to get unstuck.'),
  ('FAQ: How do I join the Discord and WhatsApp community?',
   'Use the Discord and WhatsApp links on the ZeroDay Reapers website to join the community for announcements, resources, and support. Department groups are for applicants accepted into that field.'),
  ('FAQ: Can I refer friends, and what do I get?',
   'Yes. Share your personal referral link from the portal. The more interns you refer who actually join the internship, the better your chance to become a community admin — and to work with the founder directly in future.'),
  ('FAQ: Which domains can I intern in?',
   'ZeroDay Reapers offers internships in Offensive Security, Defensive Security, Cloud Security, AI Security, GRC (Governance, Risk & Compliance), and Digital Forensics.'),
  ('FAQ: I''m stuck on a task — what should I do?',
   'First, search these FAQs and the Resource Library for your topic. If you are still blocked, message an admin in the portal or book office hours — that is the right place to escalate a question the self-serve mentor cannot answer.')
) as v(title, description)
where not exists (select 1 from public.resources r where r.title = v.title);


-- ============================================================================
-- ===== supabase/100_referral_on_waitlist.sql =====
-- ============================================================================
-- 100_referral_on_waitlist.sql — Referral code on the Cohort 2 application + readable code scheme (Phase 11).
-- Run after 099. Idempotent. Three parts:
--   (1) waitlist gets referral_code (what the applicant typed) + referred_by (the resolved referrer's
--       profile id); join_waitlist_v2 validates the code SERVER-SIDE and rejects an unknown one.
--   (2) get_or_create_referral_code() now mints a HUMAN-READABLE code — <DEPT><FirstInitial+LastName or
--       FirstName><last3 phone digits> — and GUARANTEES uniqueness by appending a number on the rare
--       collision (the column is already unique). Existing codes are never regenerated.
--   (3) referral_stats() / referral_leaderboard() also count waitlist applications, so a referrer earns a
--       "point" the moment their referral applies (and you can see who was accepted).

-- (1) Referral columns on the application ---------------------------------------------------------------
alter table public.waitlist
  add column if not exists referral_code text,
  add column if not exists referred_by   uuid references public.profiles(id) on delete set null;
create index if not exists waitlist_referred_by_idx on public.waitlist (referred_by);

create or replace function public.join_waitlist_v2(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email      text := lower(trim(coalesce(p->>'email', '')));
  v_name       text := trim(coalesce(p->>'name', ''));
  v_phone      text := trim(coalesce(p->>'phone', ''));
  v_country    text := trim(coalesce(p->>'country', ''));
  v_city       text := trim(coalesce(p->>'city', ''));
  v_linkedin   text := trim(coalesce(p->>'linkedin_url', ''));
  v_domain     text := trim(coalesce(p->>'domain', ''));
  v_ram        int  := nullif(p->>'ram', '')::int;
  v_status     text := trim(coalesce(p->>'current_status', ''));
  v_college    text := trim(coalesce(p->>'college', ''));
  v_study_year text := trim(coalesce(p->>'study_year', ''));
  v_gender     text := trim(coalesce(p->>'gender', ''));
  v_experience text := trim(coalesce(p->>'experience', ''));
  v_motivation text := trim(coalesce(p->>'motivation', ''));
  v_ref_code   text := trim(coalesce(p->>'referral_code', ''));
  v_ref_by     uuid;
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid_email'; end if;
  if v_name = '' then raise exception 'name_required'; end if;
  if v_phone !~ '^\+[0-9][0-9 ()\-]{6,18}$' then raise exception 'invalid_phone'; end if;
  if v_country = '' then raise exception 'country_required'; end if;
  if v_city = '' then raise exception 'city_required'; end if;
  if v_linkedin !~ '^https://www\.linkedin\.com/in/[A-Za-z0-9%._-]+/?$' then raise exception 'invalid_linkedin'; end if;
  if v_domain not in ('Offensive Security','Defensive Security','Cloud Security','AI Security','GRC','Digital Forensics')
    then raise exception 'invalid_domain'; end if;
  if v_ram is null or v_ram not in (8,16,24) then raise exception 'invalid_ram'; end if;
  if v_status not in ('Student','Unemployed','Employed') then raise exception 'invalid_status'; end if;
  if v_status = 'Student' and v_college = '' then raise exception 'college_required'; end if;
  if v_status = 'Student' and v_study_year = '' then raise exception 'study_year_required'; end if;
  if v_gender not in ('Male','Female','Trans') then raise exception 'invalid_gender'; end if;
  if v_experience not in ('Beginner','Intermediate','Advanced') then raise exception 'invalid_experience'; end if;
  if char_length(v_motivation) < 10 then raise exception 'motivation_required'; end if;

  -- Referral code is OPTIONAL, but if given it must match an existing intern's code.
  if v_ref_code <> '' then
    select id into v_ref_by from public.profiles where lower(referral_code) = lower(v_ref_code) limit 1;
    if v_ref_by is null then raise exception 'invalid_referral'; end if;
  end if;

  insert into public.waitlist
    (email, name, source, phone, country, city, linkedin_url, domain, ram, current_status, college, study_year,
     gender, experience, motivation, referral_code, referred_by)
  values
    (left(v_email,180), left(v_name,120), 'cohort-2', left(v_phone,40), left(v_country,80), left(v_city,80),
     left(v_linkedin,200), v_domain, v_ram, v_status, left(nullif(v_college,''),160), left(nullif(v_study_year,''),80),
     v_gender, v_experience, left(v_motivation,1200), left(nullif(v_ref_code,''),40), v_ref_by)
  on conflict (email) do update set
    name           = excluded.name,
    source         = excluded.source,
    phone          = excluded.phone,
    country        = excluded.country,
    city           = excluded.city,
    linkedin_url   = excluded.linkedin_url,
    domain         = excluded.domain,
    ram            = excluded.ram,
    current_status = excluded.current_status,
    college        = excluded.college,
    study_year     = excluded.study_year,
    gender         = excluded.gender,
    experience     = excluded.experience,
    motivation     = excluded.motivation,
    referral_code  = excluded.referral_code,
    referred_by    = excluded.referred_by;
end; $$;
grant execute on function public.join_waitlist_v2(jsonb) to anon, authenticated;

-- (2) Human-readable, guaranteed-unique referral codes --------------------------------------------------
create or replace function public.get_or_create_referral_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code   text;
  v_full   text; v_phone text; v_dom text;
  v_dept   text; v_namepart text; v_digits text; v_base text; v_cand text;
  v_tokens text[]; v_i int := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select referral_code into v_code from public.profiles where id = auth.uid();
  if v_code is not null then return v_code; end if;  -- never regenerate an existing code

  select p.full_name, p.phone, d.name
    into v_full, v_phone, v_dom
    from public.profiles p left join public.domains d on d.id = p.domain_id
    where p.id = auth.uid();

  -- Department short code (from the referrer's own department).
  v_dept := case
    when v_dom ilike '%offensive%'  then 'OFF'
    when v_dom ilike '%defensive%'  then 'DEF'
    when v_dom ilike '%cloud%'      then 'CLD'
    when v_dom ilike '%ai%' or v_dom ilike '%artificial%' then 'AIS'
    when v_dom ilike '%grc%' or v_dom ilike '%governance%' or v_dom ilike '%compliance%' then 'GRC'
    when v_dom ilike '%forensic%'   then 'DFR'
    else coalesce(nullif(upper(substr(regexp_replace(coalesce(v_dom,''), '[^A-Za-z]', '', 'g'), 1, 3)), ''), 'ZDR')
  end;

  -- Name part: first-initial + last name, or just the first name when there's only one token.
  v_tokens := regexp_split_to_array(trim(regexp_replace(coalesce(v_full,''), '[^A-Za-z ]', '', 'g')), '\s+');
  if v_tokens is null or array_length(v_tokens,1) is null or coalesce(v_tokens[1],'') = '' then
    v_namepart := 'USER';
  elsif array_length(v_tokens,1) = 1 then
    v_namepart := upper(v_tokens[1]);
  else
    v_namepart := upper(substr(v_tokens[1],1,1) || v_tokens[array_length(v_tokens,1)]);
  end if;

  -- Last 3 phone digits (fallback: random 3 digits when there's no usable phone).
  v_digits := regexp_replace(coalesce(v_phone,''), '[^0-9]', '', 'g');
  if char_length(v_digits) >= 3 then v_digits := right(v_digits, 3);
  else v_digits := lpad((floor(random()*1000))::int::text, 3, '0'); end if;

  v_base := substr(upper(v_dept || v_namepart || v_digits), 1, 24);

  -- Guarantee uniqueness: append an incrementing number on the rare collision.
  v_cand := v_base;
  while exists (select 1 from public.profiles where referral_code = v_cand) loop
    v_i := v_i + 1;
    v_cand := v_base || v_i::text;
    if v_i > 50 then v_cand := lower(substr(replace(gen_random_uuid()::text,'-',''),1,8)); exit; end if;
  end loop;

  begin
    update public.profiles set referral_code = v_cand where id = auth.uid();
  exception when unique_violation then  -- extremely rare race between two identical bases
    v_cand := v_base || upper(substr(replace(gen_random_uuid()::text,'-',''),1,3));
    update public.profiles set referral_code = v_cand where id = auth.uid();
  end;
  return v_cand;
end; $$;
grant execute on function public.get_or_create_referral_code() to authenticated;

-- (3) Count waitlist applications toward the referrer's tally -------------------------------------------
create or replace function public.referral_stats()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_mine int; v_applied int; v_board jsonb;
begin
  if auth.uid() is null then return null; end if;
  select count(*) into v_mine    from public.profiles where referred_by = auth.uid();
  select count(*) into v_applied from public.waitlist where referred_by = auth.uid();
  if public.is_admin() then
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', c) order by c desc), '[]'::jsonb) into v_board
    from (
      select coalesce(p.display_name, p.full_name, 'Intern') as name, count(r.id) as c
      from public.profiles p
      join public.profiles r on r.referred_by = p.id
      group by p.id, p.display_name, p.full_name
      order by c desc
      limit 10
    ) t;
  end if;
  return jsonb_build_object('mine', coalesce(v_mine,0), 'applied', coalesce(v_applied,0), 'leaderboard', v_board);
end; $$;
grant execute on function public.referral_stats() to authenticated;

create or replace function public.referral_leaderboard()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  with referrers as (
    select referred_by as id from public.profiles where referred_by is not null
    union
    select referred_by       from public.waitlist where referred_by is not null
  )
  select coalesce(jsonb_agg(row order by (total + applied) desc, approved desc), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'referrer_id', p.id,
      'name',        coalesce(p.display_name, p.full_name, 'Intern'),
      'member_id',   p.member_id,
      'total',       (select count(*) from public.profiles r where r.referred_by = p.id),
      'approved',    (select count(*) from public.profiles r where r.referred_by = p.id and r.status = 'approved'),
      'applied',     (select count(*) from public.waitlist w where w.referred_by = p.id),
      'accepted',    (select count(*) from public.waitlist w where w.referred_by = p.id and w.decision = 'accepted'),
      'referred',    (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(r.display_name, r.full_name, 'Intern'), 'status', coalesce(r.status,'pending')) order by r.created_at), '[]'::jsonb)
                        from public.profiles r where r.referred_by = p.id)
    ) as row,
    (select count(*) from public.profiles r where r.referred_by = p.id) as total,
    (select count(*) from public.profiles r where r.referred_by = p.id and r.status='approved') as approved,
    (select count(*) from public.waitlist w where w.referred_by = p.id) as applied
    from (select distinct id from referrers) rr
    join public.profiles p on p.id = rr.id
  ) t;
  return v;
end; $$;
grant execute on function public.referral_leaderboard() to authenticated;


-- ============================================================================
-- ===== supabase/101_carry_referral_on_signup.sql =====
-- ============================================================================
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


-- ============================================================================
-- ===== supabase/102_function_search_path.sql =====
-- ============================================================================
-- 102_function_search_path.sql — Pin search_path on the functions the Supabase linter flagged as
-- `function_search_path_mutable` (lint 0011). Run after 101. Idempotent. A mutable search_path lets a
-- caller shadow built-in objects, so SECURITY DEFINER / trigger functions should always pin it. We resolve
-- each function's full signature via regprocedure so overloads and any arg types are handled automatically;
-- a name that doesn't exist is simply skipped (no error).

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'rate_limit_messages',
        'automod_check_message',
        'check_link_approval',
        'dept_code_for',
        'touch_live_session_attendance',
        'touch_application',
        'touch_service_request'
      )
  loop
    execute format('alter function %s set search_path = public', r.sig);
  end loop;
end $$;


-- ============================================================================
-- ===== supabase/103_lock_anon_execute.sql =====
-- ============================================================================
-- 103_lock_anon_execute.sql — Defense-in-depth: stop the `anon` role from invoking privileged
-- SECURITY DEFINER RPCs via /rest/v1/rpc (Supabase lint 0028 "Public Can Execute SECURITY DEFINER
-- Function"). Run after 102. Idempotent — safe to re-run.
--
-- ============================ SAFETY (verified before writing this) ============================
-- Every supabase.rpc() call site in the app was reviewed. This migration is built to be non-breaking:
--
--   1. TRIGGER functions are NEVER touched (prorettype = 'trigger'), so trigger firing — including
--      signup's handle_new_user, message rate-limiting, profile guards — is completely unaffected.
--
--   2. Functions used INSIDE RLS policies stay anon-callable: a grep of every migration shows the only
--      functions referenced in `using (...)` / `with check (...)` are is_admin(), is_founder(), and
--      is_feature_enabled(). If anon lost EXECUTE on those, anon reads on public tables (feature_flags,
--      published posts, etc.) would fail with "permission denied for function". They are in the allowlist.
--
--   3. The genuinely public RPCs — called by logged-out users on public pages, or by the anon-key
--      /api/apply route — stay anon-callable (allowlist).
--
--   4. For every OTHER SECURITY DEFINER function we `revoke ... from public, anon` (removing anonymous
--      access, including the default PUBLIC grant) and `grant ... to authenticated, service_role`. So
--      logged-in users, admins, and server-side (service-role) calls keep working EXACTLY as before —
--      only unauthenticated invocation is removed. Routes that forward a user's JWT run as `authenticated`
--      (not `anon`), so they are unaffected too. And these functions already self-guard with
--      is_admin()/is_founder()/auth.uid() checks, so the removed anon access was harmless to begin with.
--
--   5. Internal, definer-context calls (one function calling is_admin(), log_admin_action(), etc.) run as
--      the function OWNER, which always retains EXECUTE — unaffected by these role grants.
--
-- NOTE: this clears the `anon`-executable warnings. The `authenticated`-executable warnings are BY DESIGN
-- (admin/user RPCs must be callable by logged-in users) and are intentionally left in place.
-- ROLLBACK if ever needed: `grant execute on function public.<name>(<args>) to anon;`

do $$
declare
  r record;
  -- Must stay anon-callable: public RPCs (logged-out pages + anon-key /api/apply) and the RLS helpers.
  allow text[] := array[
    'get_public_stats', 'get_public_passport', 'get_engagement',
    'verify_certificate',
    'submit_service_request', 'subscribe', 'attribute_referral',
    'join_waitlist', 'join_waitlist_v2',
    'is_admin', 'is_founder', 'is_feature_enabled'
  ];
  n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace nsp on nsp.oid = p.pronamespace
    where nsp.nspname = 'public'
      and p.prosecdef                          -- SECURITY DEFINER only
      and p.prorettype <> 'trigger'::regtype   -- never touch trigger functions
      and not (p.proname = any(allow))         -- keep public RPCs + RLS helpers anon-callable
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    n := n + 1;
  end loop;
  raise notice 'lock_anon_execute: locked % security-definer function(s) to authenticated/service_role', n;
end $$;


-- ============================================================================
-- ===== supabase/104_signups_open_and_restore_handle_new_user.sql =====
-- ============================================================================
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


-- ============================================================================
-- ===== supabase/105_configurable_cohort_member_ids.sql =====
-- ============================================================================
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


-- ============================================================================
-- ===== supabase/106_referral_code_dept_alignment.sql =====
-- ============================================================================
-- 106_referral_code_dept_alignment.sql — Align referral-code department codes with member IDs. Run after
-- 105. Idempotent. Migration 100 built get_or_create_referral_code() with its own hardcoded dept mapping
-- (OFF/DEF/CLD/DFR) that didn't match the canonical dept_code_for() used for member IDs (OS/DS/CS/AIS/GRC/DF).
-- This redefines it to call dept_code_for() so both share ONE source of truth. Existing codes are never
-- regenerated (the function returns an already-set code), so only newly-minted codes change.
--
-- create-or-replace preserves the ACL set in migration 103 (anon/public revoked, authenticated granted).

create or replace function public.get_or_create_referral_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code     text;
  v_full     text; v_phone text; v_dom_key text;
  v_dept     text; v_namepart text; v_digits text; v_base text; v_cand text;
  v_tokens   text[]; v_i int := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select referral_code into v_code from public.profiles where id = auth.uid();
  if v_code is not null then return v_code; end if;  -- never regenerate an existing code

  select p.full_name, p.phone, d.key
    into v_full, v_phone, v_dom_key
    from public.profiles p left join public.domains d on d.id = p.domain_id
    where p.id = auth.uid();

  -- Same canonical department code as member IDs (OS/DS/CS/AIS/GRC/DF); 'ZDR' if the intern has no domain.
  v_dept := coalesce(public.dept_code_for(v_dom_key), 'ZDR');

  -- Name part: first-initial + last name, or just the first name when there's only one token.
  v_tokens := regexp_split_to_array(trim(regexp_replace(coalesce(v_full,''), '[^A-Za-z ]', '', 'g')), '\s+');
  if v_tokens is null or array_length(v_tokens,1) is null or coalesce(v_tokens[1],'') = '' then
    v_namepart := 'USER';
  elsif array_length(v_tokens,1) = 1 then
    v_namepart := upper(v_tokens[1]);
  else
    v_namepart := upper(substr(v_tokens[1],1,1) || v_tokens[array_length(v_tokens,1)]);
  end if;

  -- Last 3 phone digits (fallback: random 3 digits when there's no usable phone).
  v_digits := regexp_replace(coalesce(v_phone,''), '[^0-9]', '', 'g');
  if char_length(v_digits) >= 3 then v_digits := right(v_digits, 3);
  else v_digits := lpad((floor(random()*1000))::int::text, 3, '0'); end if;

  v_base := substr(upper(v_dept || v_namepart || v_digits), 1, 24);

  -- Guarantee uniqueness: append an incrementing number on the rare collision.
  v_cand := v_base;
  while exists (select 1 from public.profiles where referral_code = v_cand) loop
    v_i := v_i + 1;
    v_cand := v_base || v_i::text;
    if v_i > 50 then v_cand := lower(substr(replace(gen_random_uuid()::text,'-',''),1,8)); exit; end if;
  end loop;

  begin
    update public.profiles set referral_code = v_cand where id = auth.uid();
  exception when unique_violation then
    v_cand := v_base || upper(substr(replace(gen_random_uuid()::text,'-',''),1,3));
    update public.profiles set referral_code = v_cand where id = auth.uid();
  end;
  return v_cand;
end; $$;


-- ============================================================================
-- ===== supabase/107_fk_indexes_hot_tables.sql =====
-- ============================================================================
-- 107_fk_indexes_hot_tables.sql — Covering indexes for foreign keys on HOT tables (Supabase perf lint:
-- unindexed_foreign_keys). Run after 106. Idempotent.
--
-- SAFETY: an index NEVER changes query results, RLS, or access — it only speeds up joins and cascade
-- deletes. So this cannot affect Website, Portfolio, or Portal behavior; it only makes some Portal queries
-- (chat, DMs, mentions, submission files) and user-deletion faster. Every statement is `create index if
-- not exists`, so re-running is a no-op.
--
-- SCOPE: the advisor flagged 53 unindexed FKs. We deliberately index only the ~16 on frequently
-- joined/filtered hot tables — indexing the cold/admin-audit ones (admin_actions, app_settings,
-- feature_flags, opportunities, posts, risk_cases, resources, office hours, etc.) would add write overhead
-- for little gain and could just re-appear as "unused index" warnings. Tables here are small today, so a
-- plain (non-concurrent) build is instant.

-- Chat + reactions/hides (hottest tables) --------------------------------------------------------------
create index if not exists idx_messages_user_id            on public.messages (user_id);
create index if not exists idx_messages_reply_to           on public.messages (reply_to);
create index if not exists idx_message_reactions_user_id   on public.message_reactions (user_id);
create index if not exists idx_message_hides_message_id    on public.message_hides (message_id);
create index if not exists idx_message_reports_message_id  on public.message_reports (message_id);

-- Direct messages --------------------------------------------------------------------------------------
create index if not exists idx_dm_messages_sender_id       on public.dm_messages (sender_id);
create index if not exists idx_dm_messages_reply_to        on public.dm_messages (reply_to);
create index if not exists idx_dm_reactions_user_id        on public.dm_reactions (user_id);
create index if not exists idx_dm_message_hides_dm_msg_id  on public.dm_message_hides (dm_message_id);

-- @mentions (looked up per message) --------------------------------------------------------------------
create index if not exists idx_mentions_message_id         on public.mentions (message_id);
create index if not exists idx_mentions_author_id          on public.mentions (author_id);
create index if not exists idx_mentions_domain_id          on public.mentions (domain_id);

-- Submission files (version history + per-user lookups) ------------------------------------------------
create index if not exists idx_submission_files_submission on public.submission_files (submission_id);
create index if not exists idx_submission_files_user_id    on public.submission_files (user_id);

-- Profiles: referred_by drives the referral leaderboard join; domain_id drives roster/domain filtering.
create index if not exists idx_profiles_referred_by        on public.profiles (referred_by);
create index if not exists idx_profiles_domain_id          on public.profiles (domain_id);


-- ============================================================================
-- ===== supabase/108_week6_final_rubric.sql =====
-- ============================================================================
-- 108_week6_final_rubric.sql — Week 6 (Final Task) gets a bigger, weighted rubric and a video demo.
-- Run after 107 in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- The final week is graded on FIVE axes instead of four:
--   Completeness /10, Accuracy /10, Evidence /10, Report quality /20, Video demonstration /50 = /100.
-- Weeks 1–5 keep the original four-axis /40 rubric. The app keys the rubric off the WEEK number
-- (week = 6), so this applies to the final task of EVERY cohort automatically — no per-cohort setup.
--
-- Week 6 also takes TWO deliverables in one submission row: the PDF report (file_path, as always) and
-- a video link (video_url, new). Both are required before an approval is allowed.
--
-- DB-side the rubric ranges are widened permissively (report 0–20, new video 0–50); the app enforces
-- the exact per-week maximums. score_overall becomes the sum of all five axes: weeks 1–5 never set the
-- video axis, so their overall stays the /40 sum of four; week 6 sums to /100.

-- ========================= submissions: video link + video score =========================
alter table public.submissions add column if not exists video_url  text;
alter table public.submissions add column if not exists score_video numeric(5,2);

-- The generated overall depends on the axes, so drop it before widening the range / adding the axis.
alter table public.submissions drop column if exists score_overall;

alter table public.submissions drop constraint if exists submissions_scores_chk;
alter table public.submissions add constraint submissions_scores_chk check (
  (score_completeness is null or score_completeness between 0 and 10) and
  (score_accuracy     is null or score_accuracy     between 0 and 10) and
  (score_evidence     is null or score_evidence     between 0 and 10) and
  (score_report       is null or score_report       between 0 and 20) and
  (score_video        is null or score_video        between 0 and 50)
);

-- Overall = sum of all five axes; NULL until at least one axis is scored. Weeks 1–5 leave the video
-- axis NULL, so their overall is unchanged (the /40 sum of four); week 6 sums to /100.
alter table public.submissions add column score_overall numeric(5,2)
  generated always as (
    case
      when score_completeness is null and score_accuracy is null
       and score_evidence is null and score_report is null
       and score_video is null then null
      else coalesce(score_completeness, 0) + coalesce(score_accuracy, 0)
         + coalesce(score_evidence, 0) + coalesce(score_report, 0)
         + coalesce(score_video, 0)
    end
  ) stored;

-- protect_submission (extends 067): a non-admin write still re-queues the submission and wipes every
-- grade field — now including the new video axis. The student's own content (file_path, video_url,
-- note) is preserved; only the verdict/marks are cleared. Approved submissions stay locked.
create or replace function public.protect_submission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.status             := 'submitted';
    new.feedback           := null;
    new.graded_by          := null;
    new.graded_at          := null;
    new.score_completeness := null;
    new.score_accuracy     := null;
    new.score_evidence     := null;
    new.score_report       := null;
    new.score_video        := null;

    -- Approved is final: an approved submission can never be replaced by the intern (a founder can
    -- still reopen it from the Admin Panel by moving the status back to pending/rejected).
    if tg_op = 'UPDATE' and old.status = 'approved' then
      raise exception 'SUBMISSION_APPROVED_LOCKED: This week''s submission has been approved and can no longer be replaced.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists protect_submission_trg on public.submissions;
create trigger protect_submission_trg before insert or update on public.submissions
  for each row execute function public.protect_submission();

-- ========================= submission_files (history): mirror the new axis =========================
alter table public.submission_files add column if not exists score_video numeric(5,2);

alter table public.submission_files drop column if exists score_overall;

alter table public.submission_files drop constraint if exists submission_files_scores_check;
alter table public.submission_files add constraint submission_files_scores_check check (
  (score_completeness is null or score_completeness between 0 and 10) and
  (score_accuracy     is null or score_accuracy     between 0 and 10) and
  (score_evidence     is null or score_evidence     between 0 and 10) and
  (score_report       is null or score_report       between 0 and 20) and
  (score_video        is null or score_video        between 0 and 50)
);

alter table public.submission_files add column score_overall numeric(5,2)
  generated always as (
    case
      when score_completeness is null and score_accuracy is null
       and score_evidence is null and score_report is null
       and score_video is null then null
      else coalesce(score_completeness, 0) + coalesce(score_accuracy, 0)
         + coalesce(score_evidence, 0) + coalesce(score_report, 0)
         + coalesce(score_video, 0)
    end
  ) stored;

-- Students still can't forge marks on the history rows — extend the insert guard to the video axis.
drop policy if exists subfiles_insert on public.submission_files;
create policy subfiles_insert on public.submission_files
  for insert to authenticated with check (
    user_id = auth.uid()
    and status = 'submitted'
    and feedback is null and graded_by is null and graded_at is null
    and score_completeness is null and score_accuracy is null
    and score_evidence is null and score_report is null and score_video is null
  );

-- The grade snapshot (068) now also carries the video axis onto the latest history row.
create or replace function public.snapshot_submission_grade()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status not in ('approved', 'rejected') then return new; end if;

  update public.submission_files sf
  set status             = new.status,
      feedback           = new.feedback,
      graded_by          = new.graded_by,
      graded_at          = new.graded_at,
      score_completeness = new.score_completeness,
      score_accuracy     = new.score_accuracy,
      score_evidence     = new.score_evidence,
      score_report       = new.score_report,
      score_video        = new.score_video
  where sf.id = (
    select newest.id
    from public.submission_files newest
    where newest.task_id = new.task_id and newest.user_id = new.user_id
    order by newest.uploaded_at desc, newest.id desc
    limit 1
  );
  return new;
end; $$;

drop trigger if exists snapshot_submission_grade_trg on public.submissions;
create trigger snapshot_submission_grade_trg
  after update of status, feedback, graded_by, graded_at,
    score_completeness, score_accuracy, score_evidence, score_report, score_video
  on public.submissions
  for each row execute function public.snapshot_submission_grade();

-- ========================= bulk approve (019): don't approve an incomplete final task ==============
-- The grade modal already blocks approving a week-6 submission that is missing the PDF or the video
-- link; bulk-approve bypasses that modal, so guard it here too. Rather than aborting a whole mixed
-- batch, silently skip incomplete final-task rows (the returned count reflects what was approved).
create or replace function public.admin_bulk_approve_submissions(ids bigint[])
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.submissions s
    set status = 'approved', graded_by = auth.uid(), graded_at = now()
    where s.id = any(ids) and s.status is distinct from 'approved'
      and not exists (
        select 1 from public.tasks t
        where t.id = s.task_id and t.week = 6
          and (s.file_path is null or s.video_url is null or btrim(s.video_url) = '')
      );
  get diagnostics n = row_count;
  perform public.log_admin_action('bulk_approve_submissions', null, 'count=' || n);
  return n;
end $$;
grant execute on function public.admin_bulk_approve_submissions(bigint[]) to authenticated;

-- ========================= public passport (082): make totals week-6 aware =========================
-- Recompute the shared credential with per-week maximums so a /100 final task doesn't skew the overall
-- percentage or per-skill grip. Report is normalised back to a /10 basis for the competency tiles, and
-- a Video-demo tile is added (only the final task contributes to it).
create or replace function public.get_public_passport(p_token text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_uid uuid; p public.profiles; v_domain text; v_result jsonb;
begin
  if coalesce(p_token, '') = '' then return null; end if;
  select user_id into v_uid from public.passport_shares where token = p_token and is_public = true;
  if v_uid is null then return null; end if;
  select * into p from public.profiles where id = v_uid;
  if p.id is null then return null; end if;
  select name into v_domain from public.domains where id = p.domain_id;

  with subs as (
    select s.score_completeness c, s.score_accuracy a, s.score_evidence e, s.score_report r,
           s.score_video vid, s.score_overall o, s.graded_at, t.week, t.title,
           case when t.week = 6 then 100 else 40 end as maxo,
           case when t.week = 6 then 20  else 10 end as maxr,
           coalesce(nullif(t.skills, '{}'::text[]), array[coalesce(v_domain, 'General')]) as skills
    from public.submissions s
    join public.tasks t on t.id = s.task_id
    where s.user_id = p.id and s.status = 'approved' and s.graded_at is not null
  ),
  axes as (
    select jsonb_build_array(
      jsonb_build_object('key','completeness','label','Completeness','value', round(avg(c)::numeric, 1)),
      jsonb_build_object('key','accuracy',    'label','Accuracy',    'value', round(avg(a)::numeric, 1)),
      jsonb_build_object('key','evidence',    'label','Evidence',    'value', round(avg(e)::numeric, 1)),
      jsonb_build_object('key','report',      'label','Reporting',   'value', round(avg(r / maxr * 10)::numeric, 1)),
      jsonb_build_object('key','video',       'label','Video demo',  'value', round(avg(vid / 50.0 * 10)::numeric, 1))
    ) j, count(o) n, round(avg(o / maxo * 100)) overall_pct from subs
  ),
  skills as (
    select sk as skill, round(avg(o / maxo * 100)) pct, count(o) n
    from subs, unnest(subs.skills) sk
    group by sk
  ),
  skills_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'skill', skill, 'pct', pct, 'tasks', n,
      'level', case when pct >= 80 then 'Advanced' when pct >= 60 then 'Proficient' else 'Novice' end
    ) order by pct desc nulls last), '[]'::jsonb) j from skills
  ),
  tasks_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'week', week, 'title', title, 'score', round(o::numeric, 1), 'max', maxo, 'graded_at', graded_at
    ) order by week), '[]'::jsonb) j from subs
  )
  select jsonb_build_object(
    'name',         coalesce(p.full_name, p.display_name, 'Intern'),
    'display_name', p.display_name,
    'member_id',    p.member_id,
    'domain',       v_domain,
    'overall_pct',  (select overall_pct from axes),
    'count',        (select n from axes),
    'axes',         (select j from axes),
    'skills',       (select j from skills_json),
    'tasks',        (select j from tasks_json),
    'issued_at',    p.created_at,
    'verified',     true
  ) into v_result;
  return v_result;
end; $$;
grant execute on function public.get_public_passport(text) to anon, authenticated;


-- ============================================================================
-- ===== supabase/109_cohort_data_retention.sql =====
-- ============================================================================
-- 109_cohort_data_retention.sql — Cohort data-retention cleanup (founder-run, reusable). Idempotent.
--
-- Policy (Cohort 1): once every cohort member is an Alumni, keep their data 15 more days, then:
--   • DELETE their submitted WORK  — strip file_path/file_name/note on submissions + submission_files
--     and clear extracted submission_text; the actual R2 objects are removed by the API route.
--   • KEEP all grade data (status, feedback, score_*) so the Competency Matrix, Skill Passport and
--     certificate stay intact per-cohort after graduation.
--   • DELETE their group (domain) chat messages + the attachments they uploaded (R2 chat/{uid}/, via the route).
--   • DELETE their documents rows (resume/other); R2 objects removed by the route.
--   • KEEP their profile row and their DM thread with admins/founder — untouched.
--
-- Target set = non-admin, is_alumni = true, created_at < p_signup_before (so a later cohort whose
-- members auto-graduate on 6 approved tasks is never caught). Reusable: pass the next cohort's cutoff.

-- ========================= 1) alumni_at timestamp (graduation anchor) =========================
-- No graduation time was recorded before; add one and stamp it whenever is_alumni flips to true.
alter table public.profiles add column if not exists alumni_at timestamptz;

create or replace function public.stamp_alumni_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.is_alumni is distinct from old.is_alumni then
    new.alumni_at := case when new.is_alumni then coalesce(new.alumni_at, now()) else null end;
  end if;
  return new;
end; $$;

drop trigger if exists stamp_alumni_at_trg on public.profiles;
create trigger stamp_alumni_at_trg
  before update of is_alumni on public.profiles
  for each row execute function public.stamp_alumni_at();

-- Backfill already-graduated members (e.g. Cohort 1) at apply time. For a precise Cohort-1 anchor,
-- pass p_anchor explicitly to the cleanup function instead of relying on this backfill timestamp.
update public.profiles set alumni_at = now() where is_alumni = true and alumni_at is null;

-- ========================= 2) allow stripping version-history file refs =========================
-- submission_files.file_path is NOT NULL; retention needs to clear it while keeping the grade row.
alter table public.submission_files alter column file_path drop not null;

-- ========================= 3) the cleanup function (founder-only) =========================
create or replace function public.cleanup_cohort_intern_data(
  p_signup_before timestamptz,              -- cohort cutoff: target = non-admin alumni who signed up before this
  p_retain_days   int        default 15,    -- days to keep after the LAST member graduates
  p_dry_run       boolean    default true,  -- true = report only, make no changes
  p_anchor        timestamptz default null  -- override graduation anchor; default = max(alumni_at) of target set
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_is_founder  boolean;
  v_targets     uuid[];
  v_count       int;
  v_ungrad      int;
  v_anchor      timestamptz;
  v_eligible_at timestamptz;
  v_subs        int;
  v_subfiles    int;
  v_msgs        int;
  v_docs        int;
  v_result      jsonb;
begin
  -- Founder only.
  select is_founder into v_is_founder from public.profiles where id = auth.uid();
  if not coalesce(v_is_founder, false) then
    raise exception 'Only a founder may run cohort data retention cleanup.';
  end if;

  if p_signup_before is null then
    raise exception 'p_signup_before (cohort signup cutoff) is required.';
  end if;
  if p_retain_days is null or p_retain_days < 0 then
    raise exception 'p_retain_days must be >= 0.';
  end if;

  -- Readiness gate: no cohort member may still be a non-alumni intern.
  select count(*) into v_ungrad
  from public.profiles
  where role <> 'admin' and created_at < p_signup_before and is_alumni = false;
  if v_ungrad > 0 then
    raise exception 'Cohort not fully graduated: % member(s) still active (is_alumni = false).', v_ungrad;
  end if;

  -- Target set: graduated, non-admin, signed up before the cutoff.
  select array_agg(id) into v_targets
  from public.profiles
  where role <> 'admin' and is_alumni = true and created_at < p_signup_before;
  v_count := coalesce(array_length(v_targets, 1), 0);

  if v_count = 0 then
    return jsonb_build_object('ok', true, 'targets', 0, 'note', 'No matching cohort members; nothing to do.');
  end if;

  -- Retention anchor (= last graduation, or explicit override). Reported always; the 15-day window
  -- is ENFORCED only on a real run below, so a dry run can preview the plan at any time.
  v_anchor := coalesce(
    p_anchor,
    (select max(alumni_at) from public.profiles
      where role <> 'admin' and is_alumni = true and created_at < p_signup_before)
  );
  if v_anchor is not null then
    v_eligible_at := v_anchor + ((p_retain_days::text) || ' days')::interval;
  end if;

  -- What will be affected (valid for both the dry run and the real run that follows it).
  select count(*) into v_subs     from public.submissions     where user_id = any(v_targets);
  select count(*) into v_subfiles from public.submission_files where user_id = any(v_targets);
  select count(*) into v_msgs     from public.messages        where user_id = any(v_targets);
  select count(*) into v_docs     from public.documents       where user_id = any(v_targets);

  v_result := jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'targets', v_count,
    'target_ids', to_jsonb(v_targets),
    'anchor', v_anchor,
    'eligible_at', v_eligible_at,
    'window_elapsed', (v_eligible_at is not null and now() >= v_eligible_at),
    'submissions_stripped', v_subs,
    'submission_files_stripped', v_subfiles,
    'group_messages_deleted', v_msgs,
    'documents_deleted', v_docs
  );

  if p_dry_run then
    return v_result || jsonb_build_object('note', 'DRY RUN — no changes made.');
  end if;

  -- Real run: now enforce the graduation anchor and the 15-day retention window.
  if v_anchor is null then
    raise exception 'Cannot determine graduation anchor (alumni_at is null); pass p_anchor explicitly.';
  end if;
  if now() < v_eligible_at then
    raise exception 'Retention window not elapsed. Eligible at % (anchor % + % days).',
      v_eligible_at, v_anchor, p_retain_days;
  end if;

  -- ===================== DESTRUCTIVE (grades kept; work removed) =====================
  -- Strip submitted work + student free-text from the latest-pointer rows (keep grade columns).
  update public.submissions
     set file_path = null, file_name = null, note = null
   where user_id = any(v_targets);

  -- Strip version-history file refs (keep status/feedback/score_* → Competency Matrix & Passport).
  update public.submission_files
     set file_path = null, file_name = null
   where user_id = any(v_targets);

  -- Clear extracted submission text used for similarity (it is a copy of their submitted work).
  if to_regclass('public.submission_text') is not null then
    delete from public.submission_text st
     using public.submissions s
     where st.submission_id = s.id and s.user_id = any(v_targets);
  end if;

  -- Delete group (domain) chat messages authored by cohort members.
  delete from public.messages where user_id = any(v_targets);

  -- Delete documents (resume/other) rows; R2 objects removed by the caller.
  delete from public.documents where user_id = any(v_targets);

  -- Intentionally untouched: dm_messages, profiles, and all grade/score/feedback columns.
  return v_result || jsonb_build_object('note', 'Cleanup applied.');
end; $$;

-- Lock down execution: founder check is inside the function; never expose to anon.
revoke all on function public.cleanup_cohort_intern_data(timestamptz, int, boolean, timestamptz) from public;
revoke all on function public.cleanup_cohort_intern_data(timestamptz, int, boolean, timestamptz) from anon;
grant execute on function public.cleanup_cohort_intern_data(timestamptz, int, boolean, timestamptz) to authenticated;


-- ============================================================================
-- ===== supabase/110_public_profiles_best_intern.sql =====
-- ============================================================================
-- 110_public_profiles_best_intern.sql — expose is_best_intern on the public_profiles view so the chat
-- roster (and any other reader of the safe view) can highlight Best Interns. Run after 045. Idempotent.
--
-- Keeps 045's exact column order and appends is_best_intern at the end, so `create or replace` is valid
-- (no DROP ... CASCADE needed) and every existing caller — which selects named columns or * — keeps working.
create or replace view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, is_alumni, ram, country, member_id,
         linkedin_url, github_url, is_best_intern
  from public.profiles;

grant select on public.public_profiles to authenticated;


-- ============================================================================
-- ===== supabase/111_renumber_cohort1_member_ids.sql =====
-- ============================================================================
-- 111_renumber_cohort1_member_ids.sql — Re-sequence the Cohort-1 graduates' member IDs so each
-- department runs contiguously from 001, closing the gaps left by interns who didn't graduate.
--
-- Decisions (set by the founder):
--   • Scope:   the 25 graduated interns = profiles where role='student' AND is_alumni=true
--              AND member_id IS NOT NULL (admins/founder have no member_id, so they're excluded).
--   • Order:   within each department, BY SIGNUP DATE (created_at asc) → earliest = 001.
--   • Format:  KEEP EACH ID'S EXISTING PREFIX, renumber only the trailing -NNN (3-digit, zero-padded).
--              i.e. 'ZDR-2026-Cohort1-OS-017' → 'ZDR-2026-Cohort1-OS-003'; the year/cohort/dept
--              prefix is preserved exactly as that row currently has it.
--   • Grouping: per department, resolved from domain_id (public.dept_code_for(domains.key)), which is
--              authoritative; only the trailing number is derived here.
--
-- Safety notes:
--   • member_id is a DISPLAY/identity field only — it is NOT a foreign key anywhere (all joins use the
--     uuid id), so renumbering has no referential side-effects. Certificates (data/certificates.json,
--     e.g. ZDR-2026-OS-0001) are a SEPARATE namespace and are not touched.
--   • profiles has a partial unique index on member_id, so the apply step renumbers in two phases inside
--     one transaction (vacate the namespace to temp values, then assign finals) to avoid any transient
--     unique-index collision, and aborts before COMMIT if any duplicate slips through.
--   • RUN THIS IN THE SUPABASE SQL EDITOR (postgres/service role). There, auth.uid() is NULL, so the
--     protect_profile_columns trigger early-returns and allows the system-managed member_id to change.
--     Do NOT run it through the app (an end-user/admin session is blocked from editing member_id).
--   • member_id_seq is intentionally left untouched: its cohort-1 counters already sit at/above the old
--     max, so any (unlikely) future cohort-1 signup still lands above every renumbered ID — no collision.
--     Cohort 2+ uses its own per-cohort counter. (To hard-reset counters later, use the founder's
--     reset_member_id_counters tool.)
--
-- HOW TO USE: run STEP 1 alone first and eyeball the old→new mapping and the count (should be 25).
-- Only when it looks right, run STEP 2.

-- ============================================================================================
-- STEP 1 — PREVIEW (read-only; changes nothing). Run this block by itself first.
-- ============================================================================================
with targets as (
  select p.id,
         p.member_id                              as old_member_id,
         p.created_at,
         public.dept_code_for(d.key)              as dept_code,
         regexp_replace(p.member_id, '-[0-9]+$', '') as id_prefix
  from public.profiles p
  join public.domains d on d.id = p.domain_id
  where p.role = 'student'
    and p.is_alumni = true
    and p.member_id is not null
    and public.dept_code_for(d.key) is not null
),
ranked as (
  select *,
         row_number() over (partition by dept_code order by created_at asc, id asc) as rn
  from targets
)
select dept_code,
       rn                                                   as new_number,
       old_member_id,
       id_prefix || '-' || lpad(rn::text, 3, '0')           as new_member_id,
       (old_member_id <> id_prefix || '-' || lpad(rn::text, 3, '0')) as changes,
       created_at
from ranked
order by dept_code, rn;

-- Count sanity check (expect 25):
-- select count(*) as graduates
--   from public.profiles p join public.domains d on d.id = p.domain_id
--  where p.role='student' and p.is_alumni=true and p.member_id is not null
--    and public.dept_code_for(d.key) is not null;

-- ============================================================================================
-- STEP 2 — APPLY (transactional). Run only after STEP 1 looks correct.
-- ============================================================================================
begin;

create temp table _renumber_map on commit drop as
with targets as (
  select p.id,
         p.member_id                              as old_member_id,
         p.created_at,
         public.dept_code_for(d.key)              as dept_code,
         regexp_replace(p.member_id, '-[0-9]+$', '') as id_prefix
  from public.profiles p
  join public.domains d on d.id = p.domain_id
  where p.role = 'student'
    and p.is_alumni = true
    and p.member_id is not null
    and public.dept_code_for(d.key) is not null
)
select id,
       old_member_id,
       dept_code,
       id_prefix || '-' ||
         lpad(row_number() over (partition by dept_code order by created_at asc, id asc)::text, 3, '0')
         as new_member_id
from targets;

-- Phase 1: vacate the member_id namespace (unique, non-colliding temp values).
update public.profiles p
   set member_id = '__RENUM_' || p.id::text
  from _renumber_map m
 where p.id = m.id;

-- Phase 2: assign the final, contiguous per-department numbers.
update public.profiles p
   set member_id = m.new_member_id
  from _renumber_map m
 where p.id = m.id;

-- Abort if anything produced a duplicate member_id before we commit.
do $$
declare dups int;
begin
  select count(*) into dups
    from (
      select member_id
        from public.profiles
       where member_id is not null
       group by member_id
      having count(*) > 1
    ) x;
  if dups > 0 then
    raise exception 'Aborting renumber: % duplicate member_id(s) detected', dups;
  end if;
end $$;

commit;

-- Post-check (run after commit): list the renumbered IDs per department.
-- select public.dept_code_for(d.key) as dept, p.member_id, p.display_name, p.created_at
--   from public.profiles p join public.domains d on d.id = p.domain_id
--  where p.role='student' and p.is_alumni=true and p.member_id is not null
--  order by dept, p.member_id;


-- ============================================================================
-- ===== supabase/112_certificates_registry.sql =====
-- ============================================================================
-- 112_certificates_registry.sql — Move the public credential registry from the static
-- data/certificates.json into the database, so /verify resolves live and the portal can
-- publish new certificates at runtime (Vercel's filesystem is read-only, so a static file
-- can't be written from the app). Run after 111. Idempotent.
--
-- Read path mirrors the Skill Passport: a logged-out /verify page calls the anon-callable
-- SECURITY DEFINER RPC verify_certificate() (added to 103's allowlist). The table itself has
-- RLS on with NO anon/authenticated policy, so the whole registry can't be enumerated over
-- REST — a verifier must know the exact certificate ID (as printed / in the QR deep link).
-- Lookup is case-insensitive because canonical IDs contain mixed case ("Cohort1").

-- ---- (1) registry table ----
create table if not exists public.certificates (
  id         text primary key,                       -- canonical ID = the intern's member_id
  name       text not null,                           -- full legal name shown as "Awarded To"
  type       text not null,                           -- 'Completion Certificate' | 'Best Intern'
  department text,
  cohort     int,
  issued     date,                                    -- publish date
  period     text,                                    -- program period, e.g. "01 August 2026 – 30 September 2026"
  created_at timestamptz not null default now()
);

alter table public.certificates enable row level security;
-- No SELECT policy on purpose: reads go only through verify_certificate() below (no bulk harvest).

-- ---- (2) public, by-exact-id lookup (no enumeration) ----
create or replace function public.verify_certificate(p_id text)
returns public.certificates
language sql
stable
security definer
set search_path = public
as $$
  select * from public.certificates
   where lower(id) = lower(btrim(p_id))
   limit 1;
$$;

revoke execute on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated, service_role;

-- ---- (3) seed the 25 Cohort-1 graduates (idempotent) ----
insert into public.certificates (id, name, type, department, cohort, issued, period) values
  ('ZDR-2026-Cohort1-AIS-001', 'Muhammad Bilal Zeeshan',                'Best Intern',            'AI Security',                   1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-AIS-002', 'Taha Amanat',                           'Completion Certificate', 'AI Security',                   1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-CS-001',  'Busari Mutairu Afolabi',                'Best Intern',            'Cloud Security',                1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-CS-002',  'Shahzeen Shahbaz',                      'Best Intern',            'Cloud Security',                1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-CS-003',  'Irha Batool',                           'Best Intern',            'Cloud Security',                1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-CS-004',  'Muneeb Ahmed',                          'Completion Certificate', 'Cloud Security',                1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DF-001',  'Muhammad Faisal Kamran',                'Completion Certificate', 'Digital Forensics',             1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DF-002',  'Tasneem Monir',                         'Best Intern',            'Digital Forensics',             1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DS-001',  'Ahmed Ayman Abdelhalim Moustafa Ahmed', 'Best Intern',            'Defensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DS-002',  'Uzma Bibi',                             'Completion Certificate', 'Defensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DS-003',  'Sawera Zeb',                            'Best Intern',            'Defensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DS-004',  'Tehzeeb Kousar',                        'Best Intern',            'Defensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DS-005',  'Yell Mahn Oo',                          'Completion Certificate', 'Defensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DS-006',  'Sara Irshad',                           'Completion Certificate', 'Defensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DS-007',  'MBODO MBOULANA Lucie-Astride-Lucresse', 'Completion Certificate', 'Defensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-GRC-001', 'Halima Khan',                           'Best Intern',            'Governance, Risk & Compliance', 1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-GRC-002', 'Zamarak Bashari',                       'Completion Certificate', 'Governance, Risk & Compliance', 1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-GRC-003', 'Moiz Ahmed',                            'Best Intern',            'Governance, Risk & Compliance', 1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-GRC-004', 'Abdullah Zubair',                       'Best Intern',            'Governance, Risk & Compliance', 1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-GRC-005', 'Owais Ahmed',                           'Completion Certificate', 'Governance, Risk & Compliance', 1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-OS-001',  'Muhib Saleem',                          'Completion Certificate', 'Offensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-OS-002',  'Mir Nasir Hassan',                      'Best Intern',            'Offensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-OS-003',  'Muhammad Mubshar Sultan',               'Completion Certificate', 'Offensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-OS-004',  'Rabiya Masood',                         'Best Intern',            'Offensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-OS-005',  'Ali Hassan Pervaiz',                    'Best Intern',            'Offensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026')
on conflict (id) do update
  set name = excluded.name,
      type = excluded.type,
      department = excluded.department,
      cohort = excluded.cohort,
      issued = excluded.issued,
      period = excluded.period;

-- ---- (4) correct two source profile names (capitalisation fixes) so full_name is consistent
--          everywhere it's used (offer letter, portfolio, future one-click auto-fill). Idempotent;
--          matches 0 rows in CI/test DBs. Runs as the SQL editor (auth.uid() null) so the
--          protect_profile_columns trigger allows it. ----
update public.profiles set full_name = 'Muhammad Mubshar Sultan'
 where member_id = 'ZDR-2026-Cohort1-OS-003' and full_name is distinct from 'Muhammad Mubshar Sultan';
update public.profiles set full_name = 'Uzma Bibi'
 where member_id = 'ZDR-2026-Cohort1-DS-002' and full_name is distinct from 'Uzma Bibi';


-- ============================================================================
-- ===== supabase/113_certificate_automation.sql =====
-- ============================================================================
-- 113_certificate_automation.sql — Phase 2 data layer for one-click, in-portal certificate issuing.
-- Run after 112 in the Supabase SQL Editor. Idempotent.
--
-- Three founder/admin RPCs (all SECURITY DEFINER, is_admin()-gated):
--   1. admin_set_task_skills(task, skills[]) — populate tasks.skills so the LOR can list the real
--      skills exercised across the 6 tasks (the column exists since 082 but nothing wrote to it).
--   2. admin_certificate_data(user) — the "verify before publishing" payload: recomputes everything a
--      certificate / LOR needs from APPROVED, rubric-graded submissions (same engine as the public
--      Skill Passport, 108), plus department Best-Intern RANK, a STANDOUT (top-scoring task), and the
--      aggregated key SKILLS. Nothing here can be forged client-side.
--   3. admin_publish_certificate(...) — upsert one row into public.certificates (112) so /verify
--      resolves the moment an admin clicks Publish.
--
-- These are created after 103 and are not anon RPCs; 103's revoke-from-anon / grant-to-authenticated
-- pattern already fits them, so a future re-run of 103 leaves them callable by logged-in admins.

-- ============================ 1) tag a task's skills ============================
create or replace function public.admin_set_task_skills(p_task_id bigint, p_skills text[])
returns public.tasks
language plpgsql security definer set search_path = public as $$
declare v_row public.tasks;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.tasks
     set skills = (
       select array_agg(btrim(x)) from unnest(coalesce(p_skills, '{}'::text[])) x where btrim(x) <> ''
     )
   where id = p_task_id
  returning * into v_row;
  if v_row.id is null then raise exception 'task % not found', p_task_id; end if;
  perform public.log_admin_action('set_task_skills', null, 'task=' || p_task_id);
  return v_row;
end $$;
grant execute on function public.admin_set_task_skills(bigint, text[]) to authenticated;

-- ============================ 2) verified certificate data ============================
-- Returns null for an unknown user. Scores come only from status='approved' + graded_at not null, so
-- an ungraded cohort yields null overall / empty standout (the UI then prompts to grade first).
create or replace function public.admin_certificate_data(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  p public.profiles; v_domain text; v_cohort int;
  v_rank int; v_rank_total int; v_result jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into p from public.profiles where id = p_user_id;
  if p.id is null then return null; end if;
  select name into v_domain from public.domains where id = p.domain_id;
  v_cohort := coalesce((regexp_match(coalesce(p.member_id, ''), 'Cohort([0-9]+)'))[1]::int, 1);

  -- Rank among this department's Best Interns, by mean overall percentage (week-6 aware). rank() so
  -- ties share a place; rank_total = how many Best Interns the department has.
  with best as (
    select pr.id,
           avg(s.score_overall / (case when t.week = 6 then 100.0 else 40.0 end)) as score
    from public.profiles pr
    join public.submissions s on s.user_id = pr.id and s.status = 'approved' and s.graded_at is not null
    join public.tasks t on t.id = s.task_id
    where pr.is_best_intern = true and pr.domain_id = p.domain_id
    group by pr.id
  ),
  ranked as (
    select id, rank() over (order by score desc nulls last) rnk, count(*) over () total from best
  )
  select rnk, total into v_rank, v_rank_total from ranked where id = p.id;

  with subs as (
    select s.score_completeness c, s.score_accuracy a, s.score_evidence e, s.score_report r,
           s.score_video vid, s.score_overall o, s.graded_at, t.week, t.title,
           case when t.week = 6 then 100 else 40 end as maxo,
           case when t.week = 6 then 20  else 10 end as maxr,
           coalesce(nullif(t.skills, '{}'::text[]), array[coalesce(v_domain, 'General')]) as skills
    from public.submissions s
    join public.tasks t on t.id = s.task_id
    where s.user_id = p.id and s.status = 'approved' and s.graded_at is not null
  ),
  axes as (
    select jsonb_build_array(
      jsonb_build_object('key','completeness','label','Completeness','value', round(avg(c)::numeric, 1)),
      jsonb_build_object('key','accuracy',    'label','Accuracy',    'value', round(avg(a)::numeric, 1)),
      jsonb_build_object('key','evidence',    'label','Evidence',    'value', round(avg(e)::numeric, 1)),
      jsonb_build_object('key','report',      'label','Reporting',   'value', round(avg(r::numeric / maxr * 10), 1)),
      jsonb_build_object('key','video',       'label','Video demo',  'value', round(avg(vid / 50.0 * 10)::numeric, 1))
    ) j, count(o) n, round(avg(o / maxo * 100)) overall_pct from subs
  ),
  skills as (
    select sk as skill, round(avg(o / maxo * 100)) pct, count(o) n
    from subs, unnest(subs.skills) sk
    group by sk
  ),
  skills_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'skill', skill, 'pct', pct, 'tasks', n,
      'level', case when pct >= 80 then 'Advanced' when pct >= 60 then 'Proficient' else 'Novice' end
    ) order by pct desc nulls last), '[]'::jsonb) j from skills
  ),
  tasks_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'week', week, 'title', title, 'score', round(o::numeric, 1), 'max', maxo,
      'pct', round(o / maxo * 100), 'graded_at', graded_at
    ) order by week), '[]'::jsonb) j from subs
  ),
  standout as (
    select jsonb_build_object('title', title, 'pct', round(o / maxo * 100), 'week', week) j
    from subs order by (o / maxo) desc nulls last, week limit 1
  )
  select jsonb_build_object(
    'user_id',        p.id,
    'name',           coalesce(p.full_name, p.display_name, 'Intern'),
    'display_name',   p.display_name,
    'member_id',      p.member_id,
    'department',     v_domain,
    'cohort',         v_cohort,
    'is_best_intern', coalesce(p.is_best_intern, false),
    'is_alumni',      coalesce(p.is_alumni, false),
    'suggested_type', case when coalesce(p.is_best_intern, false) then 'Best Intern' else 'Completion Certificate' end,
    'overall_pct',    (select overall_pct from axes),
    'count',          (select n from axes),
    'axes',           (select j from axes),
    'skills',         (select j from skills_json),
    'tasks',          (select j from tasks_json),
    'standout',       (select j from standout),
    'rank',           v_rank,
    'rank_total',     v_rank_total
  ) into v_result;
  return v_result;
end $$;
grant execute on function public.admin_certificate_data(uuid) to authenticated;

-- ============================ 3) publish to the verify registry ============================
create or replace function public.admin_publish_certificate(
  p_id text, p_name text, p_type text, p_department text, p_cohort int, p_issued date, p_period text)
returns public.certificates
language plpgsql security definer set search_path = public as $$
declare v_row public.certificates;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if coalesce(btrim(p_id), '')   = '' then raise exception 'certificate id required'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'name required'; end if;
  insert into public.certificates (id, name, type, department, cohort, issued, period)
  values (
    btrim(p_id), btrim(p_name),
    coalesce(nullif(btrim(p_type), ''), 'Completion Certificate'),
    nullif(btrim(p_department), ''), p_cohort,
    coalesce(p_issued, current_date), nullif(btrim(p_period), '')
  )
  on conflict (id) do update set
    name = excluded.name, type = excluded.type, department = excluded.department,
    cohort = excluded.cohort, issued = excluded.issued, period = excluded.period
  returning * into v_row;
  perform public.log_admin_action('publish_certificate', null, v_row.id);
  return v_row;
end $$;
grant execute on function public.admin_publish_certificate(text, text, text, text, int, date, text) to authenticated;


-- ============================================================================
-- ===== supabase/114_seed_task_skills.sql =====
-- ============================================================================
-- 114_seed_task_skills.sql — Seed tasks.skills for all 6 departments × 6 weeks from the official
-- "Internship Certificate Skills" sheet (6 certificate-ready skills per week, taken from each week's
-- task). This is the data behind the LOR's auto-filled "key skills": admin_certificate_data (113)
-- aggregates these across an intern's approved tasks and ranks them by score, and the studio then
-- takes the strongest 6–10. Run after 113. Idempotent (re-running re-sets the same arrays).
--
-- Matched by department key + week, so it is tier-agnostic (8/16/24 GB share one task per week) and a
-- no-op in CI/test DBs that have no cohort tasks. Admins can still re-tag any task via
-- admin_set_task_skills().

with sk(dept, wk, skills) as (
  values
    -- ===== 1 · Offensive Security =====
    ('offensive', 1, array[
      'SQL injection: login bypass and UNION-based data extraction',
      'Cross-site scripting (stored and reflected)',
      'Web reconnaissance and enumeration (nmap, ffuf, gobuster, Burp Suite)',
      'Linux privilege escalation (linPEAS; SUID / sudo / cron abuse)',
      'Network pivoting and tunneling (Chisel, proxychains)',
      'Professional penetration-test report writing']),
    ('offensive', 2, array[
      'Multi-segment network pivoting across isolated subnets',
      'Tunneling with Chisel and Ligolo-ng',
      'Dual-homed host exploitation and reverse-shell footholds',
      'Internal service and database compromise through a tunnel',
      'Network topology mapping and diagramming',
      'Engagement reporting with a full kill chain']),
    ('offensive', 3, array[
      'Active Directory enumeration with BloodHound / SharpHound',
      'Kerberos attacks: AS-REP roasting and Kerberoasting (hashcat)',
      'ACL abuse for privilege escalation',
      'Kerberos delegation abuse (unconstrained, constrained, RBCD)',
      'AD CS certificate attacks (ESC1 / ESC8 with Certipy)',
      'DCSync and Golden Ticket forgery (impacket, mimikatz)']),
    ('offensive', 4, array[
      'MITRE ATT&CK emulation with Atomic Red Team',
      'Sysmon telemetry analysis',
      'Detection engineering (Sigma rules, PowerShell)',
      'Endpoint threat hunting',
      'ATT&CK Navigator coverage mapping',
      'Purple-team reporting']),
    ('offensive', 5, array[
      'Secret detection in git history (Gitleaks, TruffleHog)',
      'SAST, dependency and IaC scanning (Semgrep, Trivy)',
      'Vulnerability aggregation and triage (DefectDojo)',
      'CI/CD security gating (GitLab CI, OWASP ZAP baseline DAST)',
      'Finding deduplication and severity triage',
      'Shift-left secure-pipeline design']),
    ('offensive', 6, array[
      'End-to-end boot-to-root exploitation',
      'Full-port service enumeration (nmap, nikto, ffuf)',
      'Initial access via web / service exploitation',
      'Privilege escalation to root (GTFOBins, cron, kernel exploits)',
      'Flag capture (user.txt / root.txt) with evidence',
      'Engagement report plus narrated video walkthrough']),
    -- ===== 2 · Defensive Security =====
    ('defensive', 1, array[
      'Threat hunting with Chainsaw and Sigma',
      'Windows event-log analysis and timelining (EvtxECmd)',
      'SIEM operations with Splunk (SPL queries)',
      'Multi-source incident correlation (endpoint, AWS, email)',
      'MITRE ATT&CK technique mapping',
      'Incident report writing (root cause, scope, remediation)']),
    ('defensive', 2, array[
      'Building an isolated malware-analysis lab (REMnux / FLARE-VM)',
      'Static analysis (strings/floss, PE inspection, capa, olevba)',
      'Dynamic analysis / safe detonation with INetSim',
      'YARA signature scanning',
      'IOC extraction (hashes, C2, persistence)',
      'ATT&CK mapping and analyst reporting']),
    ('defensive', 3, array[
      'Network traffic analysis with Zeek',
      'Log pivoting with zeek-cut and jq',
      'Attack reconstruction from NSM logs',
      'IOC extraction (JA3, certificates, file hashes)',
      'Custom Zeek detection scripting (NOTICE / signatures)',
      'ATT&CK mapping and incident narrative']),
    ('defensive', 4, array[
      'Endpoint DFIR with Velociraptor',
      'Fleet-wide threat hunting (Hunt Manager)',
      'Custom VQL query authoring',
      'Persistence-mechanism detection',
      'Cross-endpoint correlation and ATT&CK mapping',
      'Triage collection (KAPE)']),
    ('defensive', 5, array[
      'Honeypot deployment (Cowrie, Dionaea, T-Pot)',
      'Attacker-session reconstruction from honeypot logs',
      'Multi-protocol attack correlation',
      'Captured-malware triage and hashing',
      'Threat-intel / IOC extraction with Kibana dashboards',
      'ATT&CK mapping of the campaign']),
    ('defensive', 6, array[
      'Super-timeline forensics with Plaso / log2timeline',
      'Artifact parsing (MFTECmd, EvtxECmd, RECmd)',
      'Pinpointing the moment of compromise',
      'Tracing the attacker action chain',
      'IOC and ATT&CK extraction',
      'Chronological intrusion narrative plus narrated video']),
    -- ===== 3 · AI Security =====
    ('ai', 1, array[
      'Prompt injection (direct and indirect)',
      'System-prompt extraction',
      'Building a local LLM / RAG app (Ollama, LangChain, Chroma)',
      'RAG document poisoning and tool abuse',
      'Guardrail implementation (LLM Guard, NeMo Guardrails)',
      'Defense block-rate measurement']),
    ('ai', 2, array[
      'Training a CNN classifier (MNIST / Fashion-MNIST)',
      'Evasion attacks (FGSM, PGD with ART / torchattacks)',
      'Data-poisoning attacks (label-flip, trigger patch)',
      'Adversarial-training defense',
      'Robustness measurement (accuracy vs. epsilon)',
      'Results visualization and reporting']),
    ('ai', 3, array[
      'Building a private offline RAG assistant (Ollama + embeddings + Chroma)',
      'Indirect prompt injection via document poisoning',
      'Retrieval-path exploitation (answer manipulation, data exfiltration)',
      'Attack-success-rate measurement',
      'Layered RAG defenses (context spotlighting, provenance, output filtering)',
      'Before/after block-rate evaluation']),
    ('ai', 4, array[
      'Analyzing malicious model files (pickle, PyTorch, Keras)',
      'Model scanning (modelscan, picklescan)',
      'Pickle decompilation and opcode analysis (fickling, pickletools)',
      'Multi-format threat comparison matrix',
      'Serialization-risk mitigation',
      'Security-research reporting']),
    ('ai', 5, array[
      'Web LLM exploitation (PortSwigger Web LLM labs)',
      'LLM API and tool abuse',
      'System-prompt leakage',
      'Indirect prompt injection in retrieved data',
      'Full-stack agent attack tracing (Qdrant, Langfuse)',
      'Mitigation implementation and verification']),
    ('ai', 6, array[
      'Deploying production-grade AI guardrails (NeMo, Llama Guard, Rebuff)',
      'OWASP LLM Top 10 red-teaming',
      'Automated LLM vulnerability scanning (garak)',
      'Before/after bypass-rate measurement',
      'Guardrail tuning without breaking legitimate use',
      'Security report plus narrated video']),
    -- ===== 4 · Governance, Risk & Compliance =====
    ('grc', 1, array[
      'Asset inventory and vulnerability identification',
      'NIST SP 800-30 risk assessment with NIST CSF mapping',
      'Quantitative risk analysis (FAIR)',
      'Control-framework gap analysis (CIS v8 / ISO 27001 Annex A)',
      'Compliance auditing (CIS-CAT Lite, Lynis)',
      'Policy and remediation-roadmap authoring']),
    ('grc', 2, array[
      'Automated CIS benchmark scanning (CIS-CAT Lite, OpenSCAP, Lynis)',
      'Interpreting compliance scores and failed controls',
      'Risk-based remediation triage',
      'System hardening',
      'Before/after re-scan validation',
      'Audit reporting with residual-risk analysis']),
    ('grc', 3, array[
      'Deploying and operating a GRC platform (Eramba)',
      'Asset and risk register management',
      'Control-to-framework mapping (ISO 27001 / CIS)',
      'Policy and risk-treatment-plan management',
      'Review-cycle workflow execution',
      'CISO-level risk / compliance reporting']),
    ('grc', 4, array[
      'Threat modeling with STRIDE',
      'Data Flow Diagram and trust-boundary design (OWASP Threat Dragon)',
      'Threat identification against a live application',
      'Threat validation through hands-on testing',
      'Predicted-vs-confirmed threat matrix',
      'Mitigation recommendations']),
    ('grc', 5, array[
      'Incident-response tabletop facilitation (Backdoors & Breaches)',
      'NIST SP 800-61 IR-lifecycle mapping',
      'After-action report (AAR) writing',
      'ATT&CK-based detection validation',
      'Assumed-vs-verified coverage analysis',
      'Detection-engineering gap backlog']),
    ('grc', 6, array[
      'Compliance-as-code authoring (Chef InSpec / OPA Rego)',
      'Encoding CIS controls as executable tests',
      'Automated control evaluation and reporting',
      'Remediation and passing re-run',
      'Control-to-standard mapping',
      'Repeatable, CI-ready test suites plus narrated video']),
    -- ===== 5 · Cloud Security =====
    ('cloud', 1, array[
      'Building a local cloud attack range (LocalStack + Terraform)',
      'S3 bucket misconfiguration exploitation',
      'IAM enumeration and privilege escalation',
      'SSRF-to-instance-metadata credential theft',
      'Detection via CloudTrail logs',
      'Remediation (least privilege, IMDSv2, bucket policy)']),
    ('cloud', 2, array[
      'Building a local Kubernetes cluster (minikube)',
      'K8s attack scenarios (secrets in env, SSRF, container escape, RBAC abuse)',
      'Exploiting Kubernetes Goat',
      'Pod and RBAC hardening (PodSecurity, NetworkPolicy, seccomp)',
      'Remediation and re-testing',
      'Cluster security reporting']),
    ('cloud', 3, array[
      'Infrastructure-as-Code scanning (Checkov, Trivy)',
      'Pre-commit security hooks',
      'CI security gating (GitHub Actions run locally with act)',
      'Fail-threshold policy design',
      'Blocked-vs-passing pipeline validation',
      'Shift-left security practice']),
    ('cloud', 4, array[
      'Deploying serverless / Lambda functions (LocalStack)',
      'SSRF exploitation (file:///proc/self/environ)',
      'Runtime credential theft from a function',
      'Post-exploitation with stolen IAM credentials',
      'IAM role / permission enumeration',
      'Serverless hardening (input validation, least privilege, monitoring)']),
    ('cloud', 5, array[
      'CloudTrail log analysis (jq)',
      'Detecting no-MFA console logins',
      'Reconstructing a cloud attack timeline',
      'Building a cloud SIEM (Elasticsearch / Kibana + Filebeat)',
      'Sigma rule conversion and alerting (ElastAlert)',
      'ATT&CK coverage heatmaps and rule tuning']),
    ('cloud', 6, array[
      'Deploying local cloud / K8s infrastructure (LocalStack / minikube)',
      'Attack-surface mapping and exploitation (secrets, SSRF, escape, RBAC/IAM)',
      'CIS benchmarking (kube-bench, Checkov, Trivy)',
      'Least-privilege hardening',
      'Re-test validation of each fix',
      'Before/after benchmarking plus narrated video']),
    -- ===== 6 · Digital Forensics =====
    ('forensics', 1, array[
      'Disk forensics and deleted-file recovery (Autopsy, KAPE)',
      'Memory forensics (Volatility 3)',
      'Windows artifact analysis (Registry, Prefetch, LNK — Eric Zimmerman tools)',
      'Network forensics (Wireshark, NetworkMiner)',
      'Super-timeline correlation across evidence types',
      'Court-ready forensic reporting']),
    ('forensics', 2, array[
      'Advanced memory forensics (Volatility 3)',
      'Detecting process injection and hollowing (malfind, ldrmodules)',
      'Carving payloads from memory and hashing them',
      'YARA scanning of memory',
      'IOC consolidation (netscan, cmdline, registry)',
      'Process-tree narrative reconstruction']),
    ('forensics', 3, array[
      'Super-timeline generation with Plaso (log2timeline / psort)',
      'Fusing multi-artifact sources (filesystem, registry, event logs, browser, prefetch)',
      'Timeline filtering and keyword tagging',
      'Incident-window correlation',
      'Evidence-backed intrusion narrative',
      'Forensic reporting']),
    ('forensics', 4, array[
      'Live / volatile data acquisition (ADB)',
      'Android filesystem extraction',
      'Chain-of-custody hashing (SHA-256)',
      'Automated artifact parsing (ALEAPP)',
      'SQLite artifact analysis (SMS, calls, browser, Wi-Fi)',
      'Forensic acquisition reporting']),
    ('forensics', 5, array[
      'Decrypting captured traffic (TLS keylog / WPA2)',
      'Traffic indexing and carving (Zeek, NetworkMiner)',
      'Credential, file and object extraction with hashing',
      'IDS replay and alert correlation (Suricata, tcpreplay)',
      'Session reconstruction',
      'ATT&CK-mapped intrusion timeline']),
    ('forensics', 6, array[
      'Building an isolated RE lab (FLARE-VM + REMnux)',
      'Static analysis and disassembly (Ghidra, floss, capa, PE-bear)',
      'Dynamic detonation and behavior capture (Procmon, INetSim, Wireshark)',
      'Correlating static code with dynamic behavior',
      'C2 / config and IOC extraction',
      'ATT&CK-mapped report plus narrated video'])
)
update public.tasks t
   set skills = sk.skills
  from sk
  join public.domains d on d.key = sk.dept
 where t.domain_id = d.id and t.week = sk.wk;


-- ============================================================================
-- ===== supabase/115_cohort_start_dates.sql =====
-- ============================================================================
-- 115_cohort_start_dates.sql — Founder-set per-cohort start dates. Run after 114. Idempotent.
--
-- The admin "late comer" tag (and any future date-based feature) needs to know when each cohort begins.
-- Tasks are shared across cohorts (migration 105 only changed member-id numbering, not the task set), so
-- a task's created_at/due_at can't anchor this — a Cohort-2 intern would look "late" against a Week-1
-- task created back in Cohort 1. This stores a per-cohort start date the founder sets in the panel, as a
-- JSON map { "<cohort>": "YYYY-MM-DD" }. Only a founder can write it; everyone authenticated can read
-- app_settings, so the panel reads the map directly.

-- ---- (1) storage ---------------------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists cohort_starts jsonb not null default '{}'::jsonb;

-- ---- (2) founder setter --------------------------------------------------------------------------------
-- Pass p_date = null to clear a cohort's start date (removes its key from the map).
create or replace function public.set_cohort_start(p_cohort int, p_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Only a founder can set a cohort start date.';
  end if;
  if p_cohort is null or p_cohort < 1 or p_cohort > 99 then
    raise exception 'Cohort must be between 1 and 99.';
  end if;
  update public.app_settings
     set cohort_starts = case
           when p_date is null then (cohort_starts - p_cohort::text)
           else jsonb_set(cohort_starts, array[p_cohort::text], to_jsonb(p_date::text), true)
         end,
         updated_at = now(), updated_by = auth.uid()
   where id = true;
  perform public.log_admin_action(
    'set_cohort_start', null,
    'Cohort ' || p_cohort || ' start = ' || coalesce(p_date::text, '(cleared)')
  );
end; $$;
grant execute on function public.set_cohort_start(int, date) to authenticated;


-- ============================================================================
-- ===== supabase/116_cohort_chat_cutoff.sql =====
-- ============================================================================
-- 116_cohort_chat_cutoff.sql — Scope chat history to the reader's cohort. Run after 115. Idempotent.
--
-- Message visibility was scoped only by department (+ the global lobby), and milestones were global —
-- neither had any cohort dimension. So a fresh Cohort-2 intern could read Cohort-1's entire department
-- chat, the lobby, and every past milestone. This hides messages/milestones created BEFORE the reader's
-- cohort start date (app_settings.cohort_starts, migration 115).
--
-- Rules: admins are exempt (still see everything, as before). If the reader's cohort has no start date
-- set, nothing is hidden (safe default) — so Cohort-1 members and anyone pre-rollout are unaffected until
-- the founder sets their cohort's start date. Only the READ policies change; insert/update are untouched.

-- Reader's cohort start, parsed from their member_id -> cohort number -> cohort_starts map. NULL when the
-- member_id has no cohort, or that cohort has no date set. security definer so an RLS policy can read
-- app_settings + the caller's own profile row regardless of the caller's own grants.
create or replace function public.my_cohort_start()
returns timestamptz language sql stable security definer set search_path = public as $$
  select (s.cohort_starts ->> (regexp_match(p.member_id, 'Cohort\s*([0-9]+)', 'i'))[1])::timestamptz
    from public.profiles p, public.app_settings s
   where p.id = auth.uid()
     and s.id = true
     and p.member_id ~* 'Cohort\s*[0-9]+';
$$;
grant execute on function public.my_cohort_start() to authenticated;

-- Small helper: is the caller an admin? (keeps the policies readable)
-- (public.is_founder() already exists; role check mirrors the original messages policy.)

-- messages: read your domain OR the lobby (admin reads all) — now also gated to your cohort's window.
drop policy if exists "messages_read_own_domain" on public.messages;
create policy "messages_read_own_domain" on public.messages
  for select to authenticated using (
    (
      domain_id = (select domain_id from public.profiles where id = auth.uid())
      or domain_id = (select id from public.domains where key = 'lobby')
      or (select role from public.profiles where id = auth.uid()) = 'admin'
    )
    and (
      (select role from public.profiles where id = auth.uid()) = 'admin'
      or public.my_cohort_start() is null
      or created_at >= public.my_cohort_start()
    )
  );

-- milestones: global read feed — gate purely by the same cohort window (admins exempt).
drop policy if exists milestones_read on public.milestones;
create policy milestones_read on public.milestones
  for select to authenticated using (
    (select role from public.profiles where id = auth.uid()) = 'admin'
    or public.my_cohort_start() is null
    or created_at >= public.my_cohort_start()
  );


-- ============================================================================
-- ===== supabase/117_fee_gate_week2.sql =====
-- ============================================================================
-- 117_fee_gate_week2.sql — Require the internship fee proof before Week 2+ submissions. Run after 116.
-- Idempotent.
--
-- Policy: Week 1 is free; from Week 2 onward an intern must have submitted their fee payment proof
-- (profiles.payment_proof_url is not null) before they can submit a task. This is the server-side half of
-- the "hard gate" — the Tasks UI also hides the upload button, but this trigger makes it non-bypassable.
-- Enforced on INSERT only, so it gates the FIRST submission of a Week 2+ task and never interferes with
-- admin grading (which UPDATEs an existing row) or the data-retention nulling of old proofs.

create or replace function public.enforce_fee_before_week2()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_week int;
  v_role text;
  v_paid boolean;
begin
  select week into v_week from public.tasks where id = new.task_id;
  if coalesce(v_week, 1) < 2 then
    return new;  -- Week 1 (or unknown) is free
  end if;
  select role, (payment_proof_url is not null)
    into v_role, v_paid
    from public.profiles where id = new.user_id;
  if v_role = 'admin' then
    return new;  -- admins are never gated
  end if;
  if not coalesce(v_paid, false) then
    raise exception 'FEE_REQUIRED: submit your internship fee proof before the Week 2 task.';
  end if;
  return new;
end; $$;

drop trigger if exists trg_fee_before_week2 on public.submissions;
create trigger trg_fee_before_week2
  before insert on public.submissions
  for each row execute function public.enforce_fee_before_week2();


-- ============================================================================
-- ===== supabase/118_drop_auto_unpaid_removal.sql =====
-- ============================================================================
-- 118_drop_auto_unpaid_removal.sql — Remove ALL bulk/automatic removal of unpaid interns. Run after 117.
-- Idempotent.
--
-- Two mechanisms removed:
--   1. Trigger on public.tasks (trg_week4_unpaid_removal -> auto_remove_unpaid_on_week4, migrations 006/011)
--      deleted every intern with no payment proof when a Week-4 task was inserted.
--   2. The manual admin RPC public.audit_unpaid_interns() deleted EVERY non-admin with no payment proof the
--      moment it was called — ignoring the new "Week 1 is free / pay before Week 2" rule and cohort, so it
--      would have wiped legitimately-unpaid Week-1 interns. Its Admin Panel button is removed too.
--
-- The founder now removes unpaid interns MANUALLY (per-member Ban/delete), and the Week-2 fee hard gate
-- (migration 117) is the real enforcement.

drop trigger if exists trg_week4_unpaid_removal on public.tasks;
drop function if exists public.auto_remove_unpaid_on_week4();
drop function if exists public.audit_unpaid_interns();


-- ============================================================================
-- ===== supabase/119_reset_cohort_member_numbering.sql =====
-- ============================================================================
-- 119_reset_cohort_member_numbering.sql — Founder tool: restart the CURRENT cohort's per-department
-- member-ID numbering at 001. Run after 105 (which added the `cohort` column to member_id_seq). Idempotent.
--
-- Why: member_id_seq only ever counts UP; deleting an account (admin_delete_user, etc.) does NOT release its
-- number. After repeated signup/delete cycles during testing, the next intern in a department gets -004, -005…
-- This clears the counter rows for the configured current_cohort ONLY, so the next signup in each department
-- of that cohort starts again at -001.
--
-- SCOPED TO THE CURRENT COHORT ONLY: it deletes member_id_seq rows where cohort = current_cohort. Previous
-- cohorts' counters (e.g. Cohort 1) are left untouched — their IDs and future numbering are unaffected.
-- (Unlike the older public.reset_id_counters(), which zeroes every cohort at once.) Existing profiles keep
-- their already-assigned member_id; this only affects numbers handed out to FUTURE signups.

create or replace function public.reset_cohort_member_numbering()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_cohort  int;
  v_deleted int;
begin
  if not public.is_founder() then
    raise exception 'Only a founder can reset member-ID numbering.';
  end if;

  select current_cohort into v_cohort from public.app_settings where id = true;
  v_cohort := coalesce(v_cohort, 1);

  -- Only this cohort's per-department counters; other cohorts are untouched.
  delete from public.member_id_seq where cohort = v_cohort;
  get diagnostics v_deleted = row_count;

  perform public.log_admin_action(
    'reset_cohort_member_numbering', null,
    'Reset member-ID numbering for cohort ' || v_cohort || ' (' || v_deleted || ' department counter(s) cleared)'
  );
  return v_cohort;
end; $$;

grant execute on function public.reset_cohort_member_numbering() to authenticated;


-- ============================================================================
-- ===== supabase/120_tasks_per_cohort.sql =====
-- ============================================================================
-- 120_tasks_per_cohort.sql — Make the task set per-cohort + a founder "reset this cohort's tasks"
-- tool. Run after 119. Idempotent — safe to re-run.
--
-- Until now tasks were a single shared curriculum (migration 115: "Tasks are shared across cohorts").
-- That meant a new cohort inherited the previous cohort's published tasks and there was no way to
-- clear/republish a cohort's tasks short of the full portal wipe (reset_portal). This migration:
--   1. adds a `cohort` column to public.tasks and backfills every existing row to Cohort 1,
--   2. gates task visibility so an intern only sees their own cohort's tasks (admins still see all),
--   3. adds reset_cohort_tasks(p_cohort) — a founder-only, cohort-scoped delete that mirrors
--      reset_cohort_member_numbering() (migration 119).
--
-- The intern Tasks view and the admin publish flow read/write this column; the per-cohort TIMELINE
-- (migration 115/116 cohort_starts) is unchanged and still drives due dates.

-- ---- (1) column + backfill -----------------------------------------------------------------------------
-- Nullable: a NULL cohort means "every cohort" (same convention as domain_id NULL = every domain). All
-- rows that exist today belong to Cohort 1, so backfill them; new tasks carry their cohort explicitly.
alter table public.tasks
  add column if not exists cohort int;

update public.tasks set cohort = 1 where cohort is null;

create index if not exists tasks_cohort_week on public.tasks (cohort, week);

-- ---- (2) caller's cohort (for the RLS read policy) -----------------------------------------------------
-- Parsed from the caller's member_id -> cohort number (mirrors my_cohort_start(), migration 116).
-- NULL when the caller has no cohort segment (unassigned / non-student). security definer so an RLS
-- policy can read the caller's own profile row regardless of the caller's grants.
create or replace function public.my_cohort()
returns int language sql stable security definer set search_path = public as $$
  select (regexp_match(member_id, 'Cohort\s*([0-9]+)', 'i'))[1]::int
    from public.profiles
   where id = auth.uid()
     and member_id ~* 'Cohort\s*[0-9]+';
$$;
grant execute on function public.my_cohort() to authenticated;

-- ---- (3) tasks visible to a student: domain AND ram AND cohort (admins exempt) -------------------------
-- Extends the policy from 015_ram_specs.sql with a cohort gate. A NULL cohort stays visible to all
-- (legacy fallback — none exist after the backfill above).
drop policy if exists "tasks_read" on public.tasks;
create policy "tasks_read" on public.tasks
  for select to authenticated using (
    public.is_admin()
    or (
      (domain_id is null or domain_id = (select domain_id from public.profiles where id = auth.uid()))
      and (ram is null or ram = (select ram from public.profiles where id = auth.uid()))
      and (cohort is null or cohort = public.my_cohort())
    )
  );

-- ---- (4) founder tool: reset ONE cohort's published tasks ----------------------------------------------
-- Deletes every task row for p_cohort; all dependent rows (submissions, submission versions,
-- task_extension_requests, email reminders, submission_change_requests) cascade via their
-- `references public.tasks(id) on delete cascade`. Other cohorts are untouched. Returns the number of
-- task rows deleted. R2 objects (task PDFs + submission files) are purged by the calling API route
-- BEFORE this runs, because Postgres cannot reach R2 and the keys vanish once the rows are gone.
create or replace function public.reset_cohort_tasks(p_cohort int)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_deleted int;
begin
  if not public.is_founder() then
    raise exception 'Only a founder can reset a cohort''s tasks.';
  end if;
  if p_cohort is null or p_cohort < 1 or p_cohort > 99 then
    raise exception 'Cohort must be between 1 and 99.';
  end if;

  delete from public.tasks where cohort = p_cohort;
  get diagnostics v_deleted = row_count;

  perform public.log_admin_action(
    'reset_cohort_tasks', null,
    'Deleted ' || v_deleted || ' task(s) for cohort ' || p_cohort
  );
  return v_deleted;
end; $$;

grant execute on function public.reset_cohort_tasks(int) to authenticated;


-- ============================================================================
-- ===== supabase/121_signup_linkedin_cv.sql =====
-- ============================================================================
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


-- ============================================================================
-- ===== supabase/122_hall_of_fame.sql =====
-- ============================================================================
-- 122_hall_of_fame.sql — all-time, admin-curated "Best Intern" Hall of Fame for the public website.
-- Run in the Supabase SQL editor after 121. Idempotent (safe to re-run).
--
-- Design (decided with the founder):
--   * All-time: a durable public.hall_of_fame row per inducted intern — survives the per-cohort
--     is_best_intern reset (033) and the 75-day submissions purge, because the passport is SNAPSHOT
--     into the row at induction (not recomputed live).
--   * Admin-curated opt-in: only an admin/founder inducts someone (induct_best_intern), which implies
--     the intern consented to public display. Profile fields (name, avatar, LinkedIn, domain) are
--     snapshotted so the card stays correct even if the profile later changes or is purged.
--   * Public page reads ONLY through SECURITY DEFINER RPCs (anon): get_hall_of_fame (cards) and
--     get_hall_of_fame_passport (the modal). No email is exposed (LinkedIn only).

-- ---- (1) Shared passport computation --------------------------------------------------------------
-- Factored out of get_public_passport (082) so the Hall of Fame can snapshot the SAME verified numbers
-- by uid. Body is identical to 082's computation. NOT granted to anon/authenticated: it would expose
-- any intern's computed marks by uid. It is only ever reached through the SECURITY DEFINER functions
-- below (which run as the owner), so no caller grant is needed; we revoke the default PUBLIC execute.
create or replace function public.compute_passport_json(p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare p public.profiles; v_domain text; v_result jsonb;
begin
  select * into p from public.profiles where id = p_uid;
  if p.id is null then return null; end if;
  select name into v_domain from public.domains where id = p.domain_id;

  with subs as (
    select s.score_completeness c, s.score_accuracy a, s.score_evidence e, s.score_report r,
           s.score_overall o, s.graded_at, t.week, t.title,
           coalesce(nullif(t.skills, '{}'::text[]), array[coalesce(v_domain, 'General')]) as skills
    from public.submissions s
    join public.tasks t on t.id = s.task_id
    where s.user_id = p.id and s.status = 'approved' and s.graded_at is not null
  ),
  axes as (
    select jsonb_build_array(
      jsonb_build_object('key','completeness','label','Completeness','value', round(avg(c)::numeric, 1)),
      jsonb_build_object('key','accuracy',    'label','Accuracy',    'value', round(avg(a)::numeric, 1)),
      jsonb_build_object('key','evidence',    'label','Evidence',    'value', round(avg(e)::numeric, 1)),
      jsonb_build_object('key','report',      'label','Reporting',   'value', round(avg(r)::numeric, 1))
    ) j, count(o) n, round(avg(o) / 40 * 100) overall_pct from subs
  ),
  skills as (
    select sk as skill, round(avg(o) / 40 * 100) pct, count(o) n
    from subs, unnest(subs.skills) sk
    group by sk
  ),
  skills_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'skill', skill, 'pct', pct, 'tasks', n,
      'level', case when pct >= 80 then 'Advanced' when pct >= 60 then 'Proficient' else 'Novice' end
    ) order by pct desc nulls last), '[]'::jsonb) j from skills
  ),
  tasks_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'week', week, 'title', title, 'score', round(o::numeric, 1), 'graded_at', graded_at
    ) order by week), '[]'::jsonb) j from subs
  )
  select jsonb_build_object(
    'name',         coalesce(p.full_name, p.display_name, 'Intern'),
    'display_name', p.display_name,
    'member_id',    p.member_id,
    'domain',       v_domain,
    'overall_pct',  (select overall_pct from axes),
    'count',        (select n from axes),
    'axes',         (select j from axes),
    'skills',       (select j from skills_json),
    'tasks',        (select j from tasks_json),
    'issued_at',    p.created_at,
    'verified',     true
  ) into v_result;
  return v_result;
end; $$;
revoke execute on function public.compute_passport_json(uuid) from public;

-- Re-point the existing public passport page at the shared function (behaviour unchanged).
create or replace function public.get_public_passport(p_token text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_uid uuid;
begin
  if coalesce(p_token, '') = '' then return null; end if;
  select user_id into v_uid from public.passport_shares where token = p_token and is_public = true;
  if v_uid is null then return null; end if;
  return public.compute_passport_json(v_uid);
end; $$;
grant execute on function public.get_public_passport(text) to anon, authenticated;

-- ---- (2) Hall of Fame table -----------------------------------------------------------------------
create table if not exists public.hall_of_fame (
  id           bigint generated always as identity primary key,
  user_id      uuid references public.profiles(id) on delete set null,  -- keep the row if the profile is purged
  domain_id    int  references public.domains(id),
  domain_name  text,          -- snapshot (survives domain/profile changes + purges)
  cohort       int,
  year         int,
  display_name text not null, -- snapshot (full name preferred)
  photo_url    text,          -- admin-uploaded headshot (public URL); card falls back to avatar_url
  avatar_url   text,          -- snapshot of the profile avatar at induction (fallback)
  linkedin_url text,          -- snapshot
  passport     jsonb,         -- snapshot of compute_passport_json at induction (survives retention)
  is_visible   boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists hall_of_fame_domain on public.hall_of_fame (domain_id);

alter table public.hall_of_fame enable row level security;
-- Admins/founders manage it directly (list + edit visibility/sort/photo); the public reads via RPC only.
drop policy if exists "hof_admin_all" on public.hall_of_fame;
create policy "hof_admin_all" on public.hall_of_fame
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- (3) Induct (admin) — snapshots profile + passport into a new row -----------------------------
create or replace function public.induct_best_intern(
  p_uid uuid,
  p_cohort int default null,
  p_display_name text default null,
  p_linkedin_url text default null,
  p_photo_url text default null
)
returns bigint language plpgsql security definer set search_path = public as $$
declare p public.profiles; v_domain text; v_cohort int; v_id bigint;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into p from public.profiles where id = p_uid;
  if p.id is null then raise exception 'no such user'; end if;
  select name into v_domain from public.domains where id = p.domain_id;
  v_cohort := coalesce(p_cohort, (select current_cohort from public.app_settings where id = true), 1);

  insert into public.hall_of_fame (
    user_id, domain_id, domain_name, cohort, year, display_name, photo_url, avatar_url, linkedin_url, passport
  ) values (
    p_uid, p.domain_id, v_domain, v_cohort, extract(year from now())::int,
    coalesce(nullif(btrim(p_display_name), ''), p.full_name, p.display_name, 'Intern'),
    nullif(btrim(p_photo_url), ''),
    p.avatar_url,
    coalesce(nullif(btrim(p_linkedin_url), ''), p.linkedin_url),
    public.compute_passport_json(p_uid)
  )
  returning id into v_id;

  perform public.log_admin_action('induct_best_intern', p_uid,
    'Hall of Fame: ' || coalesce(v_domain, '?') || ' · cohort ' || v_cohort);
  return v_id;
end; $$;
grant execute on function public.induct_best_intern(uuid, int, text, text, text) to authenticated;

-- Re-snapshot an inductee's passport from their current graded work (admin).
create or replace function public.refresh_hall_of_fame_passport(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select user_id into v_uid from public.hall_of_fame where id = p_id;
  if v_uid is null then raise exception 'this inductee has no linked profile to refresh from'; end if;
  update public.hall_of_fame
     set passport = public.compute_passport_json(v_uid), updated_at = now()
   where id = p_id;
end; $$;
grant execute on function public.refresh_hall_of_fame_passport(bigint) to authenticated;

-- ---- (4) Public reads (anon) ----------------------------------------------------------------------
-- Card data only (no passport payload) — the modal lazy-loads the passport by id.
create or replace function public.get_hall_of_fame()
returns jsonb language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',           h.id,
    'domain_id',    h.domain_id,
    'domain',       h.domain_name,
    'cohort',       h.cohort,
    'year',         h.year,
    'name',         h.display_name,
    'photo_url',    h.photo_url,
    'avatar_url',   h.avatar_url,
    'linkedin_url', h.linkedin_url,
    'has_passport', (h.passport is not null)
  ) order by h.domain_id nulls last, h.sort, h.created_at), '[]'::jsonb)
  from public.hall_of_fame h
  where h.is_visible = true;
$$;
grant execute on function public.get_hall_of_fame() to anon, authenticated;

create or replace function public.get_hall_of_fame_passport(p_id bigint)
returns jsonb language sql security definer set search_path = public stable as $$
  select h.passport from public.hall_of_fame h where h.id = p_id and h.is_visible = true;
$$;
grant execute on function public.get_hall_of_fame_passport(bigint) to anon, authenticated;


-- ============================================================================
-- ===== supabase/123_passport_normalize.sql =====
-- ============================================================================
-- 123_passport_normalize.sql — fix the Skill Passport math so the PUBLIC passport (/passport/<token>)
-- and the Hall-of-Fame modal show the same, correct numbers as the in-portal Skill Passport.
-- Run in the Supabase SQL editor AFTER 122. Idempotent (safe to re-run).
--
-- THE BUG: compute_passport_json (082 → 122) assumed every task is marked out of 40 with four /10 axes.
-- The FINAL task (Week 6) is marked out of 100 — Completeness/Accuracy/Evidence /10, Report /20,
-- Video /50 — so the old math produced:
--   * overall % > 100  (e.g. avg(40,38,39,34,38,87)=46 → 46/40*100 = 115%)
--   * per-skill % > 100 (a Week-6 skill: 87/40*100 = 218%)
--   * a Reporting competency > 10/10 (raw avg mixing Report /10 for weeks 1–5 with Report /20 for week 6)
-- The in-portal Skill Passport (app/portal/_components/SkillPassport.jsx via _lib.js rubricForWeek())
-- already does this right; this makes the SQL match it.
--
-- THE FIX: normalise against each task's OWN rubric (mirrors app/portal/_lib.js):
--   * weeks 1–5 → max 40 (axes /10); week 6 → max 100 (Report /20, Video /50)
--   * every axis is put on a /10 basis before averaging (Report wk6 ÷2, Video wk6 ÷5)
--   * overall % and per-skill % divide the summed scores by the summed per-task max (not a flat /40)
--   * adds the Video competency axis (parity with the in-portal passport; "—" for interns with no
--     final-task submission, exactly like the portal view)
-- Finally, re-snapshot any already-inducted Hall-of-Fame rows so their stored numbers are corrected too.

create or replace function public.compute_passport_json(p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare p public.profiles; v_domain text; v_result jsonb;
begin
  select * into p from public.profiles where id = p_uid;
  if p.id is null then return null; end if;
  select name into v_domain from public.domains where id = p.domain_id;

  with subs as (
    select
      s.score_overall o,
      s.graded_at, t.week, t.title,
      -- per-task max: weeks 1–5 = /40, final task (week 6) = /100  (mirrors rubricForWeek().total)
      case when t.week = 6 then 100 else 40 end as max_total,
      -- axes normalised to a /10 basis. Completeness/Accuracy/Evidence are /10 every week.
      -- Report is /20 and Video /50 only on the final task, so divide those down on week 6.
      s.score_completeness::numeric as n_complete,
      s.score_accuracy::numeric     as n_accuracy,
      s.score_evidence::numeric     as n_evidence,
      case when t.week = 6 then s.score_report::numeric / 2.0 else s.score_report::numeric end as n_report,
      case when t.week = 6 then s.score_video::numeric  / 5.0 else null end                  as n_video,
      coalesce(nullif(t.skills, '{}'::text[]), array[coalesce(v_domain, 'General')]) as skills
    from public.submissions s
    join public.tasks t on t.id = s.task_id
    where s.user_id = p.id and s.status = 'approved' and s.graded_at is not null
  ),
  axes as (
    select jsonb_build_array(
      jsonb_build_object('key','completeness','label','Completeness','value', round(avg(n_complete)::numeric, 1)),
      jsonb_build_object('key','accuracy',    'label','Accuracy',    'value', round(avg(n_accuracy)::numeric, 1)),
      jsonb_build_object('key','evidence',    'label','Evidence',    'value', round(avg(n_evidence)::numeric, 1)),
      jsonb_build_object('key','report',      'label','Reporting',   'value', round(avg(n_report)::numeric, 1)),
      jsonb_build_object('key','video',       'label','Video demo',  'value', round(avg(n_video)::numeric, 1))
    ) j,
    count(o) n,
    -- overall % = Σ score ÷ Σ (each task's own max) × 100  (caps correctly at 100%)
    round(sum(o)::numeric / nullif(sum(max_total), 0) * 100) overall_pct
    from subs
  ),
  skills as (
    select sk as skill,
           round(sum(o)::numeric / nullif(sum(max_total), 0) * 100) pct,
           count(o) n
    from subs, unnest(subs.skills) sk
    group by sk
  ),
  skills_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'skill', skill, 'pct', pct, 'tasks', n,
      'level', case when pct >= 80 then 'Advanced' when pct >= 60 then 'Proficient' else 'Novice' end
    ) order by pct desc nulls last), '[]'::jsonb) j from skills
  ),
  tasks_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'week', week, 'title', title, 'score', round(o::numeric, 1), 'max', max_total, 'graded_at', graded_at
    ) order by week), '[]'::jsonb) j from subs
  )
  select jsonb_build_object(
    'name',         coalesce(p.full_name, p.display_name, 'Intern'),
    'display_name', p.display_name,
    'member_id',    p.member_id,
    'domain',       v_domain,
    'overall_pct',  (select overall_pct from axes),
    'count',        (select n from axes),
    'axes',         (select j from axes),
    'skills',       (select j from skills_json),
    'tasks',        (select j from tasks_json),
    'issued_at',    p.created_at,
    'verified',     true
  ) into v_result;
  return v_result;
end; $$;
-- Not exposed to anon/authenticated (it would leak any intern's marks by uid); reached only through the
-- SECURITY DEFINER wrappers get_public_passport / get_hall_of_fame_passport, which run as the owner.
revoke execute on function public.compute_passport_json(uuid) from public;

-- Re-snapshot already-inducted Hall-of-Fame rows so their stored passports use the corrected numbers.
update public.hall_of_fame
   set passport = public.compute_passport_json(user_id), updated_at = now()
 where user_id is not null;


-- ============================================================================
-- ===== supabase/124_announcement_audience.sql =====
-- ============================================================================
-- 124_announcement_audience.sql — Scope each announcement to one audience. Run after 123. Idempotent.
--
-- Until now every announcement was global: the read policy was `using (true)`, so every authenticated
-- user (every cohort + alumni + staff) saw every post. This adds a single-choice audience per post:
--   'all'    → portal-wide: everyone (the default — existing rows keep today's behaviour).
--   'cohort' → the ACTIVE cohort only (app_settings.current_cohort), excluding alumni. DYNAMIC: when the
--              founder advances the current cohort, a 'cohort' post re-targets to the new cohort and the
--              previous cohort stops seeing it (no cohort number is stored on the row).
--   'alumni' → alumni only (profiles.is_alumni = true).
-- Admins always see everything (to manage/delete). A viewer who is BOTH alumni and in the active cohort
-- counts as ALUMNI (alumni-wins): they get 'alumni' posts, not 'cohort' posts.
--
-- Only the SELECT policy changes; insert/update/delete (admin-only, schema.sql + 008) are untouched. The
-- column default keeps every existing announcement 'all', so nothing is retroactively hidden. Every read
-- path (the Announcements channel, the login popup, the top banner, the Notification Center, and realtime
-- postgres_changes) goes through this one table, so they all honour the audience automatically — the same
-- approach as the cohort chat cutoff (migration 116).

-- ---- (1) audience column ------------------------------------------------------------------------------
alter table public.announcements
  add column if not exists audience text not null default 'all'
  check (audience in ('all','cohort','alumni'));

-- ---- (2) caller attributes (security definer so the RLS policy reads them regardless of the caller's
--          grants/RLS — mirrors my_cohort() in migration 120 and my_cohort_start() in 116) -------------
-- Active cohort number, read past app_settings' own RLS.
create or replace function public.active_cohort()
returns int language sql stable security definer set search_path = public as $$
  select current_cohort from public.app_settings where id = true;
$$;
grant execute on function public.active_cohort() to authenticated;

-- Is the caller an alumnus? (missing profile row → false)
create or replace function public.my_is_alumni()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_alumni from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.my_is_alumni() to authenticated;

-- public.my_cohort() (migration 120) already returns the caller's cohort number parsed from member_id
-- (NULL when the caller has no 'Cohort<N>' segment — e.g. staff or unassigned).

-- ---- (3) audience-aware read policy -------------------------------------------------------------------
drop policy if exists "ann_read" on public.announcements;
create policy "ann_read" on public.announcements
  for select to authenticated using (
    public.is_admin()
    or audience = 'all'
    or (audience = 'alumni' and public.my_is_alumni())
    or (
      audience = 'cohort'
      and not public.my_is_alumni()
      and public.my_cohort() is not null
      and public.my_cohort() = public.active_cohort()
    )
  );


-- ============================================================================
-- ===== supabase/125_cohort_reenrollment.sql =====
-- ============================================================================
-- 125_cohort_reenrollment.sql — Re-enroll a returning intern into a new cohort. Run after 124. Idempotent.
--
-- Context: a profile is 1:1 with the login, and its cohort is parsed from member_id (lib/cohort.cohortOf).
-- A Cohort-1 student who returns for Cohort 2 reuses the SAME account, so without this they keep their
-- Cohort-1 member_id + domain and their results stay pooled across cohorts. This migration adds the DATA
-- layer for a founder-driven re-enroll (the UI action and the per-cohort scoping of intern surfaces ship
-- in follow-up PRs):
--
--   * public.cohort_enrollments — one row per (user, cohort): the member_id + domain the intern held in
--     that cohort, so re-enrolling PRESERVES the old enrollment as viewable history.
--   * public.re_enroll_intern(user, domain, cohort) — FOUNDER-ONLY RPC: archives the current enrollment,
--     mints a fresh ZDR-<year>-Cohort<N>-<DEPT>-NNN id from member_id_seq (same path as handle_new_user /
--     105), switches domain_id, reactivates from alumni, and records the new active enrollment.
--   * public.get_cohort_enrollments(user) — enrollment history for the profile / admin modal.
--   * one-time backfill so every existing student has a row for their current cohort.
--
-- No change to protect_profile_columns is needed: migration 030 already dropped the blanket member_id lock
-- for admins/founders, so this RPC (run under the founder's own auth) may reissue the id directly.

-- ── (1) history table ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.cohort_enrollments (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  cohort      int  not null check (cohort between 1 and 99),
  member_id   text,
  domain_id   int  references public.domains(id),
  status      text not null default 'active' check (status in ('active', 'archived')),
  enrolled_at timestamptz not null default now(),
  ended_at    timestamptz
);
-- At most one enrollment row per (person, cohort). Re-enroll upserts on this key.
create unique index if not exists cohort_enrollments_user_cohort_uniq on public.cohort_enrollments (user_id, cohort);
create index if not exists cohort_enrollments_user_idx on public.cohort_enrollments (user_id);

alter table public.cohort_enrollments enable row level security;
-- Read: the owner sees their own history; admins/founders see everyone's. All WRITES go through the
-- SECURITY DEFINER functions below (no insert/update/delete policy → clients can't write directly).
drop policy if exists cohort_enrollments_select on public.cohort_enrollments;
create policy cohort_enrollments_select on public.cohort_enrollments
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ── (2) founder-only re-enroll ───────────────────────────────────────────────────────────────────────
create or replace function public.re_enroll_intern(p_user uuid, p_domain_id int, p_cohort int default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_cohort     int;
  v_year       int := extract(year from now())::int;
  v_dept_key   text;
  v_dept_code  text;
  v_seq        int;
  v_new_id     text;
  v_old_id     text;
  v_old_domain int;
  v_old_cohort int;
  v_role       text;
begin
  if not public.is_founder() then
    raise exception 'Only a founder can re-enroll an intern.';
  end if;

  select member_id, domain_id, role into v_old_id, v_old_domain, v_role
    from public.profiles where id = p_user;
  if not found then raise exception 'No such profile.'; end if;
  if v_role <> 'student' then raise exception 'Only student accounts can be re-enrolled.'; end if;

  -- Target cohort: explicit arg, else the founder-configured current_cohort (105), else 1.
  select coalesce(p_cohort, current_cohort, 1) into v_cohort from public.app_settings where id = true;
  v_cohort := coalesce(v_cohort, p_cohort, 1);
  if v_cohort < 1 or v_cohort > 99 then raise exception 'Cohort must be between 1 and 99.'; end if;

  select key into v_dept_key from public.domains where id = p_domain_id;
  if v_dept_key is null then raise exception 'Unknown domain %.', p_domain_id; end if;
  v_dept_code := public.dept_code_for(v_dept_key);
  if v_dept_code is null then raise exception 'Domain % has no member-ID department code.', v_dept_key; end if;

  -- Cohort the intern currently holds (parsed from the member_id label; null/legacy → 1).
  v_old_cohort := coalesce(nullif(substring(coalesce(v_old_id, '') from 'Cohort[^0-9]*([0-9]+)'), '')::int, 1);
  if v_old_cohort = v_cohort then
    raise exception 'Intern is already in cohort %.', v_cohort;
  end if;

  -- Archive the current enrollment as history (idempotent on re-run).
  insert into public.cohort_enrollments (user_id, cohort, member_id, domain_id, status, ended_at)
    values (p_user, v_old_cohort, v_old_id, v_old_domain, 'archived', now())
  on conflict (user_id, cohort) do update
    set status    = 'archived',
        ended_at  = now(),
        member_id = coalesce(public.cohort_enrollments.member_id, excluded.member_id),
        domain_id = coalesce(public.cohort_enrollments.domain_id, excluded.domain_id);

  -- Mint the new member ID for (year, target cohort, new department) — same sequence as handle_new_user.
  insert into public.member_id_seq (year, cohort, dept_code, last_seq)
    values (v_year, v_cohort, v_dept_code, 1)
    on conflict (year, cohort, dept_code) do update set last_seq = public.member_id_seq.last_seq + 1
    returning last_seq into v_seq;
  v_new_id := 'ZDR-' || v_year || '-Cohort' || v_cohort || '-' || v_dept_code || '-' || lpad(v_seq::text, 3, '0');

  -- Move the profile into the new cohort/domain and reactivate (030 permits a founder to reissue member_id).
  update public.profiles
     set domain_id = p_domain_id,
         member_id = v_new_id,
         is_alumni = false,
         status    = 'approved'
   where id = p_user;

  -- Record the new, active enrollment.
  insert into public.cohort_enrollments (user_id, cohort, member_id, domain_id, status)
    values (p_user, v_cohort, v_new_id, p_domain_id, 'active')
  on conflict (user_id, cohort) do update
    set member_id   = excluded.member_id,
        domain_id   = excluded.domain_id,
        status      = 'active',
        ended_at    = null,
        enrolled_at = now();

  perform public.log_admin_action(
    're_enroll_intern', p_user,
    'Re-enrolled into cohort ' || v_cohort || ' as ' || v_new_id || ' (was ' || coalesce(v_old_id, '—') || ')'
  );
  return v_new_id;
end; $$;
grant execute on function public.re_enroll_intern(uuid, int, int) to authenticated;

-- ── (3) history reader (profile + admin modal) ───────────────────────────────────────────────────────
create or replace function public.get_cohort_enrollments(p_user uuid)
returns setof public.cohort_enrollments language sql security definer set search_path = public stable as $$
  select * from public.cohort_enrollments
   where user_id = p_user
     and (p_user = auth.uid() or public.is_admin())
   order by cohort;
$$;
grant execute on function public.get_cohort_enrollments(uuid) to authenticated;

-- ── (4) one-time backfill: seed a current-cohort row for every existing student ───────────────────────
insert into public.cohort_enrollments (user_id, cohort, member_id, domain_id, status)
select p.id,
       coalesce(nullif(substring(p.member_id from 'Cohort[^0-9]*([0-9]+)'), '')::int, 1),
       p.member_id,
       p.domain_id,
       'active'
from public.profiles p
where p.role = 'student' and p.member_id is not null
on conflict (user_id, cohort) do nothing;


-- ============================================================================
-- ===== supabase/126_fix_reenroll_member_id.sql =====
-- ============================================================================
-- 126_fix_reenroll_member_id.sql — Make re-enroll actually reissue the member ID, and repair any intern
-- left half-re-enrolled by the earlier (silently blocked) attempt. Run after 125. Idempotent; safe to re-run.
--
-- ROOT CAUSE
-- re_enroll_intern (125) archives the old enrollment, switches domain_id, and reissues member_id in one
-- UPDATE on profiles. It assumed migration 030 was live — 030 removed the blanket `member_id` lock from
-- protect_profile_columns so admins/founders may re-issue an ID. On this database 030 was never applied:
-- the live trigger is still the 029 version, whose final line `new.member_id := old.member_id` reverts ANY
-- member_id change. So on a real re-enroll the archive + domain switch committed, but the member_id reissue
-- was silently reverted. Result: the intern keeps their Cohort-1 ID while their department has moved — a
-- broken hybrid. Because the portal reads cohort from the ID text (lib/cohort.cohortOf → 'Cohort1'), they
-- still see the OLD cohort's tasks for the NEW department and still show under the old cohort's roster as
-- "No submission" (they have no submissions in the new department).
--
-- THIS MIGRATION
--   (1) (re)applies the intended protect_profile_columns — verbatim from migration 030, i.e. no blanket
--       member_id lock — so a founder's re-enroll UPDATE is no longer reverted.
--   (2) hardens re_enroll_intern: after the UPDATE it verifies the new id actually took and raises if not,
--       so the RPC can never again leave a half-applied hybrid (the whole call rolls back instead).
--   (3) one-time REPAIR: for any intern whose ACTIVE cohort_enrollment names a different member_id than
--       their profile (the signature of a prior blocked re-enroll), finish the move the re-enroll intended.
--       Non-re-enrolled interns (active enrollment == current id) are left untouched.

-- ── (1) correct column protection (verbatim from migration 030) ────────────────────────────────────────
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
    -- non-admin (intern): locked. phone stays editable; country/dial_code/member_id do NOT.
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
  -- (no blanket member_id lock anymore — admins/founders may re-issue an intern's ID)
  return new;
end; $$;

-- ── (2) harden re_enroll_intern: fail loudly if the reissue can't take ─────────────────────────────────
-- Same body as 125 plus a post-UPDATE guard. If column protection ever reverts the id again, the whole
-- transaction (archive + seq bump + update) rolls back and the founder gets a clear error instead of a
-- silently broken intern.
create or replace function public.re_enroll_intern(p_user uuid, p_domain_id int, p_cohort int default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_cohort     int;
  v_year       int := extract(year from now())::int;
  v_dept_key   text;
  v_dept_code  text;
  v_seq        int;
  v_new_id     text;
  v_old_id     text;
  v_old_domain int;
  v_old_cohort int;
  v_role       text;
  v_applied    text;
begin
  if not public.is_founder() then
    raise exception 'Only a founder can re-enroll an intern.';
  end if;

  select member_id, domain_id, role into v_old_id, v_old_domain, v_role
    from public.profiles where id = p_user;
  if not found then raise exception 'No such profile.'; end if;
  if v_role <> 'student' then raise exception 'Only student accounts can be re-enrolled.'; end if;

  -- Target cohort: explicit arg, else the founder-configured current_cohort (105), else 1.
  select coalesce(p_cohort, current_cohort, 1) into v_cohort from public.app_settings where id = true;
  v_cohort := coalesce(v_cohort, p_cohort, 1);
  if v_cohort < 1 or v_cohort > 99 then raise exception 'Cohort must be between 1 and 99.'; end if;

  select key into v_dept_key from public.domains where id = p_domain_id;
  if v_dept_key is null then raise exception 'Unknown domain %.', p_domain_id; end if;
  v_dept_code := public.dept_code_for(v_dept_key);
  if v_dept_code is null then raise exception 'Domain % has no member-ID department code.', v_dept_key; end if;

  -- Cohort the intern currently holds (parsed from the member_id label; null/legacy → 1).
  v_old_cohort := coalesce(nullif(substring(coalesce(v_old_id, '') from 'Cohort[^0-9]*([0-9]+)'), '')::int, 1);
  if v_old_cohort = v_cohort then
    raise exception 'Intern is already in cohort %.', v_cohort;
  end if;

  -- Archive the current enrollment as history (idempotent on re-run).
  insert into public.cohort_enrollments (user_id, cohort, member_id, domain_id, status, ended_at)
    values (p_user, v_old_cohort, v_old_id, v_old_domain, 'archived', now())
  on conflict (user_id, cohort) do update
    set status    = 'archived',
        ended_at  = now(),
        member_id = coalesce(public.cohort_enrollments.member_id, excluded.member_id),
        domain_id = coalesce(public.cohort_enrollments.domain_id, excluded.domain_id);

  -- Mint the new member ID for (year, target cohort, new department) — same sequence as handle_new_user.
  insert into public.member_id_seq (year, cohort, dept_code, last_seq)
    values (v_year, v_cohort, v_dept_code, 1)
    on conflict (year, cohort, dept_code) do update set last_seq = public.member_id_seq.last_seq + 1
    returning last_seq into v_seq;
  v_new_id := 'ZDR-' || v_year || '-Cohort' || v_cohort || '-' || v_dept_code || '-' || lpad(v_seq::text, 3, '0');

  -- Move the profile into the new cohort/domain and reactivate (030 permits a founder to reissue member_id).
  update public.profiles
     set domain_id = p_domain_id,
         member_id = v_new_id,
         is_alumni = false,
         status    = 'approved'
   where id = p_user;

  -- Guard: if column protection reverted the reissue, abort the whole re-enroll rather than leave a hybrid.
  select member_id into v_applied from public.profiles where id = p_user;
  if v_applied is distinct from v_new_id then
    raise exception
      'member_id could not be reissued (profiles column-protection is still blocking it). Apply migration 126 (which re-applies migration 030) and retry. No change was made.';
  end if;

  -- Record the new, active enrollment.
  insert into public.cohort_enrollments (user_id, cohort, member_id, domain_id, status)
    values (p_user, v_cohort, v_new_id, p_domain_id, 'active')
  on conflict (user_id, cohort) do update
    set member_id   = excluded.member_id,
        domain_id   = excluded.domain_id,
        status      = 'active',
        ended_at    = null,
        enrolled_at = now();

  perform public.log_admin_action(
    're_enroll_intern', p_user,
    'Re-enrolled into cohort ' || v_cohort || ' as ' || v_new_id || ' (was ' || coalesce(v_old_id, '—') || ')'
  );
  return v_new_id;
end; $$;
grant execute on function public.re_enroll_intern(uuid, int, int) to authenticated;

-- ── (3) one-time repair of interns left half-re-enrolled by the blocked attempt ────────────────────────
-- Runs from the SQL editor (auth.uid() null → protect_profile_columns bypasses). For each intern, take
-- their highest-cohort ACTIVE enrollment; if its member_id differs from the profile's, complete the move the
-- earlier re-enroll intended (reissue the id, switch to that department, reactivate). Interns whose active
-- enrollment already matches their profile — i.e. everyone who was never re-enrolled — are not touched.
update public.profiles p
set member_id = ce.member_id,
    domain_id = coalesce(ce.domain_id, p.domain_id),
    is_alumni = false,
    status    = 'approved'
from (
  select distinct on (user_id) user_id, member_id, domain_id
    from public.cohort_enrollments
   where status = 'active' and member_id is not null
   order by user_id, cohort desc, enrolled_at desc
) ce
where ce.user_id = p.id
  and ce.member_id is distinct from p.member_id;


-- ============================================================================
-- ===== supabase/127_reenroll_reset_payment.sql =====
-- ============================================================================
-- 127_reenroll_reset_payment.sql — A re-enrolled intern must pay the fee again for the new cohort.
-- Run after 126 (run order: 125 → 126 → 127). Idempotent; safe to re-run.
--
-- WHY
-- The Week-2 fee gate (117) lets an intern submit once profiles.payment_proof_url is not null. That column
-- lives on the single shared profile and nothing reset it on re-enroll, so a returning intern cleared the
-- Cohort-2 gate on their Cohort-1 proof. Policy: re-enrolling into a new cohort requires a fresh fee proof.
--
-- WHAT
--   (1) cohort_enrollments gains payment_proof_url / payment_proof_submitted_at / payment_confirmed, so the
--       Cohort-1 payment is PRESERVED as history on the archived enrollment row (founder's choice).
--   (2) re_enroll_intern (redefined — carries forward 126's reissue guard) now archives the old payment
--       onto the enrollment row, then nulls payment_proof_url + payment_proof_submitted_at and sets
--       payment_confirmed=false on the profile, so the fee card reappears and the gate re-arms for the new
--       cohort. The founder re-confirms after reviewing the new proof. (No app-code change: the Tasks fee
--       card and 117's trigger both key off payment_proof_url, which is now null again.)
--   (3) one-time repair for interns already re-enrolled under the old flow (currently just Taha): move their
--       lingering profile payment onto the archived enrollment, then clear it on the profile.

-- ── (1) preserve payment on the enrollment-history row ─────────────────────────────────────────────────
alter table public.cohort_enrollments add column if not exists payment_proof_url          text;
alter table public.cohort_enrollments add column if not exists payment_proof_submitted_at timestamptz;
alter table public.cohort_enrollments add column if not exists payment_confirmed          boolean;

-- ── (2) re_enroll_intern: archive the old payment, then reset it on the profile ────────────────────────
-- Body is migration 126's (founder gate, archive, mint id, reissue + post-UPDATE guard) plus payment
-- capture/reset. Redefining supersedes 126's definition — the guard is retained here on purpose.
create or replace function public.re_enroll_intern(p_user uuid, p_domain_id int, p_cohort int default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_cohort      int;
  v_year        int := extract(year from now())::int;
  v_dept_key    text;
  v_dept_code   text;
  v_seq         int;
  v_new_id      text;
  v_old_id      text;
  v_old_domain  int;
  v_old_cohort  int;
  v_role        text;
  v_applied     text;
  v_old_proof     text;
  v_old_proof_at  timestamptz;
  v_old_confirmed boolean;
begin
  if not public.is_founder() then
    raise exception 'Only a founder can re-enroll an intern.';
  end if;

  select member_id, domain_id, role, payment_proof_url, payment_proof_submitted_at, payment_confirmed
    into v_old_id, v_old_domain, v_role, v_old_proof, v_old_proof_at, v_old_confirmed
    from public.profiles where id = p_user;
  if not found then raise exception 'No such profile.'; end if;
  if v_role <> 'student' then raise exception 'Only student accounts can be re-enrolled.'; end if;

  -- Target cohort: explicit arg, else the founder-configured current_cohort (105), else 1.
  select coalesce(p_cohort, current_cohort, 1) into v_cohort from public.app_settings where id = true;
  v_cohort := coalesce(v_cohort, p_cohort, 1);
  if v_cohort < 1 or v_cohort > 99 then raise exception 'Cohort must be between 1 and 99.'; end if;

  select key into v_dept_key from public.domains where id = p_domain_id;
  if v_dept_key is null then raise exception 'Unknown domain %.', p_domain_id; end if;
  v_dept_code := public.dept_code_for(v_dept_key);
  if v_dept_code is null then raise exception 'Domain % has no member-ID department code.', v_dept_key; end if;

  -- Cohort the intern currently holds (parsed from the member_id label; null/legacy → 1).
  v_old_cohort := coalesce(nullif(substring(coalesce(v_old_id, '') from 'Cohort[^0-9]*([0-9]+)'), '')::int, 1);
  if v_old_cohort = v_cohort then
    raise exception 'Intern is already in cohort %.', v_cohort;
  end if;

  -- Archive the current enrollment as history, including the fee proof they submitted for it.
  insert into public.cohort_enrollments
      (user_id, cohort, member_id, domain_id, status, ended_at,
       payment_proof_url, payment_proof_submitted_at, payment_confirmed)
    values (p_user, v_old_cohort, v_old_id, v_old_domain, 'archived', now(),
            v_old_proof, v_old_proof_at, v_old_confirmed)
  on conflict (user_id, cohort) do update
    set status    = 'archived',
        ended_at  = now(),
        member_id = coalesce(public.cohort_enrollments.member_id, excluded.member_id),
        domain_id = coalesce(public.cohort_enrollments.domain_id, excluded.domain_id),
        payment_proof_url          = coalesce(public.cohort_enrollments.payment_proof_url, excluded.payment_proof_url),
        payment_proof_submitted_at = coalesce(public.cohort_enrollments.payment_proof_submitted_at, excluded.payment_proof_submitted_at),
        payment_confirmed          = coalesce(public.cohort_enrollments.payment_confirmed, excluded.payment_confirmed);

  -- Mint the new member ID for (year, target cohort, new department) — same sequence as handle_new_user.
  insert into public.member_id_seq (year, cohort, dept_code, last_seq)
    values (v_year, v_cohort, v_dept_code, 1)
    on conflict (year, cohort, dept_code) do update set last_seq = public.member_id_seq.last_seq + 1
    returning last_seq into v_seq;
  v_new_id := 'ZDR-' || v_year || '-Cohort' || v_cohort || '-' || v_dept_code || '-' || lpad(v_seq::text, 3, '0');

  -- Move into the new cohort/domain, reactivate, and RESET the fee: they must submit fresh proof for the
  -- new cohort (030/126 permit a founder to reissue member_id; payment columns aren't founder-locked).
  update public.profiles
     set domain_id = p_domain_id,
         member_id = v_new_id,
         is_alumni = false,
         status    = 'approved',
         payment_proof_url          = null,
         payment_proof_submitted_at = null,
         payment_confirmed          = false
   where id = p_user;

  -- Guard: if column protection reverted the reissue, abort the whole re-enroll rather than leave a hybrid.
  select member_id into v_applied from public.profiles where id = p_user;
  if v_applied is distinct from v_new_id then
    raise exception
      'member_id could not be reissued (profiles column-protection is still blocking it). Apply migration 126 (which re-applies migration 030) and retry. No change was made.';
  end if;

  -- Record the new, active enrollment (no payment yet — they pay for this cohort fresh).
  insert into public.cohort_enrollments (user_id, cohort, member_id, domain_id, status)
    values (p_user, v_cohort, v_new_id, p_domain_id, 'active')
  on conflict (user_id, cohort) do update
    set member_id   = excluded.member_id,
        domain_id   = excluded.domain_id,
        status      = 'active',
        ended_at    = null,
        enrolled_at = now();

  perform public.log_admin_action(
    're_enroll_intern', p_user,
    'Re-enrolled into cohort ' || v_cohort || ' as ' || v_new_id || ' (was ' || coalesce(v_old_id, '—') || '); fee reset'
  );
  return v_new_id;
end; $$;
grant execute on function public.re_enroll_intern(uuid, int, int) to authenticated;

-- ── (3) one-time repair: interns re-enrolled before this policy still carry their old fee proof ─────────
-- "Re-enrolled" == has an archived enrollment row (the backfill only ever creates 'active' rows, so an
-- archived row can only come from a prior re_enroll). Runs from the SQL editor (auth.uid() null → the
-- profiles trigger is bypassed). Step A preserves the lingering proof onto the most-recent archived
-- enrollment; step B then clears it on the profile so the intern re-pays for their current cohort.
update public.cohort_enrollments ce
set payment_proof_url          = p.payment_proof_url,
    payment_proof_submitted_at = p.payment_proof_submitted_at,
    payment_confirmed          = p.payment_confirmed
from public.profiles p
where ce.user_id = p.id
  and ce.status = 'archived'
  and ce.payment_proof_url is null
  and p.payment_proof_url is not null
  and ce.cohort = (select max(x.cohort) from public.cohort_enrollments x
                    where x.user_id = p.id and x.status = 'archived');

update public.profiles p
set payment_proof_url          = null,
    payment_proof_submitted_at = null,
    payment_confirmed          = false
where p.payment_proof_url is not null
  and exists (select 1 from public.cohort_enrollments a where a.user_id = p.id and a.status = 'archived');


-- ============================================================================
-- ===== supabase/128_cohort_history.sql =====
-- ============================================================================
-- 128_cohort_history.sql — Backend for the in-portal "Previous Cohort" history view (returning interns).
-- Run after 127 (order: 125 → 126 → 127 → 128). Idempotent; safe to re-run.
--
-- A re-enrolled intern can no longer read their OLD cohort's tasks (tasks_read RLS gates to my_cohort()),
-- and their certificate / LOR / best-intern flag live on the single profile (and would be overwritten when
-- they earn the new cohort's). To show a complete per-cohort history we:
--   (1) snapshot certificate_key / lor_key / is_best_intern onto the archived enrollment row (payment was
--       already snapshotted in 127),
--   (2) redefine re_enroll_intern to capture those at re-enroll time (carries forward 126's reissue guard
--       and 127's payment reset — redefining supersedes 127),
--   (3) add get_cohort_work(user, cohort): the intern's tasks + their own submissions/grades for a past
--       cohort, as a SECURITY DEFINER reader gated to the owner or an admin (so it can see past RLS),
--   (4) one-time backfill of the snapshot columns for interns already re-enrolled (e.g. Taha).
--
-- NOTE: the profile's certificate_key / lor_key / is_best_intern are intentionally NOT reset here — a
-- returning intern keeps their earned credentials until (if ever) they earn the new cohort's. Whether to
-- reset them for a fresh cohort is a separate decision (see the collision-audit caveats).

-- ── (1) per-cohort credential snapshot columns ─────────────────────────────────────────────────────────
alter table public.cohort_enrollments add column if not exists certificate_key text;
alter table public.cohort_enrollments add column if not exists lor_key         text;
alter table public.cohort_enrollments add column if not exists is_best_intern  boolean;

-- Re-create get_cohort_enrollments so its result rowtype picks up the columns added above (and in 127): a
-- SQL function declared `returns setof <table>` keeps the rowtype it was created with, so it raises
-- "structure of query does not match function result type" on the next call after ALTER TABLE ADD COLUMN.
-- Body is identical to migration 125.
create or replace function public.get_cohort_enrollments(p_user uuid)
returns setof public.cohort_enrollments language sql security definer set search_path = public stable as $$
  select * from public.cohort_enrollments
   where user_id = p_user
     and (p_user = auth.uid() or public.is_admin())
   order by cohort;
$$;
grant execute on function public.get_cohort_enrollments(uuid) to authenticated;

-- ── (2) re_enroll_intern: snapshot credentials alongside the existing payment archive ──────────────────
create or replace function public.re_enroll_intern(p_user uuid, p_domain_id int, p_cohort int default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_cohort      int;
  v_year        int := extract(year from now())::int;
  v_dept_key    text;
  v_dept_code   text;
  v_seq         int;
  v_new_id      text;
  v_old_id      text;
  v_old_domain  int;
  v_old_cohort  int;
  v_role        text;
  v_applied     text;
  v_old_proof     text;
  v_old_proof_at  timestamptz;
  v_old_confirmed boolean;
  v_old_cert    text;
  v_old_lor     text;
  v_old_best    boolean;
begin
  if not public.is_founder() then
    raise exception 'Only a founder can re-enroll an intern.';
  end if;

  select member_id, domain_id, role,
         payment_proof_url, payment_proof_submitted_at, payment_confirmed,
         certificate_key, lor_key, is_best_intern
    into v_old_id, v_old_domain, v_role,
         v_old_proof, v_old_proof_at, v_old_confirmed,
         v_old_cert, v_old_lor, v_old_best
    from public.profiles where id = p_user;
  if not found then raise exception 'No such profile.'; end if;
  if v_role <> 'student' then raise exception 'Only student accounts can be re-enrolled.'; end if;

  -- Target cohort: explicit arg, else the founder-configured current_cohort (105), else 1.
  select coalesce(p_cohort, current_cohort, 1) into v_cohort from public.app_settings where id = true;
  v_cohort := coalesce(v_cohort, p_cohort, 1);
  if v_cohort < 1 or v_cohort > 99 then raise exception 'Cohort must be between 1 and 99.'; end if;

  select key into v_dept_key from public.domains where id = p_domain_id;
  if v_dept_key is null then raise exception 'Unknown domain %.', p_domain_id; end if;
  v_dept_code := public.dept_code_for(v_dept_key);
  if v_dept_code is null then raise exception 'Domain % has no member-ID department code.', v_dept_key; end if;

  -- Cohort the intern currently holds (parsed from the member_id label; null/legacy → 1).
  v_old_cohort := coalesce(nullif(substring(coalesce(v_old_id, '') from 'Cohort[^0-9]*([0-9]+)'), '')::int, 1);
  if v_old_cohort = v_cohort then
    raise exception 'Intern is already in cohort %.', v_cohort;
  end if;

  -- Archive the current enrollment as history: member id, domain, fee proof, and earned credentials.
  insert into public.cohort_enrollments
      (user_id, cohort, member_id, domain_id, status, ended_at,
       payment_proof_url, payment_proof_submitted_at, payment_confirmed,
       certificate_key, lor_key, is_best_intern)
    values (p_user, v_old_cohort, v_old_id, v_old_domain, 'archived', now(),
            v_old_proof, v_old_proof_at, v_old_confirmed,
            v_old_cert, v_old_lor, v_old_best)
  on conflict (user_id, cohort) do update
    set status    = 'archived',
        ended_at  = now(),
        member_id = coalesce(public.cohort_enrollments.member_id, excluded.member_id),
        domain_id = coalesce(public.cohort_enrollments.domain_id, excluded.domain_id),
        payment_proof_url          = coalesce(public.cohort_enrollments.payment_proof_url, excluded.payment_proof_url),
        payment_proof_submitted_at = coalesce(public.cohort_enrollments.payment_proof_submitted_at, excluded.payment_proof_submitted_at),
        payment_confirmed          = coalesce(public.cohort_enrollments.payment_confirmed, excluded.payment_confirmed),
        certificate_key            = coalesce(public.cohort_enrollments.certificate_key, excluded.certificate_key),
        lor_key                    = coalesce(public.cohort_enrollments.lor_key, excluded.lor_key),
        is_best_intern             = coalesce(public.cohort_enrollments.is_best_intern, excluded.is_best_intern);

  -- Mint the new member ID for (year, target cohort, new department) — same sequence as handle_new_user.
  insert into public.member_id_seq (year, cohort, dept_code, last_seq)
    values (v_year, v_cohort, v_dept_code, 1)
    on conflict (year, cohort, dept_code) do update set last_seq = public.member_id_seq.last_seq + 1
    returning last_seq into v_seq;
  v_new_id := 'ZDR-' || v_year || '-Cohort' || v_cohort || '-' || v_dept_code || '-' || lpad(v_seq::text, 3, '0');

  -- Move into the new cohort/domain, reactivate, and reset the fee (they submit fresh proof for the new
  -- cohort). Credentials (certificate_key/lor_key/is_best_intern) are preserved on the profile.
  update public.profiles
     set domain_id = p_domain_id,
         member_id = v_new_id,
         is_alumni = false,
         status    = 'approved',
         payment_proof_url          = null,
         payment_proof_submitted_at = null,
         payment_confirmed          = false
   where id = p_user;

  -- Guard: if column protection reverted the reissue, abort the whole re-enroll rather than leave a hybrid.
  select member_id into v_applied from public.profiles where id = p_user;
  if v_applied is distinct from v_new_id then
    raise exception
      'member_id could not be reissued (profiles column-protection is still blocking it). Apply migration 126 (which re-applies migration 030) and retry. No change was made.';
  end if;

  -- Record the new, active enrollment (no payment/credentials yet — this cohort starts fresh).
  insert into public.cohort_enrollments (user_id, cohort, member_id, domain_id, status)
    values (p_user, v_cohort, v_new_id, p_domain_id, 'active')
  on conflict (user_id, cohort) do update
    set member_id   = excluded.member_id,
        domain_id   = excluded.domain_id,
        status      = 'active',
        ended_at    = null,
        enrolled_at = now();

  perform public.log_admin_action(
    're_enroll_intern', p_user,
    'Re-enrolled into cohort ' || v_cohort || ' as ' || v_new_id || ' (was ' || coalesce(v_old_id, '—') || '); fee reset'
  );
  return v_new_id;
end; $$;
grant execute on function public.re_enroll_intern(uuid, int, int) to authenticated;

-- ── (3) reader: a past cohort's tasks + the intern's own submissions/grades (past RLS) ──────────────────
-- SECURITY DEFINER + explicit owner/admin gate so a returning intern can read the OLD cohort's tasks that
-- tasks_read (120) now hides from them. One row per task of that cohort; submission fields are NULL when
-- they never submitted it. Marks are already on submissions (rubrics 047/108).
create or replace function public.get_cohort_work(p_user uuid, p_cohort int)
returns table (
  task_id            bigint,
  week               int,
  title              text,
  due_at             timestamptz,
  domain_id          int,
  status             text,
  submitted_at       timestamptz,
  graded_at          timestamptz,
  feedback           text,
  score_completeness numeric,
  score_accuracy     numeric,
  score_evidence     numeric,
  score_report       numeric,
  score_video        numeric,
  score_overall      numeric
) language sql security definer set search_path = public stable as $$
  select t.id, t.week, t.title, t.due_at, t.domain_id,
         s.status, s.submitted_at, s.graded_at, s.feedback,
         s.score_completeness, s.score_accuracy, s.score_evidence,
         s.score_report, s.score_video, s.score_overall
    from public.tasks t
    left join public.submissions s on s.task_id = t.id and s.user_id = p_user
   where t.cohort = p_cohort
     and (p_user = auth.uid() or public.is_admin())
   order by t.week, t.id;
$$;
grant execute on function public.get_cohort_work(uuid, int) to authenticated;

-- ── (4) one-time backfill: snapshot credentials for interns already re-enrolled under the old flow ─────
-- Copies the current profile credentials onto their most-recent archived enrollment (coalesce preserves any
-- already captured). Runs from the SQL editor (auth.uid() null → trigger bypassed). Only touches interns
-- that have an archived enrollment (i.e. were re-enrolled); everyone else is left alone.
update public.cohort_enrollments ce
set certificate_key = coalesce(ce.certificate_key, p.certificate_key),
    lor_key         = coalesce(ce.lor_key,         p.lor_key),
    is_best_intern  = coalesce(ce.is_best_intern,  p.is_best_intern)
from public.profiles p
where ce.user_id = p.id
  and ce.status = 'archived'
  and ce.cohort = (select max(x.cohort) from public.cohort_enrollments x
                    where x.user_id = p.id and x.status = 'archived');


-- ============================================================================
-- ===== supabase/129_cohort_work_domain_scope.sql =====
-- ============================================================================
-- 129_cohort_work_domain_scope.sql — Scope the Previous-Cohort history to the intern's OWN department
-- (and RAM tier) for that cohort. Run after 128. Idempotent; safe to re-run.
--
-- get_cohort_work (128) filtered only by cohort, so a past cohort's history listed EVERY department's tasks
-- — every department other than the intern's showed up as "No submission". Mirror the live tasks_read RLS
-- (120): include a task only when its department matches the intern's department FOR THAT COHORT (read from
-- the archived cohort_enrollments row, not the current profile — the department changes on re-enroll) and
-- its RAM tier matches the intern's. A submission they actually made is always included, so nothing they
-- turned in can ever be hidden by a later domain/RAM change.
--
-- Same signature as 128 (so `create or replace` just swaps the body); only the WHERE clause changes.

create or replace function public.get_cohort_work(p_user uuid, p_cohort int)
returns table (
  task_id            bigint,
  week               int,
  title              text,
  due_at             timestamptz,
  domain_id          int,
  status             text,
  submitted_at       timestamptz,
  graded_at          timestamptz,
  feedback           text,
  score_completeness numeric,
  score_accuracy     numeric,
  score_evidence     numeric,
  score_report       numeric,
  score_video        numeric,
  score_overall      numeric
) language sql security definer set search_path = public stable as $$
  select t.id, t.week, t.title, t.due_at, t.domain_id,
         s.status, s.submitted_at, s.graded_at, s.feedback,
         s.score_completeness, s.score_accuracy, s.score_evidence,
         s.score_report, s.score_video, s.score_overall
    from public.tasks t
    left join public.submissions s on s.task_id = t.id and s.user_id = p_user
   where t.cohort = p_cohort
     and (p_user = auth.uid() or public.is_admin())
     and (
       s.id is not null                                   -- always show what they actually submitted
       or (
         -- otherwise mirror the live task list: their cohort department + their RAM tier
         (t.domain_id is null or t.domain_id = (
            select ce.domain_id from public.cohort_enrollments ce
             where ce.user_id = p_user and ce.cohort = p_cohort
             limit 1))
         and (t.ram is null or t.ram = (select ram from public.profiles where id = p_user))
       )
     )
   order by t.week, t.id;
$$;
grant execute on function public.get_cohort_work(uuid, int) to authenticated;


-- ============================================================================
-- ===== supabase/130_task_scheduler.sql =====
-- ============================================================================
-- 130_task_scheduler.sql — schedule a task's release for a future date/time.
--
-- A task with a FUTURE publish_at is hidden from interns (RLS below) and its "now live" announcement +
-- email are DEFERRED: the cron /api/cron/publish-tasks fires them once the time arrives, exactly once per
-- task (announced_at guard). publish_at NULL = publish immediately — the legacy behaviour, unchanged, so
-- every task that exists today keeps working with no backfill.
--
-- Deploy note: the admin "Create task" flow only writes publish_at / created_by when a release is
-- actually scheduled, so immediate task creation keeps working even before this migration runs. Run this
-- before using the "Schedule release" field (and before the publish-tasks cron can do anything).

alter table public.tasks
  add column if not exists publish_at   timestamptz,          -- when the task becomes visible + notifies
  add column if not exists announced_at timestamptz,          -- set by the cron once it has notified
  add column if not exists created_by   uuid;                 -- who the deferred announcement posts as

-- ---- tasks visible to a student: now also gated on publish_at (admins still see all, to schedule/preview)
-- Mirrors tasks_read from 120_tasks_per_cohort.sql with an added "is it live yet?" clause. A NULL
-- publish_at means "already published" (every legacy row), so nothing is hidden by the backfill-free add.
drop policy if exists "tasks_read" on public.tasks;
create policy "tasks_read" on public.tasks
  for select to authenticated using (
    public.is_admin()
    or (
      (publish_at is null or publish_at <= now())
      and (domain_id is null or domain_id = (select domain_id from public.profiles where id = auth.uid()))
      and (ram is null or ram = (select ram from public.profiles where id = auth.uid()))
      and (cohort is null or cohort = public.my_cohort())
    )
  );

-- Fast lookup for the cron: tasks whose release has (or will) arrive but haven't been announced yet.
create index if not exists tasks_publish_pending on public.tasks (publish_at)
  where publish_at is not null and announced_at is null;


-- ============================================================================
-- ===== supabase/131_task_due_default.sql =====
-- ============================================================================
-- 131_task_due_default.sql — a task's deadline defaults to 7 days after it goes live.
--
-- Founders upload weekly tasks and the "Due date" field is optional; left blank, due_at was NULL and the
-- task never appeared on the intern Calendar (CalendarScreen fetches `.not(due_at is null)`). Per founder
-- request, a missing deadline now means "7 days after the task goes live", where go-live is the task's
-- publish_at (a scheduled release, migration 130) or, for an immediately-published task, its created_at.
--
-- Idempotent and independent of 130: re-adds publish_at with IF NOT EXISTS (a no-op once 130 has run), so
-- this is safe to run whether or not the scheduler migration is applied yet. Run after 129.

-- Ensure the column we read exists even if the scheduler migration (130) has not been applied yet.
alter table public.tasks add column if not exists publish_at timestamptz;

-- Backfill: every task with no deadline (e.g. Week-1 rows uploaded with the Due date left blank) gets
-- its go-live + 7 days. A scheduled task uses publish_at; an immediate one uses created_at.
update public.tasks
  set due_at = coalesce(publish_at, created_at) + interval '7 days'
  where due_at is null;

-- Going forward: fill due_at on insert whenever the admin leaves it blank. Column defaults (created_at's
-- now()) are applied before BEFORE-INSERT triggers fire, so new.created_at is already set here.
create or replace function public.task_default_due_at()
returns trigger language plpgsql as $$
begin
  if new.due_at is null then
    new.due_at := coalesce(new.publish_at, new.created_at, now()) + interval '7 days';
  end if;
  return new;
end; $$;

drop trigger if exists task_default_due_at on public.tasks;
create trigger task_default_due_at
  before insert on public.tasks
  for each row execute function public.task_default_due_at();

