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
