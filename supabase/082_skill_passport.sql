-- 082_skill_passport.sql — Digital Skill Passport (Phase 9, spotlight). Run after 081. Idempotent.
-- Upgrades the Phase-2 Skill Passport (flag competency_matrix) into a shareable, VERIFIABLE credential:
--   * passport_shares — a per-intern secret token + public flag, OWNER-ONLY readable (a private
--     passport's token is never exposed to other clients),
--   * an optional per-task skill/tool tag list (tasks.skills),
--   * two RPCs — publish_passport() (owner opts in / mints the token) and the anon-safe
--     get_public_passport(token), which RECOMPUTES proficiency from approved rubric marks server-side,
--     so a shared credential can't be forged by editing the client.
-- Flag: skill_passport. Nothing is public until a founder flips the flag AND an intern publishes.
--
-- SECURITY: the token is a 64-hex bearer secret in the URL (anyone with the link can view a PUBLIC
-- passport, like the 080 engagement token). It unlocks only already-public data — a private passport
-- returns null for any token — and the token row is readable only by its owner.

-- 1) Optional per-task skill / tool tags, e.g. '{Burp Suite,OWASP}'. Null/empty → the passport falls
--    back to the intern's domain as the single skill, so it works before any task has been tagged.
alter table public.tasks add column if not exists skills text[];

-- 2) Per-intern share record (token + public flag). Owner-only RLS keeps the token from leaking; public
--    reads go exclusively through get_public_passport() (SECURITY DEFINER, below).
create table if not exists public.passport_shares (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  token      text not null unique,
  is_public  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.passport_shares enable row level security;

drop policy if exists "passport_shares_owner" on public.passport_shares;
create policy "passport_shares_owner" on public.passport_shares
  for select to authenticated using (user_id = auth.uid());
-- No client writes — the owner changes state only through publish_passport().

-- 3) Seed the feature flag (OFF). Safe to re-run; existing row keeps its state.
insert into public.feature_flags (key, label) values
  ('skill_passport', 'Digital skill passport — verifiable credential (Phase 9)')
on conflict (key) do nothing;

-- 4) Owner opts a public passport on/off; mints a token on first publish, then reuses it (stable link).
--    Returns the token while public, null while private. Authenticated; acts on the caller only.
create or replace function public.publish_passport(p_public boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.passport_shares (user_id, token, is_public)
  values (
    auth.uid(),
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    coalesce(p_public, false)
  )
  on conflict (user_id) do update set is_public = coalesce(p_public, false), updated_at = now()
  returning token into v_token;
  return case when coalesce(p_public, false) then v_token else null end;
end; $$;
grant execute on function public.publish_passport(boolean) to authenticated;

-- 5) Token-gated public read (anon). Recomputes the passport from APPROVED, rubric-graded submissions:
--    per-axis averages, an overall %, and per-skill "grip" (mean rubric-overall /40 → 0-100 % →
--    Novice/Proficient/Advanced). Null unless the token matches a share row with is_public = true.
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
           s.score_overall o, s.graded_at, t.week, t.title,
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
      jsonb_build_object('key','report',      'label','Reporting',   'value', round(avg(r)::numeric, 1))
    ) j, count(o) n, round(avg(o) / 40 * 100) overall_pct from subs
  ),
  skills as (
    select sk as skill, round(avg(o) / 40 * 100) pct, count(o) n
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
      'week', week, 'title', title, 'score', round(o::numeric, 1), 'graded_at', graded_at
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
