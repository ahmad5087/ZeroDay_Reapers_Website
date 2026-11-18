-- 126_fix_reenroll_member_id.sql — Make re-enroll actually reissue the member ID, and repair any intern
-- left half-re-enrolled by the earlier (silently blocked) attempt. Run after 125. Idempotent; safe to re-run.
--
-- ROOT CAUSE
-- re_enroll_intern (125) archives the old enrollment, switches domain_id, and reissues member_id in one
-- UPDATE on profiles. It assumed migration 030 was live — 030 removed the blanket `member_id` lock from
-- protect_profile_columns so admins/founders may re-issue an ID. On this database 030 was never applied:
-- the live trigger is still the 029 version, whose final line `new.member_id := old.member_id` reverts ANY
-- member_id change. So on a real re-enroll the archive + domain switch committed, but the member_id reissue
-- was silently reverted. Result: the intern keeps their Cohort-1 ID while their department has moved — a
-- broken hybrid. Because the portal reads cohort from the ID text (lib/cohort.cohortOf → 'Cohort1'), they
-- still see the OLD cohort's tasks for the NEW department and still show under the old cohort's roster as
-- "No submission" (they have no submissions in the new department).
--
-- THIS MIGRATION
--   (1) (re)applies the intended protect_profile_columns — verbatim from migration 030, i.e. no blanket
--       member_id lock — so a founder's re-enroll UPDATE is no longer reverted.
--   (2) hardens re_enroll_intern: after the UPDATE it verifies the new id actually took and raises if not,
--       so the RPC can never again leave a half-applied hybrid (the whole call rolls back instead).
--   (3) one-time REPAIR: for any intern whose ACTIVE cohort_enrollment names a different member_id than
--       their profile (the signature of a prior blocked re-enroll), finish the move the re-enroll intended.
--       Non-re-enrolled interns (active enrollment == current id) are left untouched.

-- ── (1) correct column protection (verbatim from migration 030) ────────────────────────────────────────
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare caller_role text; caller_founder boolean; target_is_staff boolean;
begin
  if auth.uid() is null then return new; end if;              -- SQL editor / service role bypass
  select role, is_founder into caller_role, caller_founder from public.profiles where id = auth.uid();
  target_is_staff := (old.role = 'admin' or coalesce(old.is_founder, false));

  if (new.is_founder is distinct from old.is_founder) and coalesce(caller_founder, false) = false then
    new.is_founder := old.is_founder;
  end if;

  if coalesce(caller_role, 'student') <> 'admin' then
    -- non-admin (intern): locked. phone stays editable; country/dial_code/member_id do NOT.
    if old.domain_id is not null then new.domain_id := old.domain_id; end if;
    new.role := old.role; new.banned := old.banned; new.timeout_until := old.timeout_until;
    new.status := old.status; new.is_alumni := old.is_alumni; new.payment_confirmed := old.payment_confirmed;
    new.ram := old.ram; new.discord_id := old.discord_id; new.discord_username := old.discord_username;
    new.classroom_confirmed := old.classroom_confirmed; new.is_founder := old.is_founder;
    new.country := old.country; new.dial_code := old.dial_code; new.member_id := old.member_id;
  elsif target_is_staff and coalesce(caller_founder, false) = false and auth.uid() <> old.id then
    -- a non-founder admin must not touch another admin/founder's protected columns.
    new.role := old.role; new.banned := old.banned; new.timeout_until := old.timeout_until;
    new.status := old.status; new.is_alumni := old.is_alumni; new.payment_confirmed := old.payment_confirmed;
    new.ram := old.ram; new.domain_id := old.domain_id;
    new.discord_id := old.discord_id; new.discord_username := old.discord_username;
    new.classroom_confirmed := old.classroom_confirmed; new.is_founder := old.is_founder;
    new.country := old.country; new.dial_code := old.dial_code; new.member_id := old.member_id;
  end if;
  -- (no blanket member_id lock anymore — admins/founders may re-issue an intern's ID)
  return new;
end; $$;

-- ── (2) harden re_enroll_intern: fail loudly if the reissue can't take ─────────────────────────────────
-- Same body as 125 plus a post-UPDATE guard. If column protection ever reverts the id again, the whole
-- transaction (archive + seq bump + update) rolls back and the founder gets a clear error instead of a
-- silently broken intern.
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
  v_applied    text;
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

  -- Guard: if column protection reverted the reissue, abort the whole re-enroll rather than leave a hybrid.
  select member_id into v_applied from public.profiles where id = p_user;
  if v_applied is distinct from v_new_id then
    raise exception
      'member_id could not be reissued (profiles column-protection is still blocking it). Apply migration 126 (which re-applies migration 030) and retry. No change was made.';
  end if;

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

-- ── (3) one-time repair of interns left half-re-enrolled by the blocked attempt ────────────────────────
-- Runs from the SQL editor (auth.uid() null → protect_profile_columns bypasses). For each intern, take
-- their highest-cohort ACTIVE enrollment; if its member_id differs from the profile's, complete the move the
-- earlier re-enroll intended (reissue the id, switch to that department, reactivate). Interns whose active
-- enrollment already matches their profile — i.e. everyone who was never re-enrolled — are not touched.
update public.profiles p
set member_id = ce.member_id,
    domain_id = coalesce(ce.domain_id, p.domain_id),
    is_alumni = false,
    status    = 'approved'
from (
  select distinct on (user_id) user_id, member_id, domain_id
    from public.cohort_enrollments
   where status = 'active' and member_id is not null
   order by user_id, cohort desc, enrolled_at desc
) ce
where ce.user_id = p.id
  and ce.member_id is distinct from p.member_id;
