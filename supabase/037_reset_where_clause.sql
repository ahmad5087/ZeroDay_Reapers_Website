-- 037_reset_where_clause.sql — make the founder reset RPCs work under pg-safeupdate.
-- Run after 036. Idempotent.
--
-- WHY: the database has the `safeupdate` (pg-safeupdate) extension active, which rejects any
-- DELETE/UPDATE that has no WHERE clause with the error: "DELETE requires a WHERE clause".
-- The guard fires even inside SECURITY DEFINER functions (it hooks the executor), so both
-- reset_member_id_counters() and reset_portal() failed on their unqualified DELETEs.
--
-- FIX: give every full-table DELETE an always-true predicate. We use `ctid is not null` (a system
-- column present on every row) rather than `where true`, because the planner const-folds `true`
-- away — which would leave the plan with no qual and STILL trip the guard. `ctid is not null`
-- survives planning and matches every row, so the semantics are identical to an unqualified DELETE.

-- ============ FOUNDER: reset the ID counters (next signup = -001 everywhere) ============
create or replace function public.reset_member_id_counters()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'Only a founder can reset ID counters.'; end if;
  delete from public.member_id_seq where ctid is not null;   -- next insert re-creates each dept at 1
  perform public.log_admin_action('reset_id_counters', null, 'zeroed all department counters');
end; $$;
grant execute on function public.reset_member_id_counters() to authenticated;

-- ============ FOUNDER: full portal reset (fresh cohort) ============
-- Keeps: Founder/Admin/Alumni accounts, the Alumni-room chat, Testimonials & Feedback.
-- Aborts if the Alumni domain is missing (else the "keep alumni room" filter would wipe all messages).
create or replace function public.reset_portal()
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_alumni_id int;
begin
  if not public.is_founder() then raise exception 'Only a founder can reset the portal.'; end if;
  select id into v_alumni_id from public.domains where key = 'alumni';
  if v_alumni_id is null then
    raise exception 'Alumni domain not found — aborting reset to avoid deleting all messages.';
  end if;

  delete from public.messages where domain_id is distinct from v_alumni_id;  -- keep the alumni room (already qualified)
  delete from public.announcements where ctid is not null;
  delete from public.dm_messages where ctid is not null;

  delete from public.submissions where ctid is not null;              -- submission_files cascade
  delete from public.task_extension_requests where ctid is not null;
  delete from public.task_deadline_reminders where ctid is not null;
  delete from public.tasks where ctid is not null;

  delete from public.live_sessions where ctid is not null;
  delete from public.kicked_emails where ctid is not null;
  delete from public.member_id_seq where ctid is not null;

  -- Remove current interns (non-alumni students). Founder/Admin/Alumni preserved. Approved
  -- testimonials survive because feedback.user_id is ON DELETE SET NULL (migration 035).
  delete from auth.users where id in (
    select id from public.profiles where role = 'student' and coalesce(is_alumni, false) = false
  );

  perform public.log_admin_action('reset_portal', null, 'full portal reset (kept founder/admin/alumni + alumni chat + feedback)');
end; $$;
grant execute on function public.reset_portal() to authenticated;
