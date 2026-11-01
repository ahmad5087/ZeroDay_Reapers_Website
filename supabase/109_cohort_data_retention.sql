-- 109_cohort_data_retention.sql — Cohort data-retention cleanup (founder-run, reusable). Idempotent.
--
-- Policy (Cohort 1): once every cohort member is an Alumni, keep their data 15 more days, then:
--   • DELETE their submitted WORK  — strip file_path/file_name/note on submissions + submission_files
--     and clear extracted submission_text; the actual R2 objects are removed by the API route.
--   • KEEP all grade data (status, feedback, score_*) so the Competency Matrix, Skill Passport and
--     certificate stay intact per-cohort after graduation.
--   • DELETE their group (domain) chat messages + the attachments they uploaded (R2 chat/{uid}/, via the route).
--   • DELETE their documents rows (resume/other); R2 objects removed by the route.
--   • KEEP their profile row and their DM thread with admins/founder — untouched.
--
-- Target set = non-admin, is_alumni = true, created_at < p_signup_before (so a later cohort whose
-- members auto-graduate on 6 approved tasks is never caught). Reusable: pass the next cohort's cutoff.

-- ========================= 1) alumni_at timestamp (graduation anchor) =========================
-- No graduation time was recorded before; add one and stamp it whenever is_alumni flips to true.
alter table public.profiles add column if not exists alumni_at timestamptz;

create or replace function public.stamp_alumni_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.is_alumni is distinct from old.is_alumni then
    new.alumni_at := case when new.is_alumni then coalesce(new.alumni_at, now()) else null end;
  end if;
  return new;
end; $$;

drop trigger if exists stamp_alumni_at_trg on public.profiles;
create trigger stamp_alumni_at_trg
  before update of is_alumni on public.profiles
  for each row execute function public.stamp_alumni_at();

-- Backfill already-graduated members (e.g. Cohort 1) at apply time. For a precise Cohort-1 anchor,
-- pass p_anchor explicitly to the cleanup function instead of relying on this backfill timestamp.
update public.profiles set alumni_at = now() where is_alumni = true and alumni_at is null;

-- ========================= 2) allow stripping version-history file refs =========================
-- submission_files.file_path is NOT NULL; retention needs to clear it while keeping the grade row.
alter table public.submission_files alter column file_path drop not null;

-- ========================= 3) the cleanup function (founder-only) =========================
create or replace function public.cleanup_cohort_intern_data(
  p_signup_before timestamptz,              -- cohort cutoff: target = non-admin alumni who signed up before this
  p_retain_days   int        default 15,    -- days to keep after the LAST member graduates
  p_dry_run       boolean    default true,  -- true = report only, make no changes
  p_anchor        timestamptz default null  -- override graduation anchor; default = max(alumni_at) of target set
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_is_founder  boolean;
  v_targets     uuid[];
  v_count       int;
  v_ungrad      int;
  v_anchor      timestamptz;
  v_eligible_at timestamptz;
  v_subs        int;
  v_subfiles    int;
  v_msgs        int;
  v_docs        int;
  v_result      jsonb;
begin
  -- Founder only.
  select is_founder into v_is_founder from public.profiles where id = auth.uid();
  if not coalesce(v_is_founder, false) then
    raise exception 'Only a founder may run cohort data retention cleanup.';
  end if;

  if p_signup_before is null then
    raise exception 'p_signup_before (cohort signup cutoff) is required.';
  end if;
  if p_retain_days is null or p_retain_days < 0 then
    raise exception 'p_retain_days must be >= 0.';
  end if;

  -- Readiness gate: no cohort member may still be a non-alumni intern.
  select count(*) into v_ungrad
  from public.profiles
  where role <> 'admin' and created_at < p_signup_before and is_alumni = false;
  if v_ungrad > 0 then
    raise exception 'Cohort not fully graduated: % member(s) still active (is_alumni = false).', v_ungrad;
  end if;

  -- Target set: graduated, non-admin, signed up before the cutoff.
  select array_agg(id) into v_targets
  from public.profiles
  where role <> 'admin' and is_alumni = true and created_at < p_signup_before;
  v_count := coalesce(array_length(v_targets, 1), 0);

  if v_count = 0 then
    return jsonb_build_object('ok', true, 'targets', 0, 'note', 'No matching cohort members; nothing to do.');
  end if;

  -- Retention anchor (= last graduation, or explicit override). Reported always; the 15-day window
  -- is ENFORCED only on a real run below, so a dry run can preview the plan at any time.
  v_anchor := coalesce(
    p_anchor,
    (select max(alumni_at) from public.profiles
      where role <> 'admin' and is_alumni = true and created_at < p_signup_before)
  );
  if v_anchor is not null then
    v_eligible_at := v_anchor + ((p_retain_days::text) || ' days')::interval;
  end if;

  -- What will be affected (valid for both the dry run and the real run that follows it).
  select count(*) into v_subs     from public.submissions     where user_id = any(v_targets);
  select count(*) into v_subfiles from public.submission_files where user_id = any(v_targets);
  select count(*) into v_msgs     from public.messages        where user_id = any(v_targets);
  select count(*) into v_docs     from public.documents       where user_id = any(v_targets);

  v_result := jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'targets', v_count,
    'target_ids', to_jsonb(v_targets),
    'anchor', v_anchor,
    'eligible_at', v_eligible_at,
    'window_elapsed', (v_eligible_at is not null and now() >= v_eligible_at),
    'submissions_stripped', v_subs,
    'submission_files_stripped', v_subfiles,
    'group_messages_deleted', v_msgs,
    'documents_deleted', v_docs
  );

  if p_dry_run then
    return v_result || jsonb_build_object('note', 'DRY RUN — no changes made.');
  end if;

  -- Real run: now enforce the graduation anchor and the 15-day retention window.
  if v_anchor is null then
    raise exception 'Cannot determine graduation anchor (alumni_at is null); pass p_anchor explicitly.';
  end if;
  if now() < v_eligible_at then
    raise exception 'Retention window not elapsed. Eligible at % (anchor % + % days).',
      v_eligible_at, v_anchor, p_retain_days;
  end if;

  -- ===================== DESTRUCTIVE (grades kept; work removed) =====================
  -- Strip submitted work + student free-text from the latest-pointer rows (keep grade columns).
  update public.submissions
     set file_path = null, file_name = null, note = null
   where user_id = any(v_targets);

  -- Strip version-history file refs (keep status/feedback/score_* → Competency Matrix & Passport).
  update public.submission_files
     set file_path = null, file_name = null
   where user_id = any(v_targets);

  -- Clear extracted submission text used for similarity (it is a copy of their submitted work).
  if to_regclass('public.submission_text') is not null then
    delete from public.submission_text st
     using public.submissions s
     where st.submission_id = s.id and s.user_id = any(v_targets);
  end if;

  -- Delete group (domain) chat messages authored by cohort members.
  delete from public.messages where user_id = any(v_targets);

  -- Delete documents (resume/other) rows; R2 objects removed by the caller.
  delete from public.documents where user_id = any(v_targets);

  -- Intentionally untouched: dm_messages, profiles, and all grade/score/feedback columns.
  return v_result || jsonb_build_object('note', 'Cleanup applied.');
end; $$;

-- Lock down execution: founder check is inside the function; never expose to anon.
revoke all on function public.cleanup_cohort_intern_data(timestamptz, int, boolean, timestamptz) from public;
revoke all on function public.cleanup_cohort_intern_data(timestamptz, int, boolean, timestamptz) from anon;
grant execute on function public.cleanup_cohort_intern_data(timestamptz, int, boolean, timestamptz) to authenticated;
