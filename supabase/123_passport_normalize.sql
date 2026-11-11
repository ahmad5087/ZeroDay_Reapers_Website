-- 123_passport_normalize.sql — fix the Skill Passport math so the PUBLIC passport (/passport/<token>)
-- and the Hall-of-Fame modal show the same, correct numbers as the in-portal Skill Passport.
-- Run in the Supabase SQL editor AFTER 122. Idempotent (safe to re-run).
--
-- THE BUG: compute_passport_json (082 → 122) assumed every task is marked out of 40 with four /10 axes.
-- The FINAL task (Week 6) is marked out of 100 — Completeness/Accuracy/Evidence /10, Report /20,
-- Video /50 — so the old math produced:
--   * overall % > 100  (e.g. avg(40,38,39,34,38,87)=46 → 46/40*100 = 115%)
--   * per-skill % > 100 (a Week-6 skill: 87/40*100 = 218%)
--   * a Reporting competency > 10/10 (raw avg mixing Report /10 for weeks 1–5 with Report /20 for week 6)
-- The in-portal Skill Passport (app/portal/_components/SkillPassport.jsx via _lib.js rubricForWeek())
-- already does this right; this makes the SQL match it.
--
-- THE FIX: normalise against each task's OWN rubric (mirrors app/portal/_lib.js):
--   * weeks 1–5 → max 40 (axes /10); week 6 → max 100 (Report /20, Video /50)
--   * every axis is put on a /10 basis before averaging (Report wk6 ÷2, Video wk6 ÷5)
--   * overall % and per-skill % divide the summed scores by the summed per-task max (not a flat /40)
--   * adds the Video competency axis (parity with the in-portal passport; "—" for interns with no
--     final-task submission, exactly like the portal view)
-- Finally, re-snapshot any already-inducted Hall-of-Fame rows so their stored numbers are corrected too.

create or replace function public.compute_passport_json(p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare p public.profiles; v_domain text; v_result jsonb;
begin
  select * into p from public.profiles where id = p_uid;
  if p.id is null then return null; end if;
  select name into v_domain from public.domains where id = p.domain_id;

  with subs as (
    select
      s.score_overall o,
      s.graded_at, t.week, t.title,
      -- per-task max: weeks 1–5 = /40, final task (week 6) = /100  (mirrors rubricForWeek().total)
      case when t.week = 6 then 100 else 40 end as max_total,
      -- axes normalised to a /10 basis. Completeness/Accuracy/Evidence are /10 every week.
      -- Report is /20 and Video /50 only on the final task, so divide those down on week 6.
      s.score_completeness::numeric as n_complete,
      s.score_accuracy::numeric     as n_accuracy,
      s.score_evidence::numeric     as n_evidence,
      case when t.week = 6 then s.score_report::numeric / 2.0 else s.score_report::numeric end as n_report,
      case when t.week = 6 then s.score_video::numeric  / 5.0 else null end                  as n_video,
      coalesce(nullif(t.skills, '{}'::text[]), array[coalesce(v_domain, 'General')]) as skills
    from public.submissions s
    join public.tasks t on t.id = s.task_id
    where s.user_id = p.id and s.status = 'approved' and s.graded_at is not null
  ),
  axes as (
    select jsonb_build_array(
      jsonb_build_object('key','completeness','label','Completeness','value', round(avg(n_complete)::numeric, 1)),
      jsonb_build_object('key','accuracy',    'label','Accuracy',    'value', round(avg(n_accuracy)::numeric, 1)),
      jsonb_build_object('key','evidence',    'label','Evidence',    'value', round(avg(n_evidence)::numeric, 1)),
      jsonb_build_object('key','report',      'label','Reporting',   'value', round(avg(n_report)::numeric, 1)),
      jsonb_build_object('key','video',       'label','Video demo',  'value', round(avg(n_video)::numeric, 1))
    ) j,
    count(o) n,
    -- overall % = Σ score ÷ Σ (each task's own max) × 100  (caps correctly at 100%)
    round(sum(o)::numeric / nullif(sum(max_total), 0) * 100) overall_pct
    from subs
  ),
  skills as (
    select sk as skill,
           round(sum(o)::numeric / nullif(sum(max_total), 0) * 100) pct,
           count(o) n
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
      'week', week, 'title', title, 'score', round(o::numeric, 1), 'max', max_total, 'graded_at', graded_at
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
-- Not exposed to anon/authenticated (it would leak any intern's marks by uid); reached only through the
-- SECURITY DEFINER wrappers get_public_passport / get_hall_of_fame_passport, which run as the owner.
revoke execute on function public.compute_passport_json(uuid) from public;

-- Re-snapshot already-inducted Hall-of-Fame rows so their stored passports use the corrected numbers.
update public.hall_of_fame
   set passport = public.compute_passport_json(user_id), updated_at = now()
 where user_id is not null;
