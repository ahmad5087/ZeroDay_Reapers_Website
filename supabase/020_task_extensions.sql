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
