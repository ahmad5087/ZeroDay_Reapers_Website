-- 129_cohort_work_domain_scope.sql — Scope the Previous-Cohort history to the intern's OWN department
-- (and RAM tier) for that cohort. Run after 128. Idempotent; safe to re-run.
--
-- get_cohort_work (128) filtered only by cohort, so a past cohort's history listed EVERY department's tasks
-- — every department other than the intern's showed up as "No submission". Mirror the live tasks_read RLS
-- (120): include a task only when its department matches the intern's department FOR THAT COHORT (read from
-- the archived cohort_enrollments row, not the current profile — the department changes on re-enroll) and
-- its RAM tier matches the intern's. A submission they actually made is always included, so nothing they
-- turned in can ever be hidden by a later domain/RAM change.
--
-- Same signature as 128 (so `create or replace` just swaps the body); only the WHERE clause changes.

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
     and (
       s.id is not null                                   -- always show what they actually submitted
       or (
         -- otherwise mirror the live task list: their cohort department + their RAM tier
         (t.domain_id is null or t.domain_id = (
            select ce.domain_id from public.cohort_enrollments ce
             where ce.user_id = p_user and ce.cohort = p_cohort
             limit 1))
         and (t.ram is null or t.ram = (select ram from public.profiles where id = p_user))
       )
     )
   order by t.week, t.id;
$$;
grant execute on function public.get_cohort_work(uuid, int) to authenticated;
