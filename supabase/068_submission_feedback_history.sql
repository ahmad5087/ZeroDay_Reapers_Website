-- 068_submission_feedback_history.sql — preserve marks + mentor feedback for every uploaded attempt.
-- Run after 067. Idempotent.
--
-- `submissions` remains the latest pointer. `submission_files` is the immutable upload history; these
-- columns snapshot the grade attached to each version so a rejected attempt is not lost on re-upload.

alter table public.submission_files add column if not exists status text not null default 'submitted';
alter table public.submission_files add column if not exists feedback text;
alter table public.submission_files add column if not exists graded_by uuid references public.profiles(id) on delete set null;
alter table public.submission_files add column if not exists graded_at timestamptz;
alter table public.submission_files add column if not exists score_completeness numeric(4,2);
alter table public.submission_files add column if not exists score_accuracy numeric(4,2);
alter table public.submission_files add column if not exists score_evidence numeric(4,2);
alter table public.submission_files add column if not exists score_report numeric(4,2);
alter table public.submission_files add column if not exists score_overall numeric(5,2)
  generated always as (
    case
      when score_completeness is null and score_accuracy is null
       and score_evidence is null and score_report is null then null
      else coalesce(score_completeness, 0) + coalesce(score_accuracy, 0)
         + coalesce(score_evidence, 0) + coalesce(score_report, 0)
    end
  ) stored;

alter table public.submission_files drop constraint if exists submission_files_status_check;
alter table public.submission_files add constraint submission_files_status_check
  check (status in ('submitted', 'approved', 'rejected'));

alter table public.submission_files drop constraint if exists submission_files_scores_check;
alter table public.submission_files add constraint submission_files_scores_check check (
  (score_completeness is null or score_completeness between 0 and 10) and
  (score_accuracy     is null or score_accuracy     between 0 and 10) and
  (score_evidence     is null or score_evidence     between 0 and 10) and
  (score_report       is null or score_report       between 0 and 10)
);

-- Older/current submissions may pre-date versioning. Create one history row so their current result
-- appears in the new views; existing versioned submissions are left untouched.
insert into public.submission_files (submission_id, task_id, user_id, file_path, file_name, uploaded_at)
select s.id, s.task_id, s.user_id, s.file_path, s.file_name, coalesce(s.submitted_at, now())
from public.submissions s
where s.file_path is not null
  and not exists (
    select 1 from public.submission_files sf
    where sf.task_id = s.task_id and sf.user_id = s.user_id
  );

-- Backfill the newest known attempt with the grade still present on `submissions`. Older overwritten
-- feedback cannot be reconstructed, but every decision made after this migration is preserved.
update public.submission_files sf
set status             = s.status,
    feedback           = s.feedback,
    graded_by          = s.graded_by,
    graded_at          = s.graded_at,
    score_completeness = s.score_completeness,
    score_accuracy     = s.score_accuracy,
    score_evidence     = s.score_evidence,
    score_report       = s.score_report
from public.submissions s
where sf.id = (
  select newest.id
  from public.submission_files newest
  where newest.task_id = s.task_id and newest.user_id = s.user_id
  order by newest.uploaded_at desc, newest.id desc
  limit 1
);

-- Students may append upload metadata, but cannot forge a verdict, feedback, grader, or marks.
drop policy if exists subfiles_insert on public.submission_files;
create policy subfiles_insert on public.submission_files
  for insert to authenticated with check (
    user_id = auth.uid()
    and status = 'submitted'
    and feedback is null and graded_by is null and graded_at is null
    and score_completeness is null and score_accuracy is null
    and score_evidence is null and score_report is null
  );

-- Every admin/founder grading path (single grade, bulk approval, founder override) updates the latest
-- upload snapshot. A student re-upload changes `submissions` to submitted before its new history row is
-- inserted; submitted updates are deliberately ignored so the previous rejected feedback remains intact.
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
      score_report       = new.score_report
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
    score_completeness, score_accuracy, score_evidence, score_report
  on public.submissions
  for each row execute function public.snapshot_submission_grade();

