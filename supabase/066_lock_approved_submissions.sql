-- 066_lock_approved_submissions.sql — once an intern's submission for a task (week) is APPROVED by an
-- admin/founder, that week is LOCKED for the intern: they can no longer upload a new version, replace
-- the submission, request a submission change, or request extra time for it. Admins/founders keep full
-- control (grading overrides, founder-granted extensions). The instant a submission is approved, any of
-- that intern's still-pending change/extension requests — plus an approved-but-unused change grant — are
-- auto-cancelled so they drop out of the review queues. Enforced server-side so it can't be bypassed by
-- hitting the API directly. Mirrors the client guard in TasksScreen. Run after 065. Idempotent.

-- 1) Allow a terminal 'cancelled' state on both request tables (used by the auto-cancel trigger below).
--    Drop whatever status CHECK exists (name may vary across environments) and re-add the widened one.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.submission_change_requests'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop execute format('alter table public.submission_change_requests drop constraint %I', c); end loop;
  alter table public.submission_change_requests
    add constraint submission_change_requests_status_check
    check (status in ('pending','approved','rejected','cancelled'));

  for c in
    select conname from pg_constraint
     where conrelid = 'public.task_extension_requests'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop execute format('alter table public.task_extension_requests drop constraint %I', c); end loop;
  alter table public.task_extension_requests
    add constraint task_extension_requests_status_check
    check (status in ('pending','approved','rejected','cancelled'));
end $$;

-- 2) Extend protect_submission (last set in 056): keep the "students can't self-grade" wipes and the
--    change-request gate, and add the approved-lock. A non-admin UPDATE whose EXISTING row is already
--    'approved' is refused outright — no unused change request can re-open it. (Founders/admins still
--    bypass the whole block, so a founder can override a verdict from the Admin Panel.)
create or replace function public.protect_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_req_id bigint;
begin
  if not public.is_admin() then
    new.status             := 'submitted';
    new.feedback           := null;
    new.graded_by          := null;
    new.graded_at          := null;
    new.score_completeness := null;
    new.score_accuracy     := null;
    new.score_evidence     := null;
    new.score_report       := null;

    if tg_op = 'UPDATE' then
      -- Approved is final for the intern: the week is locked, no replacement ever.
      if old.status = 'approved' then
        raise exception 'SUBMISSION_APPROVED_LOCKED: This week''s submission has been approved and can no longer be replaced.'
          using errcode = 'check_violation';
      end if;

      select r.id into v_req_id
        from public.submission_change_requests r
       where r.task_id = new.task_id
         and r.user_id = new.user_id
         and r.status  = 'approved'
         and r.consumed_at is null
       order by r.decided_at asc nulls last, r.id asc
       limit 1;

      if v_req_id is null then
        raise exception 'CHANGE_REQUEST_REQUIRED: A founder-approved change request is required before you can replace this submission.'
          using errcode = 'check_violation';
      end if;

      update public.submission_change_requests
         set consumed_at = now()
       where id = v_req_id;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists protect_submission_trg on public.submissions;
create trigger protect_submission_trg before insert or update on public.submissions
  for each row execute function public.protect_submission();

-- 3) Block a student from opening a NEW change/extension request once the week's submission is approved.
--    Admins/founders bypass (their SECURITY DEFINER RPCs, e.g. admin_grant_extension, still work).
create or replace function public.block_request_when_approved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and exists (
    select 1 from public.submissions s
     where s.task_id = new.task_id and s.user_id = new.user_id and s.status = 'approved'
  ) then
    raise exception 'SUBMISSION_APPROVED_LOCKED: This week''s submission has been approved — you can no longer request a change or extra time for it.'
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

drop trigger if exists scr_block_when_approved on public.submission_change_requests;
create trigger scr_block_when_approved before insert on public.submission_change_requests
  for each row execute function public.block_request_when_approved();

drop trigger if exists ter_block_when_approved on public.task_extension_requests;
create trigger ter_block_when_approved before insert on public.task_extension_requests
  for each row execute function public.block_request_when_approved();

-- 4) When a submission flips to 'approved' (grading, bulk-approve, any admin path), void that intern's
--    still-open requests for the task so they leave the review queues. A change grant that was approved
--    but never spent is revoked too; already-decided extensions stay as the historical record.
create or replace function public.cancel_requests_on_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.submission_change_requests
     set status = 'cancelled', decided_at = coalesce(decided_at, now())
   where task_id = new.task_id and user_id = new.user_id
     and (status = 'pending' or (status = 'approved' and consumed_at is null));

  update public.task_extension_requests
     set status = 'cancelled', decided_at = coalesce(decided_at, now())
   where task_id = new.task_id and user_id = new.user_id
     and status = 'pending';

  return new;
end; $$;

drop trigger if exists cancel_requests_on_approval_trg on public.submissions;
create trigger cancel_requests_on_approval_trg
  after update of status on public.submissions
  for each row when (new.status = 'approved' and old.status is distinct from 'approved')
  execute function public.cancel_requests_on_approval();
