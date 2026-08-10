-- 057_founder_grant_extension.sql — founder-initiated task extensions. Run after 056. Idempotent.
--
-- Until now, an extension only existed as a reaction to a student's request (admin_decide_extension
-- operates on an existing row, and the ter_insert RLS policy only lets a user create their OWN
-- request). This adds a founder-only RPC that PROACTIVELY grants a specific intern extra time on a
-- specific task — no prior request needed. If the intern already has a pending request for that
-- task, it approves that row instead of creating a duplicate, so the pending queue stays clean.

create or replace function public.admin_grant_extension(p_task_id bigint, p_user_id uuid, p_extra_days int default 7)
returns void language plpgsql security definer set search_path = public as $$
declare r_due timestamptz; v_days int; v_new_due timestamptz; v_existing bigint;
begin
  if not public.is_founder() then raise exception 'founder only'; end if;

  v_days := greatest(1, coalesce(p_extra_days, 7));
  select due_at into r_due from public.tasks where id = p_task_id;
  if not found then raise exception 'task not found'; end if;
  -- Extension deadline is measured from the task's original due date (or now if it had none),
  -- matching admin_decide_extension so both paths compute extended_until identically.
  v_new_due := coalesce(r_due, now()) + make_interval(days => v_days);

  -- Reuse the intern's latest still-pending request for this task if one exists; otherwise mint an
  -- already-approved row. Either way the newest row for (task,user) ends up approved with the new due.
  select id into v_existing from public.task_extension_requests
    where task_id = p_task_id and user_id = p_user_id and status = 'pending'
    order by created_at desc limit 1;

  if v_existing is not null then
    update public.task_extension_requests
       set status = 'approved', extended_until = v_new_due, decided_by = auth.uid(), decided_at = now()
     where id = v_existing;
  else
    insert into public.task_extension_requests
      (task_id, user_id, reason, status, extended_until, decided_by, decided_at)
    values
      (p_task_id, p_user_id, 'Granted by founder', 'approved', v_new_due, auth.uid(), now());
  end if;

  perform public.log_admin_action(
    'grant_extension', p_user_id,
    'task_id=' || p_task_id || ' +' || v_days || 'd (founder-initiated)');
end $$;

grant execute on function public.admin_grant_extension(bigint, uuid, int) to authenticated;
