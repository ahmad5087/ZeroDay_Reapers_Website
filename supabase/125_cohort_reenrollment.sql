-- 125_cohort_reenrollment.sql — Re-enroll a returning intern into a new cohort. Run after 124. Idempotent.
--
-- Context: a profile is 1:1 with the login, and its cohort is parsed from member_id (lib/cohort.cohortOf).
-- A Cohort-1 student who returns for Cohort 2 reuses the SAME account, so without this they keep their
-- Cohort-1 member_id + domain and their results stay pooled across cohorts. This migration adds the DATA
-- layer for a founder-driven re-enroll (the UI action and the per-cohort scoping of intern surfaces ship
-- in follow-up PRs):
--
--   * public.cohort_enrollments — one row per (user, cohort): the member_id + domain the intern held in
--     that cohort, so re-enrolling PRESERVES the old enrollment as viewable history.
--   * public.re_enroll_intern(user, domain, cohort) — FOUNDER-ONLY RPC: archives the current enrollment,
--     mints a fresh ZDR-<year>-Cohort<N>-<DEPT>-NNN id from member_id_seq (same path as handle_new_user /
--     105), switches domain_id, reactivates from alumni, and records the new active enrollment.
--   * public.get_cohort_enrollments(user) — enrollment history for the profile / admin modal.
--   * one-time backfill so every existing student has a row for their current cohort.
--
-- No change to protect_profile_columns is needed: migration 030 already dropped the blanket member_id lock
-- for admins/founders, so this RPC (run under the founder's own auth) may reissue the id directly.

-- ── (1) history table ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.cohort_enrollments (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  cohort      int  not null check (cohort between 1 and 99),
  member_id   text,
  domain_id   int  references public.domains(id),
  status      text not null default 'active' check (status in ('active', 'archived')),
  enrolled_at timestamptz not null default now(),
  ended_at    timestamptz
);
-- At most one enrollment row per (person, cohort). Re-enroll upserts on this key.
create unique index if not exists cohort_enrollments_user_cohort_uniq on public.cohort_enrollments (user_id, cohort);
create index if not exists cohort_enrollments_user_idx on public.cohort_enrollments (user_id);

alter table public.cohort_enrollments enable row level security;
-- Read: the owner sees their own history; admins/founders see everyone's. All WRITES go through the
-- SECURITY DEFINER functions below (no insert/update/delete policy → clients can't write directly).
drop policy if exists cohort_enrollments_select on public.cohort_enrollments;
create policy cohort_enrollments_select on public.cohort_enrollments
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ── (2) founder-only re-enroll ───────────────────────────────────────────────────────────────────────
create or replace function public.re_enroll_intern(p_user uuid, p_domain_id int, p_cohort int default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_cohort     int;
  v_year       int := extract(year from now())::int;
  v_dept_key   text;
  v_dept_code  text;
  v_seq        int;
  v_new_id     text;
  v_old_id     text;
  v_old_domain int;
  v_old_cohort int;
  v_role       text;
begin
  if not public.is_founder() then
    raise exception 'Only a founder can re-enroll an intern.';
  end if;

  select member_id, domain_id, role into v_old_id, v_old_domain, v_role
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

  -- Archive the current enrollment as history (idempotent on re-run).
  insert into public.cohort_enrollments (user_id, cohort, member_id, domain_id, status, ended_at)
    values (p_user, v_old_cohort, v_old_id, v_old_domain, 'archived', now())
  on conflict (user_id, cohort) do update
    set status    = 'archived',
        ended_at  = now(),
        member_id = coalesce(public.cohort_enrollments.member_id, excluded.member_id),
        domain_id = coalesce(public.cohort_enrollments.domain_id, excluded.domain_id);

  -- Mint the new member ID for (year, target cohort, new department) — same sequence as handle_new_user.
  insert into public.member_id_seq (year, cohort, dept_code, last_seq)
    values (v_year, v_cohort, v_dept_code, 1)
    on conflict (year, cohort, dept_code) do update set last_seq = public.member_id_seq.last_seq + 1
    returning last_seq into v_seq;
  v_new_id := 'ZDR-' || v_year || '-Cohort' || v_cohort || '-' || v_dept_code || '-' || lpad(v_seq::text, 3, '0');

  -- Move the profile into the new cohort/domain and reactivate (030 permits a founder to reissue member_id).
  update public.profiles
     set domain_id = p_domain_id,
         member_id = v_new_id,
         is_alumni = false,
         status    = 'approved'
   where id = p_user;

  -- Record the new, active enrollment.
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
    'Re-enrolled into cohort ' || v_cohort || ' as ' || v_new_id || ' (was ' || coalesce(v_old_id, '—') || ')'
  );
  return v_new_id;
end; $$;
grant execute on function public.re_enroll_intern(uuid, int, int) to authenticated;

-- ── (3) history reader (profile + admin modal) ───────────────────────────────────────────────────────
create or replace function public.get_cohort_enrollments(p_user uuid)
returns setof public.cohort_enrollments language sql security definer set search_path = public stable as $$
  select * from public.cohort_enrollments
   where user_id = p_user
     and (p_user = auth.uid() or public.is_admin())
   order by cohort;
$$;
grant execute on function public.get_cohort_enrollments(uuid) to authenticated;

-- ── (4) one-time backfill: seed a current-cohort row for every existing student ───────────────────────
insert into public.cohort_enrollments (user_id, cohort, member_id, domain_id, status)
select p.id,
       coalesce(nullif(substring(p.member_id from 'Cohort[^0-9]*([0-9]+)'), '')::int, 1),
       p.member_id,
       p.domain_id,
       'active'
from public.profiles p
where p.role = 'student' and p.member_id is not null
on conflict (user_id, cohort) do nothing;
