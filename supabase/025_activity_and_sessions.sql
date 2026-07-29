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
