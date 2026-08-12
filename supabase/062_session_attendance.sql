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
