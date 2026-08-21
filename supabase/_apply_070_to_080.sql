-- Combined apply bundle: migrations 070-080, in order. GENERATED convenience file.
-- Apply on STAGING first if possible. All additive + idempotent; every feature ships behind an OFF flag.
-- After applying: npm install (adds @simplewebauthn/*, pdf-parse, react-markdown), then flip flags per HANDOFF.md.

-- ================================= supabase/070_risk_cases.sql =================================
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


-- ================================= supabase/071_feature_flags.sql =================================
-- 071_feature_flags.sql — Per-feature on/off switches so new work ships dark and a founder flips it
-- on when ready. An extensible key/value companion to app_settings (055). Run after 070. Idempotent.
--
-- Any authenticated user may READ the flags (the client gates UI from them). Only a founder writes,
-- through set_feature_flag(). is_feature_enabled(key) is a SECURITY DEFINER helper usable inside RLS
-- and other functions. Unknown keys read as false (disabled).

create table if not exists public.feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  label       text,                       -- human description for the admin toggle list
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

alter table public.feature_flags enable row level security;

drop policy if exists "feature_flags_read" on public.feature_flags;
create policy "feature_flags_read" on public.feature_flags
  for select to authenticated using (true);
-- No client writes — founders change flags only through set_feature_flag().

-- Seed the roadmap feature keys (all OFF). Safe to re-run: existing rows keep their current state.
insert into public.feature_flags (key, label) values
  ('interventions',          'Intervention case management (Phase 1)'),
  ('competency_matrix',      'Competency matrix & skill passport (Phase 2)'),
  ('resource_library',       'Resource & knowledge library (Phase 3)'),
  ('weekly_digest',          'Weekly cohort digest & action center (Phase 3)'),
  ('office_hours',           'Mentor office hours & booking (Phase 4)'),
  ('passkeys',               'WebAuthn passkey authentication (Phase 5)'),
  ('submission_similarity',  'Content-based submission similarity (Phase 6)'),
  ('alumni_board',           'Alumni opportunities board (Phase 7)'),
  ('case_studies',           'Public case studies & publishing (Phase 7)'),
  ('client_portal',          'Website lead & client portal (Phase 8)')
on conflict (key) do nothing;

-- Read a flag (unknown → false). SECURITY DEFINER so it also works inside RLS / other definer fns.
create or replace function public.is_feature_enabled(p_key text)
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce((select enabled from public.feature_flags where key = p_key), false);
$$;
grant execute on function public.is_feature_enabled(text) to authenticated;

-- Founder-only: flip a flag (audit-logged). Creates the key if it doesn't exist yet.
create or replace function public.set_feature_flag(p_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Only a founder can change feature flags.';
  end if;
  insert into public.feature_flags (key, enabled, updated_at, updated_by)
  values (p_key, coalesce(p_enabled, false), now(), auth.uid())
  on conflict (key) do update
    set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
  perform public.log_admin_action('set_feature_flag', null, p_key || '=' || coalesce(p_enabled, false)::text);
end; $$;
grant execute on function public.set_feature_flag(text, boolean) to authenticated;


-- ================================= supabase/072_notifications.sql =================================
-- 072_notifications.sql — One shared, persistent notifications feed any feature can write to
-- (case follow-ups, weekly digest, booking reminders, opportunities). The existing Notification
-- Center (NotificationsScreen) aggregates mentions/announcements/grades live; this table is the
-- durable, per-user store new features push into. Run after 071. Idempotent.
--
-- A user reads and marks read ONLY their own rows. Inserts come from an admin (a case → notify the
-- intern) or the service role (the digest cron). auth.uid() IS NULL is the service-role bypass,
-- matching the convention in 028 (protect_profile_columns / guard_staff_delete).

create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null default 'generic'
              check (kind in ('generic','case','digest','booking','resource','opportunity','system')),
  title       text not null check (char_length(title) between 1 and 200),
  body        text check (body is null or char_length(body) <= 2000),
  link        text,                                    -- optional in-portal route/anchor to open
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_time   on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

-- Read your own notifications only.
drop policy if exists "notifications_read_own" on public.notifications;
create policy "notifications_read_own" on public.notifications
  for select to authenticated using (user_id = auth.uid());
-- No client insert/update/delete — writes go through the RPCs below (mark-read is own-row only).

-- Push a notification to one user. Allowed for any admin, or the service role (auth.uid() null).
create or replace function public.push_notification(
  p_user uuid, p_title text, p_body text default null, p_kind text default 'generic', p_link text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_kind not in ('generic','case','digest','booking','resource','opportunity','system') then
    raise exception 'bad kind';
  end if;
  insert into public.notifications (user_id, kind, title, body, link)
  values (p_user, p_kind, p_title, p_body, p_link)
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.push_notification(uuid, text, text, text, text) to authenticated;

-- Mark one of MY notifications read.
create or replace function public.mark_notification_read(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.notifications set read_at = now()
   where id = p_id and user_id = auth.uid() and read_at is null;
end; $$;
grant execute on function public.mark_notification_read(bigint) to authenticated;

-- Mark ALL of MY notifications read.
create or replace function public.mark_all_notifications_read()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null;
end; $$;
grant execute on function public.mark_all_notifications_read() to authenticated;


-- ================================= supabase/073_resource_library.sql =================================
-- 073_resource_library.sql — Department/week resource & knowledge library with full-text search,
-- bookmarks, and completion tracking. Run after 072. Idempotent. Gated in-app by `resource_library`.
--
-- Admins publish resources (is_published); everyone authenticated reads published rows, admins also
-- see drafts. Bookmarks/progress are per-user (own rows via RLS). Resource writes go through admin
-- RPCs (audit-logged). "Versioning" is a version counter bumped on edit (full history is a later add).

create table if not exists public.resources (
  id           bigint generated always as identity primary key,
  title        text not null check (char_length(title) between 1 and 200),
  description  text check (description is null or char_length(description) <= 2000),
  kind         text not null default 'link' check (kind in ('guide','recording','template','tool','link')),
  url          text,                          -- external link, or null when the file lives in R2
  r2_key       text,                          -- uploaded file key in R2, or null
  domain_id    int references public.domains(id) on delete set null,   -- null = all departments
  week         int check (week is null or (week between 0 and 52)),
  version      int not null default 1,
  is_published boolean not null default false,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  search       tsvector generated always as (
                 to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))
               ) stored
);
create index if not exists resources_pub    on public.resources (is_published, domain_id, week);
create index if not exists resources_search on public.resources using gin (search);

create table if not exists public.resource_bookmarks (
  user_id     uuid   not null references public.profiles(id) on delete cascade,
  resource_id bigint not null references public.resources(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, resource_id)
);

create table if not exists public.resource_progress (
  user_id      uuid   not null references public.profiles(id) on delete cascade,
  resource_id  bigint not null references public.resources(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, resource_id)
);

alter table public.resources          enable row level security;
alter table public.resource_bookmarks enable row level security;
alter table public.resource_progress  enable row level security;

-- Read: published rows to everyone; drafts to admins. No client writes (admins use the RPCs below).
drop policy if exists "resources_read" on public.resources;
create policy "resources_read" on public.resources
  for select to authenticated using (is_published or public.is_admin());

-- Bookmarks / progress: users manage their own rows.
drop policy if exists "bookmarks_rw" on public.resource_bookmarks;
create policy "bookmarks_rw" on public.resource_bookmarks
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "progress_rw" on public.resource_progress;
create policy "progress_rw" on public.resource_progress
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Admin: create (p_id null) or update a resource. Bumps version + updated_at on edit.
create or replace function public.upsert_resource(
  p_id bigint, p_title text, p_description text, p_kind text, p_url text, p_r2_key text,
  p_domain_id int, p_week int, p_publish boolean)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_kind not in ('guide','recording','template','tool','link') then raise exception 'bad kind'; end if;
  if char_length(coalesce(p_title,'')) < 1 then raise exception 'title required'; end if;

  if p_id is null then
    insert into public.resources (title, description, kind, url, r2_key, domain_id, week,
                                  is_published, published_by, published_at, created_by)
    values (p_title, p_description, p_kind, p_url, p_r2_key, p_domain_id, p_week,
            coalesce(p_publish, false),
            case when coalesce(p_publish, false) then auth.uid() end,
            case when coalesce(p_publish, false) then now() end,
            auth.uid())
    returning id into v_id;
    perform public.log_admin_action('create_resource', null, p_title);
  else
    update public.resources set
      title = p_title, description = p_description, kind = p_kind, url = p_url, r2_key = p_r2_key,
      domain_id = p_domain_id, week = p_week, version = version + 1, updated_at = now(),
      is_published = coalesce(p_publish, is_published),
      published_by = case when coalesce(p_publish, false) and not is_published then auth.uid() else published_by end,
      published_at = case when coalesce(p_publish, false) and published_at is null then now() else published_at end
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'no such resource'; end if;
    perform public.log_admin_action('update_resource', null, p_title);
  end if;
  return v_id;
end; $$;
grant execute on function public.upsert_resource(bigint, text, text, text, text, text, int, int, boolean) to authenticated;

create or replace function public.set_resource_published(p_id bigint, p_published boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.resources set
    is_published = coalesce(p_published, false),
    published_by = case when coalesce(p_published, false) then auth.uid() else published_by end,
    published_at = case when coalesce(p_published, false) and published_at is null then now() else published_at end,
    updated_at = now()
  where id = p_id;
  perform public.log_admin_action(case when coalesce(p_published, false) then 'publish_resource' else 'unpublish_resource' end, null, p_id::text);
end; $$;
grant execute on function public.set_resource_published(bigint, boolean) to authenticated;

create or replace function public.delete_resource(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  delete from public.resources where id = p_id;
  perform public.log_admin_action('delete_resource', null, p_id::text);
end; $$;
grant execute on function public.delete_resource(bigint) to authenticated;


-- ================================= supabase/074_weekly_digest.sql =================================
-- 074_weekly_digest.sql — idempotency log for the weekly cohort digest cron. Run after 073.
-- The digest is composed in app/api/cron/weekly-digest (service role, reads across RLS); this table
-- just guarantees each intern is emailed at most once per ISO week. Idempotent.

create table if not exists public.weekly_digest_log (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  week_of  date not null,               -- Monday (UTC) of the ISO week the digest covers
  sent_at  timestamptz not null default now(),
  primary key (user_id, week_of)
);
create index if not exists weekly_digest_log_week on public.weekly_digest_log (week_of);

alter table public.weekly_digest_log enable row level security;
-- Written only by the service-role cron (bypasses RLS); no client write policy. Admins may read it.
drop policy if exists "digest_log_read" on public.weekly_digest_log;
create policy "digest_log_read" on public.weekly_digest_log
  for select to authenticated using (public.is_admin());


-- ================================= supabase/075_office_hours.sql =================================
-- 075_office_hours.sql — Mentor office hours & booking (Phase 4). Run after 074. Idempotent.
-- Distinct from live_sessions (group RSVP, 025/062): these are limited-capacity slots an intern books
-- with a question. Admins create slots (RLS admin-write, like live_sessions). Bookings go through
-- capacity-checked SECURITY DEFINER RPCs. A no-show can auto-open a Phase-1 risk case. Flag: office_hours.

create table if not exists public.office_hour_slots (
  id           bigint generated always as identity primary key,
  mentor_id    uuid references public.profiles(id) on delete set null,
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  capacity     int not null default 1 check (capacity between 1 and 100),
  join_url     text,
  location     text,
  domain_id    int references public.domains(id) on delete set null,  -- null = all departments
  notes        text,
  booked_count int not null default 0,                                -- maintained by trigger, for display
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists office_hour_slots_time on public.office_hour_slots (starts_at);

create table if not exists public.office_hour_bookings (
  id         bigint generated always as identity primary key,
  slot_id    bigint not null references public.office_hour_slots(id) on delete cascade,
  intern_id  uuid   not null references public.profiles(id) on delete cascade,
  question   text check (question is null or char_length(question) <= 1000),
  status     text not null default 'booked' check (status in ('booked','cancelled','attended','no_show')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slot_id, intern_id)
);
create index if not exists office_hour_bookings_slot on public.office_hour_bookings (slot_id, status);
create index if not exists office_hour_bookings_intern on public.office_hour_bookings (intern_id);

alter table public.office_hour_slots    enable row level security;
alter table public.office_hour_bookings enable row level security;

-- Slots: read yours-or-global (like live_sessions); admins create/update/delete directly.
drop policy if exists "office_slots_read" on public.office_hour_slots;
create policy "office_slots_read" on public.office_hour_slots
  for select to authenticated using (
    public.is_admin()
    or domain_id is null
    or domain_id = (select domain_id from public.profiles where id = auth.uid())
  );
drop policy if exists "office_slots_admin_write" on public.office_hour_slots;
create policy "office_slots_admin_write" on public.office_hour_slots
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Bookings: read your own (or admin). All writes go through the RPCs below (no client write policy).
drop policy if exists "office_bookings_read" on public.office_hour_bookings;
create policy "office_bookings_read" on public.office_hour_bookings
  for select to authenticated using (intern_id = auth.uid() or public.is_admin());

-- Keep slot.booked_count in sync with active bookings (for capacity display).
create or replace function public.recount_office_hour_slot()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid bigint;
begin
  sid := coalesce(new.slot_id, old.slot_id);
  update public.office_hour_slots
     set booked_count = (select count(*) from public.office_hour_bookings
                          where slot_id = sid and status in ('booked','attended'))
   where id = sid;
  return null;
end; $$;
drop trigger if exists office_hour_bookings_recount on public.office_hour_bookings;
create trigger office_hour_bookings_recount
  after insert or update or delete on public.office_hour_bookings
  for each row execute function public.recount_office_hour_slot();

-- Intern books a slot (capacity-checked, serialized per slot). Re-activates a cancelled booking.
create or replace function public.book_office_hour(p_slot bigint, p_question text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_cap int; v_start timestamptz; v_mentor uuid; v_count int; v_id bigint; v_status text; a_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(p_slot);                       -- serialize concurrent bookings for this slot
  select capacity, starts_at, mentor_id into v_cap, v_start, v_mentor from public.office_hour_slots where id = p_slot;
  if v_cap is null then raise exception 'no such slot'; end if;
  if v_start <= now() then raise exception 'this slot has already started'; end if;

  select id, status into v_id, v_status from public.office_hour_bookings where slot_id = p_slot and intern_id = auth.uid();
  select count(*) into v_count from public.office_hour_bookings where slot_id = p_slot and status in ('booked','attended');

  if v_id is not null then
    if v_status <> 'cancelled' then raise exception 'you already booked this slot'; end if;
    if v_count >= v_cap then raise exception 'slot is full'; end if;
    update public.office_hour_bookings set status = 'booked', question = coalesce(p_question, question), updated_at = now() where id = v_id;
  else
    if v_count >= v_cap then raise exception 'slot is full'; end if;
    insert into public.office_hour_bookings (slot_id, intern_id, question) values (p_slot, auth.uid(), p_question) returning id into v_id;
  end if;

  if v_mentor is not null then                                 -- notify the mentor (definer insert bypasses RLS)
    select display_name into a_name from public.profiles where id = auth.uid();
    insert into public.notifications (user_id, kind, title, body)
    values (v_mentor, 'booking', 'New office-hours booking', coalesce(a_name, 'An intern') || ' booked your slot.');
  end if;
  return v_id;
end; $$;
grant execute on function public.book_office_hour(bigint, text) to authenticated;

create or replace function public.cancel_office_hour_booking(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.office_hour_bookings set status = 'cancelled', updated_at = now()
   where id = p_id and intern_id = auth.uid() and status <> 'cancelled';
end; $$;
grant execute on function public.cancel_office_hour_booking(bigint) to authenticated;

-- Admin marks attendance. A no-show optionally opens a Phase-1 risk case (guarded — interventions optional).
create or replace function public.mark_office_hour_attendance(p_booking bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_intern uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('booked','attended','no_show') then raise exception 'bad status'; end if;
  update public.office_hour_bookings set status = p_status, updated_at = now()
   where id = p_booking returning intern_id into v_intern;
  if v_intern is null then raise exception 'no such booking'; end if;
  perform public.log_admin_action('office_hour_attendance', v_intern, p_status);
  if p_status = 'no_show' then
    begin
      perform public.open_risk_case(v_intern, 'inactivity', 'medium', 'Missed a booked office-hours session.');
    exception when others then null;  -- interventions (070) is optional; never block attendance marking
    end;
  end if;
end; $$;
grant execute on function public.mark_office_hour_attendance(bigint, text) to authenticated;


-- ================================= supabase/076_webauthn.sql =================================
-- 076_webauthn.sql — Real WebAuthn passkeys (Phase 5). Run after 075. Idempotent. Flag: passkeys.
-- Credentials + short-lived challenges + hashed recovery codes, verified server-side in
-- app/api/webauthn/* with @simplewebauthn/server (service role). ADDITIVE: password login and
-- recovery codes always remain, so a user can never be locked out. Login step-up is per-user
-- opt-in via profiles.passkey_required (default false) — passwordless session-minting is deferred.

alter table public.profiles add column if not exists passkey_required boolean not null default false;

create table if not exists public.webauthn_credentials (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  credential_id text not null unique,          -- base64url credential id
  public_key    text not null,                 -- base64url of the COSE public key
  counter       bigint not null default 0,
  transports    text[],
  device_type   text,
  backed_up     boolean,
  nickname      text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists webauthn_credentials_user on public.webauthn_credentials (user_id);

create table if not exists public.webauthn_challenges (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles(id) on delete cascade,
  challenge  text not null,
  kind       text not null check (kind in ('register','auth')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists webauthn_challenges_user on public.webauthn_challenges (user_id, kind, created_at desc);

create table if not exists public.recovery_codes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  code_hash  text not null,                    -- sha256 hex of the plaintext code
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists recovery_codes_user on public.recovery_codes (user_id) where used_at is null;

alter table public.webauthn_credentials enable row level security;
alter table public.webauthn_challenges  enable row level security;
alter table public.recovery_codes       enable row level security;

-- Credentials: read your own (or admin), delete your own. Inserts/updates only via service-role routes.
drop policy if exists "webauthn_cred_read" on public.webauthn_credentials;
create policy "webauthn_cred_read" on public.webauthn_credentials
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "webauthn_cred_del" on public.webauthn_credentials;
create policy "webauthn_cred_del" on public.webauthn_credentials
  for delete to authenticated using (user_id = auth.uid());

-- Challenges + recovery codes: NO client policy (service-role routes only). RLS on with no policy
-- means authenticated clients cannot read/write; the service role bypasses RLS. This keeps the
-- recovery code_hash values unreadable by clients.

-- How many unused recovery codes the caller has (for the settings UI — never exposes the hashes).
create or replace function public.recovery_codes_remaining()
returns int language sql security definer set search_path = public stable as $$
  select count(*)::int from public.recovery_codes where user_id = auth.uid() and used_at is null;
$$;
grant execute on function public.recovery_codes_remaining() to authenticated;


-- ================================= supabase/077_submission_similarity.sql =================================
-- 077_submission_similarity.sql — Content-based submission similarity (Phase 6). Run after 076. Idempotent.
-- Extracted PDF text + a MinHash fingerprint per submission, plus admin-visible similarity pairs with
-- matched passages + a confidence score. Extraction/compare run in app/api/similarity/extract (service
-- role). Admin-only, HUMAN-IN-THE-LOOP: this flags for review, it never auto-penalizes. Flag: submission_similarity.

create table if not exists public.submission_text (
  submission_id bigint primary key references public.submissions(id) on delete cascade,
  content       text,
  char_len      int,
  minhash       bigint[],
  extracted_at  timestamptz not null default now()
);

create table if not exists public.similarity_pairs (
  id          bigint generated always as identity primary key,
  a_id        bigint not null references public.submissions(id) on delete cascade,
  b_id        bigint not null references public.submissions(id) on delete cascade,
  a_label     text,
  b_label     text,
  score       numeric not null default 0,               -- estimated Jaccard, 0..1
  matched     jsonb   not null default '[]'::jsonb,      -- shared passages, denormalized for the UI
  dismissed   boolean not null default false,
  computed_at timestamptz not null default now(),
  unique (a_id, b_id)
);
create index if not exists similarity_pairs_score on public.similarity_pairs (dismissed, score desc);

alter table public.submission_text  enable row level security;
alter table public.similarity_pairs enable row level security;

-- Admin-only read. Inserts/updates via the service-role extraction route (bypasses RLS).
drop policy if exists "submission_text_admin" on public.submission_text;
create policy "submission_text_admin" on public.submission_text
  for select to authenticated using (public.is_admin());

drop policy if exists "similarity_pairs_admin" on public.similarity_pairs;
create policy "similarity_pairs_admin" on public.similarity_pairs
  for select to authenticated using (public.is_admin());

-- Admin dismisses / restores a flagged pair (audit-logged).
create or replace function public.set_similarity_dismissed(p_id bigint, p_dismissed boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.similarity_pairs set dismissed = coalesce(p_dismissed, true) where id = p_id;
  perform public.log_admin_action(case when coalesce(p_dismissed, true) then 'dismiss_similarity' else 'restore_similarity' end, null, p_id::text);
end; $$;
grant execute on function public.set_similarity_dismissed(bigint, boolean) to authenticated;


-- ================================= supabase/078_alumni_board.sql =================================
-- 078_alumni_board.sql — Alumni opportunities board (Phase 7, #7). Run after 077. Idempotent.
-- Jobs / referrals / competitions / certifications / volunteer projects. Admins publish (admin-write
-- RLS, like live_sessions); interns + alumni browse published ones, save, and track applications.
-- Flag: alumni_board.

create table if not exists public.opportunities (
  id           bigint generated always as identity primary key,
  type         text not null default 'job' check (type in ('job','referral','competition','certification','volunteer')),
  title        text not null check (char_length(title) between 1 and 200),
  org          text,
  link         text,
  description  text check (description is null or char_length(description) <= 4000),
  location     text,
  posted_by    uuid references public.profiles(id) on delete set null,
  expires_at   timestamptz,
  is_published boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists opportunities_pub on public.opportunities (is_published, created_at desc);

create table if not exists public.opportunity_saves (
  user_id        uuid   not null references public.profiles(id) on delete cascade,
  opportunity_id bigint not null references public.opportunities(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (user_id, opportunity_id)
);

create table if not exists public.applications (
  id             bigint generated always as identity primary key,
  opportunity_id bigint not null references public.opportunities(id) on delete cascade,
  user_id        uuid   not null references public.profiles(id) on delete cascade,
  status         text not null default 'applied' check (status in ('saved','applied','interview','offer','rejected','withdrawn')),
  notes          text check (notes is null or char_length(notes) <= 2000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (opportunity_id, user_id)
);
create index if not exists applications_user on public.applications (user_id, updated_at desc);

alter table public.opportunities     enable row level security;
alter table public.opportunity_saves enable row level security;
alter table public.applications       enable row level security;

-- Opportunities: read published (or admin); admins create/update/delete directly.
drop policy if exists "opportunities_read" on public.opportunities;
create policy "opportunities_read" on public.opportunities
  for select to authenticated using (is_published or public.is_admin());
drop policy if exists "opportunities_admin_write" on public.opportunities;
create policy "opportunities_admin_write" on public.opportunities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Saves + applications: users own their rows (admins may read applications).
drop policy if exists "opp_saves_rw" on public.opportunity_saves;
create policy "opp_saves_rw" on public.opportunity_saves
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "applications_rw" on public.applications;
create policy "applications_rw" on public.applications
  for all to authenticated using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid());

create or replace function public.touch_application()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists touch_application_trg on public.applications;
create trigger touch_application_trg before update on public.applications
  for each row execute function public.touch_application();


-- ================================= supabase/079_posts.sql =================================
-- 079_posts.sql — Public case studies & knowledge publishing (Phase 7, #10). Run after 078. Idempotent.
-- Admin-authored posts (case studies / research / advisories / success stories) with SEO metadata,
-- rendered on the public site at /insights. Published posts are readable by ANON; drafts by admins
-- only. Admins write via admin-write RLS. Flag: case_studies.

create table if not exists public.posts (
  id           bigint generated always as identity primary key,
  type         text not null default 'case_study' check (type in ('case_study','research','advisory','success_story')),
  slug         text not null unique,
  title        text not null check (char_length(title) between 1 and 200),
  excerpt      text check (excerpt is null or char_length(excerpt) <= 500),
  body         text,                                   -- markdown
  cover_key    text,                                   -- optional R2 key
  seo_meta     jsonb not null default '{}'::jsonb,
  status       text not null default 'draft' check (status in ('draft','published')),
  author_id    uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists posts_pub on public.posts (status, published_at desc);

alter table public.posts enable row level security;

-- Published posts are public (anon + authenticated); drafts are admin-only. No `to` clause = all roles.
drop policy if exists "posts_read" on public.posts;
create policy "posts_read" on public.posts
  for select using (status = 'published' or public.is_admin());

-- Admins create/update/delete (anon can't — not authenticated).
drop policy if exists "posts_admin_write" on public.posts;
create policy "posts_admin_write" on public.posts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Ensure the public API role can read (RLS still gates rows to published).
grant select on public.posts to anon, authenticated;

create or replace function public.touch_post()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  if new.status = 'published' and new.published_at is null then new.published_at := now(); end if;
  return new;
end $$;
drop trigger if exists touch_post_trg on public.posts;
create trigger touch_post_trg before insert or update on public.posts
  for each row execute function public.touch_post();


-- ================================= supabase/080_client_portal.sql =================================
-- 080_client_portal.sql — Website lead & client portal (Phase 8, #9). Run after 079. Idempotent.
-- Structured service requests (scope questionnaire) replacing plain contact inquiries, an admin
-- pipeline (status + proposal), and a TOKEN-GATED client engagement view — no separate auth system:
-- each request carries a secret access_token and the client opens /engagement/<token>. Flag: client_portal.
--
-- SECURITY NOTES: the token is a bearer secret in the URL (anyone with the link can view). Binary
-- document exchange over R2 is a DEFERRED follow-up that warrants its own security review; this MVP
-- shares documents as links via engagement updates. All public access goes through the two RPCs below.

create table if not exists public.service_requests (
  id              bigint generated always as identity primary key,
  access_token    text not null unique,
  name            text,
  email           text,
  org             text,
  title           text not null,
  scope           jsonb not null default '{}'::jsonb,   -- questionnaire answers
  status          text not null default 'new'  check (status in ('new','triage','scoping','proposal','active','closed')),
  proposal_status text not null default 'none' check (proposal_status in ('none','draft','sent','accepted','declined')),
  proposal_amount numeric,
  proposal_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists service_requests_status on public.service_requests (status, created_at desc);

create table if not exists public.engagement_updates (
  id                bigint generated always as identity primary key,
  request_id        bigint not null references public.service_requests(id) on delete cascade,
  body              text,
  kind              text not null default 'update' check (kind in ('update','proposal','document','status')),
  link              text,                                -- shared link for kind='document'
  visible_to_client boolean not null default true,
  author_id         uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists engagement_updates_req on public.engagement_updates (request_id, created_at desc);

alter table public.service_requests   enable row level security;
alter table public.engagement_updates enable row level security;

-- Admin-only direct access. The public interacts ONLY through the SECURITY DEFINER RPCs below.
drop policy if exists "service_requests_admin" on public.service_requests;
create policy "service_requests_admin" on public.service_requests
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "engagement_updates_admin" on public.engagement_updates;
create policy "engagement_updates_admin" on public.engagement_updates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.touch_service_request()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists touch_service_request_trg on public.service_requests;
create trigger touch_service_request_trg before update on public.service_requests
  for each row execute function public.touch_service_request();

-- Public intake: create a request from the website, return the secret engagement token.
create or replace function public.submit_service_request(p_name text, p_email text, p_org text, p_title text, p_scope jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if char_length(coalesce(p_title, '')) < 1 or char_length(coalesce(p_email, '')) < 3 then
    raise exception 'title and email are required';
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.service_requests (access_token, name, email, org, title, scope)
  values (v_token, left(p_name, 120), left(p_email, 180), left(p_org, 180), left(p_title, 200), coalesce(p_scope, '{}'::jsonb));
  return v_token;
end; $$;
grant execute on function public.submit_service_request(text, text, text, text, jsonb) to anon, authenticated;

-- Token-gated read for the client engagement page (no login). Returns null for an unknown token.
create or replace function public.get_engagement(p_token text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare r public.service_requests;
begin
  select * into r from public.service_requests where access_token = p_token;
  if r.id is null then return null; end if;
  return jsonb_build_object(
    'title', r.title, 'name', r.name, 'org', r.org, 'status', r.status,
    'proposal_status', r.proposal_status, 'proposal_amount', r.proposal_amount, 'proposal_note', r.proposal_note,
    'created_at', r.created_at,
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('body', u.body, 'kind', u.kind, 'link', u.link, 'created_at', u.created_at) order by u.created_at desc)
      from public.engagement_updates u where u.request_id = r.id and u.visible_to_client), '[]'::jsonb)
  );
end; $$;
grant execute on function public.get_engagement(text) to anon, authenticated;


