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

