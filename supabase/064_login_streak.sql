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
