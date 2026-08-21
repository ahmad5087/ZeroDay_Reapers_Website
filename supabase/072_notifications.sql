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
