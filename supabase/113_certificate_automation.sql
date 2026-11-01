-- 113_certificate_automation.sql — Phase 2 data layer for one-click, in-portal certificate issuing.
-- Run after 112 in the Supabase SQL Editor. Idempotent.
--
-- Three founder/admin RPCs (all SECURITY DEFINER, is_admin()-gated):
--   1. admin_set_task_skills(task, skills[]) — populate tasks.skills so the LOR can list the real
--      skills exercised across the 6 tasks (the column exists since 082 but nothing wrote to it).
--   2. admin_certificate_data(user) — the "verify before publishing" payload: recomputes everything a
--      certificate / LOR needs from APPROVED, rubric-graded submissions (same engine as the public
--      Skill Passport, 108), plus department Best-Intern RANK, a STANDOUT (top-scoring task), and the
--      aggregated key SKILLS. Nothing here can be forged client-side.
--   3. admin_publish_certificate(...) — upsert one row into public.certificates (112) so /verify
--      resolves the moment an admin clicks Publish.
--
-- These are created after 103 and are not anon RPCs; 103's revoke-from-anon / grant-to-authenticated
-- pattern already fits them, so a future re-run of 103 leaves them callable by logged-in admins.

-- ============================ 1) tag a task's skills ============================
create or replace function public.admin_set_task_skills(p_task_id bigint, p_skills text[])
returns public.tasks
language plpgsql security definer set search_path = public as $$
declare v_row public.tasks;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.tasks
     set skills = (
       select array_agg(btrim(x)) from unnest(coalesce(p_skills, '{}'::text[])) x where btrim(x) <> ''
     )
   where id = p_task_id
  returning * into v_row;
  if v_row.id is null then raise exception 'task % not found', p_task_id; end if;
  perform public.log_admin_action('set_task_skills', null, 'task=' || p_task_id);
  return v_row;
end $$;
grant execute on function public.admin_set_task_skills(bigint, text[]) to authenticated;

-- ============================ 2) verified certificate data ============================
-- Returns null for an unknown user. Scores come only from status='approved' + graded_at not null, so
-- an ungraded cohort yields null overall / empty standout (the UI then prompts to grade first).
create or replace function public.admin_certificate_data(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  p public.profiles; v_domain text; v_cohort int;
  v_rank int; v_rank_total int; v_result jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into p from public.profiles where id = p_user_id;
  if p.id is null then return null; end if;
  select name into v_domain from public.domains where id = p.domain_id;
  v_cohort := coalesce((regexp_match(coalesce(p.member_id, ''), 'Cohort([0-9]+)'))[1]::int, 1);

  -- Rank among this department's Best Interns, by mean overall percentage (week-6 aware). rank() so
  -- ties share a place; rank_total = how many Best Interns the department has.
  with best as (
    select pr.id,
           avg(s.score_overall / (case when t.week = 6 then 100.0 else 40.0 end)) as score
    from public.profiles pr
    join public.submissions s on s.user_id = pr.id and s.status = 'approved' and s.graded_at is not null
    join public.tasks t on t.id = s.task_id
    where pr.is_best_intern = true and pr.domain_id = p.domain_id
    group by pr.id
  ),
  ranked as (
    select id, rank() over (order by score desc nulls last) rnk, count(*) over () total from best
  )
  select rnk, total into v_rank, v_rank_total from ranked where id = p.id;

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
      jsonb_build_object('key','report',      'label','Reporting',   'value', round(avg(r::numeric / maxr * 10), 1)),
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
      'week', week, 'title', title, 'score', round(o::numeric, 1), 'max', maxo,
      'pct', round(o / maxo * 100), 'graded_at', graded_at
    ) order by week), '[]'::jsonb) j from subs
  ),
  standout as (
    select jsonb_build_object('title', title, 'pct', round(o / maxo * 100), 'week', week) j
    from subs order by (o / maxo) desc nulls last, week limit 1
  )
  select jsonb_build_object(
    'user_id',        p.id,
    'name',           coalesce(p.full_name, p.display_name, 'Intern'),
    'display_name',   p.display_name,
    'member_id',      p.member_id,
    'department',     v_domain,
    'cohort',         v_cohort,
    'is_best_intern', coalesce(p.is_best_intern, false),
    'is_alumni',      coalesce(p.is_alumni, false),
    'suggested_type', case when coalesce(p.is_best_intern, false) then 'Best Intern' else 'Completion Certificate' end,
    'overall_pct',    (select overall_pct from axes),
    'count',          (select n from axes),
    'axes',           (select j from axes),
    'skills',         (select j from skills_json),
    'tasks',          (select j from tasks_json),
    'standout',       (select j from standout),
    'rank',           v_rank,
    'rank_total',     v_rank_total
  ) into v_result;
  return v_result;
end $$;
grant execute on function public.admin_certificate_data(uuid) to authenticated;

-- ============================ 3) publish to the verify registry ============================
create or replace function public.admin_publish_certificate(
  p_id text, p_name text, p_type text, p_department text, p_cohort int, p_issued date, p_period text)
returns public.certificates
language plpgsql security definer set search_path = public as $$
declare v_row public.certificates;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if coalesce(btrim(p_id), '')   = '' then raise exception 'certificate id required'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'name required'; end if;
  insert into public.certificates (id, name, type, department, cohort, issued, period)
  values (
    btrim(p_id), btrim(p_name),
    coalesce(nullif(btrim(p_type), ''), 'Completion Certificate'),
    nullif(btrim(p_department), ''), p_cohort,
    coalesce(p_issued, current_date), nullif(btrim(p_period), '')
  )
  on conflict (id) do update set
    name = excluded.name, type = excluded.type, department = excluded.department,
    cohort = excluded.cohort, issued = excluded.issued, period = excluded.period
  returning * into v_row;
  perform public.log_admin_action('publish_certificate', null, v_row.id);
  return v_row;
end $$;
grant execute on function public.admin_publish_certificate(text, text, text, int, date, text) to authenticated;
