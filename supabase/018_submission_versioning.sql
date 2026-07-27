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
