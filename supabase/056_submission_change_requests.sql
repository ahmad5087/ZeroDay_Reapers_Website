-- 056_submission_change_requests.sql — a student must get a FOUNDER-approved change request before
-- replacing an existing submission (whether it is still pending review or was rejected). The very
-- first upload for a task is free; every later replacement consumes one approved request. Enforced
-- server-side in protect_submission() so it can't be bypassed by hitting the API directly.
-- Run after 055. Idempotent.

create table if not exists public.submission_change_requests (
  id          bigint generated always as identity primary key,
  task_id     bigint not null references public.tasks(id) on delete cascade,
  user_id     uuid   not null references public.profiles(id) on delete cascade,
  reason      text,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by  uuid references public.profiles(id),
  decided_at  timestamptz,
  consumed_at timestamptz,                 -- set when the approved request is spent on a re-upload
  created_at  timestamptz not null default now()
);

create index if not exists scr_lookup  on public.submission_change_requests (user_id, task_id, created_at desc);
create index if not exists scr_pending  on public.submission_change_requests (status, created_at desc);
-- Only one open (pending) request per task per student — stops request spam.
create unique index if not exists scr_one_pending
  on public.submission_change_requests (task_id, user_id) where status = 'pending';

alter table public.submission_change_requests enable row level security;

-- Student reads own requests; admins/founders read all (needed for the review queue).
drop policy if exists scr_select on public.submission_change_requests;
create policy scr_select on public.submission_change_requests
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Student creates their OWN request only, and only in the 'pending' state. Decisions go through the
-- founder RPC below (SECURITY DEFINER), so there is intentionally no client UPDATE policy —
-- a student can neither approve their own request nor mark it consumed.
drop policy if exists scr_insert on public.submission_change_requests;
create policy scr_insert on public.submission_change_requests
  for insert to authenticated with check (user_id = auth.uid() and status = 'pending');

-- Founder-only: approve or deny a change request (logged to the audit trail).
create or replace function public.founder_decide_change_request(p_request_id bigint, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r_user uuid; r_task bigint; r_status text;
begin
  if not public.is_founder() then raise exception 'founder only'; end if;
  select user_id, task_id, status into r_user, r_task, r_status
    from public.submission_change_requests where id = p_request_id;
  if r_user is null then raise exception 'request not found'; end if;
  if r_status <> 'pending' then raise exception 'request already decided'; end if;

  update public.submission_change_requests
     set status     = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_request_id;

  perform public.log_admin_action(
    case when p_approve then 'approve_change_request' else 'deny_change_request' end,
    r_user,
    'task_id=' || r_task);
end $$;

grant execute on function public.founder_decide_change_request(bigint, boolean) to authenticated;

-- Extend protect_submission (last set in 047): keep the "students can't self-grade" wipes, and add
-- the change-request gate. A non-admin UPDATE (i.e. replacing an existing row — the upsert in
-- TasksScreen fires this) is allowed ONLY when a founder-approved, unused request exists; that
-- request is then consumed so the next replacement needs a fresh approval. Plain INSERTs (the first
-- submission for a task) are untouched. Admins/founders bypass the whole block.
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

-- Trigger already exists from 002 (before insert or update); recreate defensively in case this
-- migration is applied to a database where it was dropped.
drop trigger if exists protect_submission_trg on public.submissions;
create trigger protect_submission_trg before insert or update on public.submissions
  for each row execute function public.protect_submission();

-- Realtime so the founder's change-request queue updates live (optional; harmless if already added).
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='submission_change_requests') then
    alter publication supabase_realtime add table public.submission_change_requests;
  end if;
end $$;
