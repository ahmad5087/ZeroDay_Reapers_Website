-- 128_cohort_history.sql — Backend for the in-portal "Previous Cohort" history view (returning interns).
-- Run after 127 (order: 125 → 126 → 127 → 128). Idempotent; safe to re-run.
--
-- A re-enrolled intern can no longer read their OLD cohort's tasks (tasks_read RLS gates to my_cohort()),
-- and their certificate / LOR / best-intern flag live on the single profile (and would be overwritten when
-- they earn the new cohort's). To show a complete per-cohort history we:
--   (1) snapshot certificate_key / lor_key / is_best_intern onto the archived enrollment row (payment was
--       already snapshotted in 127),
--   (2) redefine re_enroll_intern to capture those at re-enroll time (carries forward 126's reissue guard
--       and 127's payment reset — redefining supersedes 127),
--   (3) add get_cohort_work(user, cohort): the intern's tasks + their own submissions/grades for a past
--       cohort, as a SECURITY DEFINER reader gated to the owner or an admin (so it can see past RLS),
--   (4) one-time backfill of the snapshot columns for interns already re-enrolled (e.g. Taha).
--
-- NOTE: the profile's certificate_key / lor_key / is_best_intern are intentionally NOT reset here — a
-- returning intern keeps their earned credentials until (if ever) they earn the new cohort's. Whether to
-- reset them for a fresh cohort is a separate decision (see the collision-audit caveats).

-- ── (1) per-cohort credential snapshot columns ─────────────────────────────────────────────────────────
alter table public.cohort_enrollments add column if not exists certificate_key text;
alter table public.cohort_enrollments add column if not exists lor_key         text;
alter table public.cohort_enrollments add column if not exists is_best_intern  boolean;

-- Re-create get_cohort_enrollments so its result rowtype picks up the columns added above (and in 127): a
-- SQL function declared `returns setof <table>` keeps the rowtype it was created with, so it raises
-- "structure of query does not match function result type" on the next call after ALTER TABLE ADD COLUMN.
-- Body is identical to migration 125.
create or replace function public.get_cohort_enrollments(p_user uuid)
returns setof public.cohort_enrollments language sql security definer set search_path = public stable as $$
  select * from public.cohort_enrollments
   where user_id = p_user
     and (p_user = auth.uid() or public.is_admin())
   order by cohort;
$$;
grant execute on function public.get_cohort_enrollments(uuid) to authenticated;

-- ── (2) re_enroll_intern: snapshot credentials alongside the existing payment archive ──────────────────
create or replace function public.re_enroll_intern(p_user uuid, p_domain_id int, p_cohort int default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_cohort      int;
  v_year        int := extract(year from now())::int;
  v_dept_key    text;
  v_dept_code   text;
  v_seq         int;
  v_new_id      text;
  v_old_id      text;
  v_old_domain  int;
  v_old_cohort  int;
  v_role        text;
  v_applied     text;
  v_old_proof     text;
  v_old_proof_at  timestamptz;
  v_old_confirmed boolean;
  v_old_cert    text;
  v_old_lor     text;
  v_old_best    boolean;
begin
  if not public.is_founder() then
    raise exception 'Only a founder can re-enroll an intern.';
  end if;

  select member_id, domain_id, role,
         payment_proof_url, payment_proof_submitted_at, payment_confirmed,
         certificate_key, lor_key, is_best_intern
    into v_old_id, v_old_domain, v_role,
         v_old_proof, v_old_proof_at, v_old_confirmed,
         v_old_cert, v_old_lor, v_old_best
    from public.profiles where id = p_user;
  if not found then raise exception 'No such profile.'; end if;
  if v_role <> 'student' then raise exception 'Only student accounts can be re-enrolled.'; end if;

  -- Target cohort: explicit arg, else the founder-configured current_cohort (105), else 1.
  select coalesce(p_cohort, current_cohort, 1) into v_cohort from public.app_settings where id = true;
  v_cohort := coalesce(v_cohort, p_cohort, 1);
  if v_cohort < 1 or v_cohort > 99 then raise exception 'Cohort must be between 1 and 99.'; end if;

  select key into v_dept_key from public.domains where id = p_domain_id;
  if v_dept_key is null then raise exception 'Unknown domain %.', p_domain_id; end if;
  v_dept_code := public.dept_code_for(v_dept_key);
  if v_dept_code is null then raise exception 'Domain % has no member-ID department code.', v_dept_key; end if;

  -- Cohort the intern currently holds (parsed from the member_id label; null/legacy → 1).
  v_old_cohort := coalesce(nullif(substring(coalesce(v_old_id, '') from 'Cohort[^0-9]*([0-9]+)'), '')::int, 1);
  if v_old_cohort = v_cohort then
    raise exception 'Intern is already in cohort %.', v_cohort;
  end if;

  -- Archive the current enrollment as history: member id, domain, fee proof, and earned credentials.
  insert into public.cohort_enrollments
      (user_id, cohort, member_id, domain_id, status, ended_at,
       payment_proof_url, payment_proof_submitted_at, payment_confirmed,
       certificate_key, lor_key, is_best_intern)
    values (p_user, v_old_cohort, v_old_id, v_old_domain, 'archived', now(),
            v_old_proof, v_old_proof_at, v_old_confirmed,
            v_old_cert, v_old_lor, v_old_best)
  on conflict (user_id, cohort) do update
    set status    = 'archived',
        ended_at  = now(),
        member_id = coalesce(public.cohort_enrollments.member_id, excluded.member_id),
        domain_id = coalesce(public.cohort_enrollments.domain_id, excluded.domain_id),
        payment_proof_url          = coalesce(public.cohort_enrollments.payment_proof_url, excluded.payment_proof_url),
        payment_proof_submitted_at = coalesce(public.cohort_enrollments.payment_proof_submitted_at, excluded.payment_proof_submitted_at),
        payment_confirmed          = coalesce(public.cohort_enrollments.payment_confirmed, excluded.payment_confirmed),
        certificate_key            = coalesce(public.cohort_enrollments.certificate_key, excluded.certificate_key),
        lor_key                    = coalesce(public.cohort_enrollments.lor_key, excluded.lor_key),
        is_best_intern             = coalesce(public.cohort_enrollments.is_best_intern, excluded.is_best_intern);

  -- Mint the new member ID for (year, target cohort, new department) — same sequence as handle_new_user.
  insert into public.member_id_seq (year, cohort, dept_code, last_seq)
    values (v_year, v_cohort, v_dept_code, 1)
    on conflict (year, cohort, dept_code) do update set last_seq = public.member_id_seq.last_seq + 1
    returning last_seq into v_seq;
  v_new_id := 'ZDR-' || v_year || '-Cohort' || v_cohort || '-' || v_dept_code || '-' || lpad(v_seq::text, 3, '0');

  -- Move into the new cohort/domain, reactivate, and reset the fee (they submit fresh proof for the new
  -- cohort). Credentials (certificate_key/lor_key/is_best_intern) are preserved on the profile.
  update public.profiles
     set domain_id = p_domain_id,
         member_id = v_new_id,
         is_alumni = false,
         status    = 'approved',
         payment_proof_url          = null,
         payment_proof_submitted_at = null,
         payment_confirmed          = false
   where id = p_user;

  -- Guard: if column protection reverted the reissue, abort the whole re-enroll rather than leave a hybrid.
  select member_id into v_applied from public.profiles where id = p_user;
  if v_applied is distinct from v_new_id then
    raise exception
      'member_id could not be reissued (profiles column-protection is still blocking it). Apply migration 126 (which re-applies migration 030) and retry. No change was made.';
  end if;

  -- Record the new, active enrollment (no payment/credentials yet — this cohort starts fresh).
  insert into public.cohort_enrollments (user_id, cohort, member_id, domain_id, status)
    values (p_user, v_cohort, v_new_id, p_domain_id, 'active')
  on conflict (user_id, cohort) do update
    set member_id   = excluded.member_id,
        domain_id   = excluded.domain_id,
        status      = 'active',
        ended_at    = null,
        enrolled_at = now();

  perform public.log_admin_action(
    're_enroll_intern', p_user,
    'Re-enrolled into cohort ' || v_cohort || ' as ' || v_new_id || ' (was ' || coalesce(v_old_id, '—') || '); fee reset'
  );
  return v_new_id;
end; $$;
grant execute on function public.re_enroll_intern(uuid, int, int) to authenticated;

-- ── (3) reader: a past cohort's tasks + the intern's own submissions/grades (past RLS) ──────────────────
-- SECURITY DEFINER + explicit owner/admin gate so a returning intern can read the OLD cohort's tasks that
-- tasks_read (120) now hides from them. One row per task of that cohort; submission fields are NULL when
-- they never submitted it. Marks are already on submissions (rubrics 047/108).
create or replace function public.get_cohort_work(p_user uuid, p_cohort int)
returns table (
  task_id            bigint,
  week               int,
  title              text,
  due_at             timestamptz,
  domain_id          int,
  status             text,
  submitted_at       timestamptz,
  graded_at          timestamptz,
  feedback           text,
  score_completeness numeric,
  score_accuracy     numeric,
  score_evidence     numeric,
  score_report       numeric,
  score_video        numeric,
  score_overall      numeric
) language sql security definer set search_path = public stable as $$
  select t.id, t.week, t.title, t.due_at, t.domain_id,
         s.status, s.submitted_at, s.graded_at, s.feedback,
         s.score_completeness, s.score_accuracy, s.score_evidence,
         s.score_report, s.score_video, s.score_overall
    from public.tasks t
    left join public.submissions s on s.task_id = t.id and s.user_id = p_user
   where t.cohort = p_cohort
     and (p_user = auth.uid() or public.is_admin())
   order by t.week, t.id;
$$;
grant execute on function public.get_cohort_work(uuid, int) to authenticated;

-- ── (4) one-time backfill: snapshot credentials for interns already re-enrolled under the old flow ─────
-- Copies the current profile credentials onto their most-recent archived enrollment (coalesce preserves any
-- already captured). Runs from the SQL editor (auth.uid() null → trigger bypassed). Only touches interns
-- that have an archived enrollment (i.e. were re-enrolled); everyone else is left alone.
update public.cohort_enrollments ce
set certificate_key = coalesce(ce.certificate_key, p.certificate_key),
    lor_key         = coalesce(ce.lor_key,         p.lor_key),
    is_best_intern  = coalesce(ce.is_best_intern,  p.is_best_intern)
from public.profiles p
where ce.user_id = p.id
  and ce.status = 'archived'
  and ce.cohort = (select max(x.cohort) from public.cohort_enrollments x
                    where x.user_id = p.id and x.status = 'archived');
