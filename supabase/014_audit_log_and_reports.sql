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
