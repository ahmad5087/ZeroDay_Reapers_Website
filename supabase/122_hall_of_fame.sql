-- 122_hall_of_fame.sql — all-time, admin-curated "Best Intern" Hall of Fame for the public website.
-- Run in the Supabase SQL editor after 121. Idempotent (safe to re-run).
--
-- Design (decided with the founder):
--   * All-time: a durable public.hall_of_fame row per inducted intern — survives the per-cohort
--     is_best_intern reset (033) and the 75-day submissions purge, because the passport is SNAPSHOT
--     into the row at induction (not recomputed live).
--   * Admin-curated opt-in: only an admin/founder inducts someone (induct_best_intern), which implies
--     the intern consented to public display. Profile fields (name, avatar, LinkedIn, domain) are
--     snapshotted so the card stays correct even if the profile later changes or is purged.
--   * Public page reads ONLY through SECURITY DEFINER RPCs (anon): get_hall_of_fame (cards) and
--     get_hall_of_fame_passport (the modal). No email is exposed (LinkedIn only).

-- ---- (1) Shared passport computation --------------------------------------------------------------
-- Factored out of get_public_passport (082) so the Hall of Fame can snapshot the SAME verified numbers
-- by uid. Body is identical to 082's computation. NOT granted to anon/authenticated: it would expose
-- any intern's computed marks by uid. It is only ever reached through the SECURITY DEFINER functions
-- below (which run as the owner), so no caller grant is needed; we revoke the default PUBLIC execute.
create or replace function public.compute_passport_json(p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare p public.profiles; v_domain text; v_result jsonb;
begin
  select * into p from public.profiles where id = p_uid;
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
revoke execute on function public.compute_passport_json(uuid) from public;

-- Re-point the existing public passport page at the shared function (behaviour unchanged).
create or replace function public.get_public_passport(p_token text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_uid uuid;
begin
  if coalesce(p_token, '') = '' then return null; end if;
  select user_id into v_uid from public.passport_shares where token = p_token and is_public = true;
  if v_uid is null then return null; end if;
  return public.compute_passport_json(v_uid);
end; $$;
grant execute on function public.get_public_passport(text) to anon, authenticated;

-- ---- (2) Hall of Fame table -----------------------------------------------------------------------
create table if not exists public.hall_of_fame (
  id           bigint generated always as identity primary key,
  user_id      uuid references public.profiles(id) on delete set null,  -- keep the row if the profile is purged
  domain_id    int  references public.domains(id),
  domain_name  text,          -- snapshot (survives domain/profile changes + purges)
  cohort       int,
  year         int,
  display_name text not null, -- snapshot (full name preferred)
  photo_url    text,          -- admin-uploaded headshot (public URL); card falls back to avatar_url
  avatar_url   text,          -- snapshot of the profile avatar at induction (fallback)
  linkedin_url text,          -- snapshot
  passport     jsonb,         -- snapshot of compute_passport_json at induction (survives retention)
  is_visible   boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists hall_of_fame_domain on public.hall_of_fame (domain_id);

alter table public.hall_of_fame enable row level security;
-- Admins/founders manage it directly (list + edit visibility/sort/photo); the public reads via RPC only.
drop policy if exists "hof_admin_all" on public.hall_of_fame;
create policy "hof_admin_all" on public.hall_of_fame
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- (3) Induct (admin) — snapshots profile + passport into a new row -----------------------------
create or replace function public.induct_best_intern(
  p_uid uuid,
  p_cohort int default null,
  p_display_name text default null,
  p_linkedin_url text default null,
  p_photo_url text default null
)
returns bigint language plpgsql security definer set search_path = public as $$
declare p public.profiles; v_domain text; v_cohort int; v_id bigint;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into p from public.profiles where id = p_uid;
  if p.id is null then raise exception 'no such user'; end if;
  select name into v_domain from public.domains where id = p.domain_id;
  v_cohort := coalesce(p_cohort, (select current_cohort from public.app_settings where id = true), 1);

  insert into public.hall_of_fame (
    user_id, domain_id, domain_name, cohort, year, display_name, photo_url, avatar_url, linkedin_url, passport
  ) values (
    p_uid, p.domain_id, v_domain, v_cohort, extract(year from now())::int,
    coalesce(nullif(btrim(p_display_name), ''), p.full_name, p.display_name, 'Intern'),
    nullif(btrim(p_photo_url), ''),
    p.avatar_url,
    coalesce(nullif(btrim(p_linkedin_url), ''), p.linkedin_url),
    public.compute_passport_json(p_uid)
  )
  returning id into v_id;

  perform public.log_admin_action('induct_best_intern', p_uid,
    'Hall of Fame: ' || coalesce(v_domain, '?') || ' · cohort ' || v_cohort);
  return v_id;
end; $$;
grant execute on function public.induct_best_intern(uuid, int, text, text, text) to authenticated;

-- Re-snapshot an inductee's passport from their current graded work (admin).
create or replace function public.refresh_hall_of_fame_passport(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select user_id into v_uid from public.hall_of_fame where id = p_id;
  if v_uid is null then raise exception 'this inductee has no linked profile to refresh from'; end if;
  update public.hall_of_fame
     set passport = public.compute_passport_json(v_uid), updated_at = now()
   where id = p_id;
end; $$;
grant execute on function public.refresh_hall_of_fame_passport(bigint) to authenticated;

-- ---- (4) Public reads (anon) ----------------------------------------------------------------------
-- Card data only (no passport payload) — the modal lazy-loads the passport by id.
create or replace function public.get_hall_of_fame()
returns jsonb language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',           h.id,
    'domain_id',    h.domain_id,
    'domain',       h.domain_name,
    'cohort',       h.cohort,
    'year',         h.year,
    'name',         h.display_name,
    'photo_url',    h.photo_url,
    'avatar_url',   h.avatar_url,
    'linkedin_url', h.linkedin_url,
    'has_passport', (h.passport is not null)
  ) order by h.domain_id nulls last, h.sort, h.created_at), '[]'::jsonb)
  from public.hall_of_fame h
  where h.is_visible = true;
$$;
grant execute on function public.get_hall_of_fame() to anon, authenticated;

create or replace function public.get_hall_of_fame_passport(p_id bigint)
returns jsonb language sql security definer set search_path = public stable as $$
  select h.passport from public.hall_of_fame h where h.id = p_id and h.is_visible = true;
$$;
grant execute on function public.get_hall_of_fame_passport(bigint) to anon, authenticated;
