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
