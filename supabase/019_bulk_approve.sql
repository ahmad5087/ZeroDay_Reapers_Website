-- 019_bulk_approve.sql — admin bulk-approve submissions in one call.
-- SECURITY DEFINER, is_admin()-gated, logs to the audit trail. Idempotent.

create or replace function public.admin_bulk_approve_submissions(ids bigint[])
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.submissions
    set status = 'approved', graded_by = auth.uid(), graded_at = now()
    where id = any(ids) and status is distinct from 'approved';
  get diagnostics n = row_count;
  perform public.log_admin_action('bulk_approve_submissions', null, 'count=' || n);
  return n;
end $$;

grant execute on function public.admin_bulk_approve_submissions(bigint[]) to authenticated;
