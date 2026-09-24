-- 108_week6_final_rubric.sql — Week 6 (Final Task) gets a bigger, weighted rubric and a video demo.
-- Run after 107 in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- The final week is graded on FIVE axes instead of four:
--   Completeness /10, Accuracy /10, Evidence /10, Report quality /20, Video demonstration /50 = /100.
-- Weeks 1–5 keep the original four-axis /40 rubric. The app keys the rubric off the WEEK number
-- (week = 6), so this applies to the final task of EVERY cohort automatically — no per-cohort setup.
--
-- Week 6 also takes TWO deliverables in one submission row: the PDF report (file_path, as always) and
-- a video link (video_url, new). Both are required before an approval is allowed.
--
-- DB-side the rubric ranges are widened permissively (report 0–20, new video 0–50); the app enforces
-- the exact per-week maximums. score_overall becomes the sum of all five axes: weeks 1–5 never set the
-- video axis, so their overall stays the /40 sum of four; week 6 sums to /100.

-- ========================= submissions: video link + video score =========================
alter table public.submissions add column if not exists video_url  text;
alter table public.submissions add column if not exists score_video numeric(5,2);

-- The generated overall depends on the axes, so drop it before widening the range / adding the axis.
alter table public.submissions drop column if exists score_overall;

alter table public.submissions drop constraint if exists submissions_scores_chk;
alter table public.submissions add constraint submissions_scores_chk check (
  (score_completeness is null or score_completeness between 0 and 10) and
  (score_accuracy     is null or score_accuracy     between 0 and 10) and
  (score_evidence     is null or score_evidence     between 0 and 10) and
  (score_report       is null or score_report       between 0 and 20) and
  (score_video        is null or score_video        between 0 and 50)
);

-- Overall = sum of all five axes; NULL until at least one axis is scored. Weeks 1–5 leave the video
-- axis NULL, so their overall is unchanged (the /40 sum of four); week 6 sums to /100.
alter table public.submissions add column score_overall numeric(5,2)
  generated always as (
    case
      when score_completeness is null and score_accuracy is null
       and score_evidence is null and score_report is null
       and score_video is null then null
      else coalesce(score_completeness, 0) + coalesce(score_accuracy, 0)
         + coalesce(score_evidence, 0) + coalesce(score_report, 0)
         + coalesce(score_video, 0)
    end
  ) stored;

-- protect_submission (extends 067): a non-admin write still re-queues the submission and wipes every
-- grade field — now including the new video axis. The student's own content (file_path, video_url,
-- note) is preserved; only the verdict/marks are cleared. Approved submissions stay locked.
create or replace function public.protect_submission()
returns trigger language plpgsql security definer set search_path = public as $$
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
    new.score_video        := null;

    -- Approved is final: an approved submission can never be replaced by the intern (a founder can
    -- still reopen it from the Admin Panel by moving the status back to pending/rejected).
    if tg_op = 'UPDATE' and old.status = 'approved' then
      raise exception 'SUBMISSION_APPROVED_LOCKED: This week''s submission has been approved and can no longer be replaced.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists protect_submission_trg on public.submissions;
create trigger protect_submission_trg before insert or update on public.submissions
  for each row execute function public.protect_submission();

-- ========================= submission_files (history): mirror the new axis =========================
alter table public.submission_files add column if not exists score_video numeric(5,2);

alter table public.submission_files drop column if exists score_overall;

alter table public.submission_files drop constraint if exists submission_files_scores_check;
alter table public.submission_files add constraint submission_files_scores_check check (
  (score_completeness is null or score_completeness between 0 and 10) and
  (score_accuracy     is null or score_accuracy     between 0 and 10) and
  (score_evidence     is null or score_evidence     between 0 and 10) and
  (score_report       is null or score_report       between 0 and 20) and
  (score_video        is null or score_video        between 0 and 50)
);

alter table public.submission_files add column score_overall numeric(5,2)
  generated always as (
    case
      when score_completeness is null and score_accuracy is null
       and score_evidence is null and score_report is null
       and score_video is null then null
      else coalesce(score_completeness, 0) + coalesce(score_accuracy, 0)
         + coalesce(score_evidence, 0) + coalesce(score_report, 0)
         + coalesce(score_video, 0)
    end
  ) stored;

-- Students still can't forge marks on the history rows — extend the insert guard to the video axis.
drop policy if exists subfiles_insert on public.submission_files;
create policy subfiles_insert on public.submission_files
  for insert to authenticated with check (
    user_id = auth.uid()
    and status = 'submitted'
    and feedback is null and graded_by is null and graded_at is null
    and score_completeness is null and score_accuracy is null
    and score_evidence is null and score_report is null and score_video is null
  );

-- The grade snapshot (068) now also carries the video axis onto the latest history row.
create or replace function public.snapshot_submission_grade()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status not in ('approved', 'rejected') then return new; end if;

  update public.submission_files sf
  set status             = new.status,
      feedback           = new.feedback,
      graded_by          = new.graded_by,
      graded_at          = new.graded_at,
      score_completeness = new.score_completeness,
      score_accuracy     = new.score_accuracy,
      score_evidence     = new.score_evidence,
      score_report       = new.score_report,
      score_video        = new.score_video
  where sf.id = (
    select newest.id
    from public.submission_files newest
    where newest.task_id = new.task_id and newest.user_id = new.user_id
    order by newest.uploaded_at desc, newest.id desc
    limit 1
  );
  return new;
end; $$;

drop trigger if exists snapshot_submission_grade_trg on public.submissions;
create trigger snapshot_submission_grade_trg
  after update of status, feedback, graded_by, graded_at,
    score_completeness, score_accuracy, score_evidence, score_report, score_video
  on public.submissions
  for each row execute function public.snapshot_submission_grade();

-- ========================= bulk approve (019): don't approve an incomplete final task ==============
-- The grade modal already blocks approving a week-6 submission that is missing the PDF or the video
-- link; bulk-approve bypasses that modal, so guard it here too. Rather than aborting a whole mixed
-- batch, silently skip incomplete final-task rows (the returned count reflects what was approved).
create or replace function public.admin_bulk_approve_submissions(ids bigint[])
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.submissions s
    set status = 'approved', graded_by = auth.uid(), graded_at = now()
    where s.id = any(ids) and s.status is distinct from 'approved'
      and not exists (
        select 1 from public.tasks t
        where t.id = s.task_id and t.week = 6
          and (s.file_path is null or s.video_url is null or btrim(s.video_url) = '')
      );
  get diagnostics n = row_count;
  perform public.log_admin_action('bulk_approve_submissions', null, 'count=' || n);
  return n;
end $$;
grant execute on function public.admin_bulk_approve_submissions(bigint[]) to authenticated;

-- ========================= public passport (082): make totals week-6 aware =========================
-- Recompute the shared credential with per-week maximums so a /100 final task doesn't skew the overall
-- percentage or per-skill grip. Report is normalised back to a /10 basis for the competency tiles, and
-- a Video-demo tile is added (only the final task contributes to it).
create or replace function public.get_public_passport(p_token text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_uid uuid; p public.profiles; v_domain text; v_result jsonb;
begin
  if coalesce(p_token, '') = '' then return null; end if;
  select user_id into v_uid from public.passport_shares where token = p_token and is_public = true;
  if v_uid is null then return null; end if;
  select * into p from public.profiles where id = v_uid;
  if p.id is null then return null; end if;
  select name into v_domain from public.domains where id = p.domain_id;

  with subs as (
    select s.score_completeness c, s.score_accuracy a, s.score_evidence e, s.score_report r,
           s.score_video vid, s.score_overall o, s.graded_at, t.week, t.title,
           case when t.week = 6 then 100 else 40 end as maxo,
           case when t.week = 6 then 20  else 10 end as maxr,
           coalesce(nullif(t.skills, '{}'::text[]), array[coalesce(v_domain, 'General')]) as skills
    from public.submissions s
    join public.tasks t on t.id = s.task_id
    where s.user_id = p.id and s.status = 'approved' and s.graded_at is not null
  ),
  axes as (
    select jsonb_build_array(
      jsonb_build_object('key','completeness','label','Completeness','value', round(avg(c)::numeric, 1)),
      jsonb_build_object('key','accuracy',    'label','Accuracy',    'value', round(avg(a)::numeric, 1)),
      jsonb_build_object('key','evidence',    'label','Evidence',    'value', round(avg(e)::numeric, 1)),
      jsonb_build_object('key','report',      'label','Reporting',   'value', round(avg(r / maxr * 10)::numeric, 1)),
      jsonb_build_object('key','video',       'label','Video demo',  'value', round(avg(vid / 50.0 * 10)::numeric, 1))
    ) j, count(o) n, round(avg(o / maxo * 100)) overall_pct from subs
  ),
  skills as (
    select sk as skill, round(avg(o / maxo * 100)) pct, count(o) n
    from subs, unnest(subs.skills) sk
    group by sk
  ),
  skills_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'skill', skill, 'pct', pct, 'tasks', n,
      'level', case when pct >= 80 then 'Advanced' when pct >= 60 then 'Proficient' else 'Novice' end
    ) order by pct desc nulls last), '[]'::jsonb) j from skills
  ),
  tasks_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'week', week, 'title', title, 'score', round(o::numeric, 1), 'max', maxo, 'graded_at', graded_at
    ) order by week), '[]'::jsonb) j from subs
  )
  select jsonb_build_object(
    'name',         coalesce(p.full_name, p.display_name, 'Intern'),
    'display_name', p.display_name,
    'member_id',    p.member_id,
    'domain',       v_domain,
    'overall_pct',  (select overall_pct from axes),
    'count',        (select n from axes),
    'axes',         (select j from axes),
    'skills',       (select j from skills_json),
    'tasks',        (select j from tasks_json),
    'issued_at',    p.created_at,
    'verified',     true
  ) into v_result;
  return v_result;
end; $$;
grant execute on function public.get_public_passport(text) to anon, authenticated;
