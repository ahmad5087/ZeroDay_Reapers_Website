-- 070_risk_cases.sql — Intervention Case Management. Turn the computed "at-risk / Cohort Health"
-- label into a managed workflow: assign a mentor, choose a risk reason, record outreach, keep
-- PRIVATE staff notes, set a follow-up date, and resolve. Run after 069. Idempotent.
--
-- Design notes:
--  * "At risk" is today derived CLIENT-SIDE in AdminPanel (cohortHealth useMemo) from overdue /
--    rejected / zero-approved signals — there is no server record. These tables are the first
--    server representation, so a case persists across reloads and is shared across all admins.
--  * Rows are STAFF-ONLY and never visible to the intern: RLS grants SELECT to public.is_admin()
--    (founders inherit via is_admin), and every mutation flows through a SECURITY DEFINER RPC —
--    so there is deliberately NO client insert/update/delete policy (same hardening pattern as
--    admin_actions in 014 and message_reports).
--  * Every RPC audit-logs via public.log_admin_action(...) AND appends a timeline event.
--  * risk_reason values mirror the real client scoring signals plus manual reasons.

-- ============================== TABLES ==============================

create table if not exists public.risk_cases (
  id           bigint generated always as identity primary key,
  intern_id    uuid not null references public.profiles(id) on delete cascade,
  opened_by    uuid references public.profiles(id) on delete set null,
  mentor_id    uuid references public.profiles(id) on delete set null,
  risk_reason  text not null default 'other'
               check (risk_reason in ('overdue_tasks','rejected_work','no_approved_work','inactivity','unpaid_fee','late_comer','other')),
  severity     text not null default 'medium' check (severity in ('low','medium','high')),
  status       text not null default 'open'   check (status in ('open','monitoring','resolved')),
  summary      text check (summary is null or char_length(summary) <= 2000),
  follow_up_at timestamptz,
  opened_at    timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles(id) on delete set null,
  resolution   text check (resolution is null or char_length(resolution) <= 2000)
);
create index if not exists risk_cases_status_time on public.risk_cases (status, opened_at desc);
create index if not exists risk_cases_intern      on public.risk_cases (intern_id);
create index if not exists risk_cases_followup    on public.risk_cases (follow_up_at) where status <> 'resolved';
-- At most one ACTIVE (non-resolved) case per intern — prevents duplicates.
create unique index if not exists risk_cases_one_active on public.risk_cases (intern_id) where status <> 'resolved';

create table if not exists public.risk_case_notes (
  id          bigint generated always as identity primary key,
  case_id     bigint not null references public.risk_cases(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  author_name text,                                   -- snapshot: survives author deletion
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists risk_case_notes_case on public.risk_case_notes (case_id, created_at desc);

create table if not exists public.risk_case_events (
  id         bigint generated always as identity primary key,
  case_id    bigint not null references public.risk_cases(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  actor_name text,                                    -- snapshot
  kind       text not null
             check (kind in ('email','dm','call','meeting','status_change','mentor_assigned','note_added','follow_up_set','opened','system')),
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists risk_case_events_case on public.risk_case_events (case_id, created_at desc);

-- ===================== RLS: staff read-only; writes via RPC only =====================
-- SELECT limited to admins/founders. All writes go through the SECURITY DEFINER RPCs below
-- (which bypass RLS), so there is intentionally NO client insert/update/delete policy.

alter table public.risk_cases       enable row level security;
alter table public.risk_case_notes  enable row level security;
alter table public.risk_case_events enable row level security;

drop policy if exists "risk_cases_read" on public.risk_cases;
create policy "risk_cases_read" on public.risk_cases
  for select to authenticated using (public.is_admin());

drop policy if exists "risk_case_notes_read" on public.risk_case_notes;
create policy "risk_case_notes_read" on public.risk_case_notes
  for select to authenticated using (public.is_admin());

drop policy if exists "risk_case_events_read" on public.risk_case_events;
create policy "risk_case_events_read" on public.risk_case_events
  for select to authenticated using (public.is_admin());

-- ============================== HELPERS ==============================
-- Append a timeline event, snapshotting the caller's name. Internal: called only from the RPCs
-- below (each runs as SECURITY DEFINER, so no separate grant is required).
create or replace function public.risk_case_add_event(p_case bigint, p_kind text, p_detail text)
returns void language plpgsql security definer set search_path = public as $$
declare a_name text;
begin
  select display_name into a_name from public.profiles where id = auth.uid();
  insert into public.risk_case_events (case_id, actor_id, actor_name, kind, detail)
  values (p_case, auth.uid(), a_name, p_kind, p_detail);
end; $$;

-- ===================== RPCs (admin-gated, audit-logged) =====================

-- Open a case, or return the existing active one for that intern (idempotent for the "Open case" button).
create or replace function public.open_risk_case(
  p_intern uuid,
  p_reason text default 'other',
  p_severity text default 'medium',
  p_summary text default null,
  p_mentor uuid default null,
  p_follow_up timestamptz default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_reason not in ('overdue_tasks','rejected_work','no_approved_work','inactivity','unpaid_fee','late_comer','other')
    then raise exception 'bad reason'; end if;
  if p_severity not in ('low','medium','high') then raise exception 'bad severity'; end if;

  -- one active case per intern
  select id into v_id from public.risk_cases where intern_id = p_intern and status <> 'resolved' limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.risk_cases (intern_id, opened_by, mentor_id, risk_reason, severity, summary, follow_up_at)
  values (p_intern, auth.uid(), p_mentor, p_reason, p_severity, p_summary, p_follow_up)
  returning id into v_id;

  perform public.risk_case_add_event(v_id, 'opened', 'reason=' || p_reason || ', severity=' || p_severity);
  if p_mentor is not null then perform public.risk_case_add_event(v_id, 'mentor_assigned', null); end if;
  perform public.log_admin_action('open_risk_case', p_intern, p_reason);
  return v_id;
end; $$;

create or replace function public.assign_case_mentor(p_case bigint, p_mentor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_intern uuid; m_name text;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.risk_cases set mentor_id = p_mentor where id = p_case returning intern_id into v_intern;
  if v_intern is null then raise exception 'no such case'; end if;
  select display_name into m_name from public.profiles where id = p_mentor;
  perform public.risk_case_add_event(p_case, 'mentor_assigned', m_name);
  perform public.log_admin_action('assign_case_mentor', v_intern, m_name);
end; $$;

create or replace function public.add_case_note(p_case bigint, p_body text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_intern uuid; a_name text;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if char_length(coalesce(p_body, '')) < 1 then raise exception 'empty note'; end if;
  select intern_id into v_intern from public.risk_cases where id = p_case;
  if v_intern is null then raise exception 'no such case'; end if;
  select display_name into a_name from public.profiles where id = auth.uid();
  insert into public.risk_case_notes (case_id, author_id, author_name, body)
  values (p_case, auth.uid(), a_name, p_body) returning id into v_id;
  perform public.risk_case_add_event(p_case, 'note_added', null);
  perform public.log_admin_action('add_case_note', v_intern, null);
  return v_id;
end; $$;

-- Record an outreach touch (email / DM / call / meeting). For email, the client also calls
-- notifyUser() to actually send; this RPC just records that it happened on the timeline.
create or replace function public.log_case_outreach(p_case bigint, p_kind text, p_detail text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_intern uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_kind not in ('email','dm','call','meeting') then raise exception 'bad outreach kind'; end if;
  select intern_id into v_intern from public.risk_cases where id = p_case;
  if v_intern is null then raise exception 'no such case'; end if;
  perform public.risk_case_add_event(p_case, p_kind, p_detail);
  perform public.log_admin_action('case_outreach', v_intern, p_kind);
end; $$;

create or replace function public.set_case_status(p_case bigint, p_status text, p_resolution text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_intern uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('open','monitoring','resolved') then raise exception 'bad status'; end if;
  update public.risk_cases
     set status      = p_status,
         resolved_at = case when p_status = 'resolved' then now()      else null end,
         resolved_by = case when p_status = 'resolved' then auth.uid() else null end,
         resolution  = case when p_status = 'resolved' then p_resolution else null end
   where id = p_case returning intern_id into v_intern;
  if v_intern is null then raise exception 'no such case'; end if;
  perform public.risk_case_add_event(p_case, 'status_change', p_status);
  perform public.log_admin_action('set_case_status', v_intern, p_status);
end; $$;

create or replace function public.set_case_follow_up(p_case bigint, p_when timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare v_intern uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.risk_cases set follow_up_at = p_when where id = p_case returning intern_id into v_intern;
  if v_intern is null then raise exception 'no such case'; end if;
  perform public.risk_case_add_event(p_case, 'follow_up_set',
    case when p_when is null then null else to_char(p_when at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC' end);
  perform public.log_admin_action('set_case_follow_up', v_intern, null);
end; $$;

-- ============================== GRANTS ==============================
grant execute on function public.open_risk_case(uuid, text, text, text, uuid, timestamptz) to authenticated;
grant execute on function public.assign_case_mentor(bigint, uuid)               to authenticated;
grant execute on function public.add_case_note(bigint, text)                    to authenticated;
grant execute on function public.log_case_outreach(bigint, text, text)          to authenticated;
grant execute on function public.set_case_status(bigint, text, text)            to authenticated;
grant execute on function public.set_case_follow_up(bigint, timestamptz)        to authenticated;

-- Follow-up reminders: a scheduled job (Vercel Cron, service role) scans
--   select * from public.risk_cases where status <> 'resolved' and follow_up_at <= now();
-- and notifies the mentor — added in the Phase-3/Phase-0 scheduler work, not here.
