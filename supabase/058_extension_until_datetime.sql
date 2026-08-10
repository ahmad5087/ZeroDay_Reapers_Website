-- 058_extension_until_datetime.sql — grant a task extension by an explicit deadline (date + time)
-- instead of a number of days. Run after 057. Idempotent.
--
-- Replaces admin_grant_extension(bigint, uuid, int) with admin_grant_extension(bigint, uuid,
-- timestamptz): the founder now sets the exact moment the extension runs until, and that value is
-- stored verbatim in extended_until (no more "original due + N days" math). The old int overload is
-- dropped so there's a single, unambiguous signature.

drop function if exists public.admin_grant_extension(bigint, uuid, int);

create or replace function public.admin_grant_extension(p_task_id bigint, p_user_id uuid, p_until timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare v_existing bigint;
begin
  if not public.is_founder() then raise exception 'founder only'; end if;
  if p_until is null then raise exception 'an extension date is required'; end if;
  if not exists (select 1 from public.tasks where id = p_task_id) then raise exception 'task not found'; end if;

  -- Reuse the intern's latest still-pending request for this task if one exists; otherwise mint an
  -- already-approved row. Either way the newest row for (task,user) ends up approved with p_until.
  select id into v_existing from public.task_extension_requests
    where task_id = p_task_id and user_id = p_user_id and status = 'pending'
    order by created_at desc limit 1;

  if v_existing is not null then
    update public.task_extension_requests
       set status = 'approved', extended_until = p_until, decided_by = auth.uid(), decided_at = now()
     where id = v_existing;
  else
    insert into public.task_extension_requests
      (task_id, user_id, reason, status, extended_until, decided_by, decided_at)
    values
      (p_task_id, p_user_id, 'Granted by founder', 'approved', p_until, auth.uid(), now());
  end if;

  perform public.log_admin_action(
    'grant_extension', p_user_id,
    'task_id=' || p_task_id || ' until '
      || to_char(p_until at time zone 'Asia/Karachi', 'YYYY-MM-DD HH24:MI') || ' PKT (founder-initiated)');
end $$;

grant execute on function public.admin_grant_extension(bigint, uuid, timestamptz) to authenticated;
