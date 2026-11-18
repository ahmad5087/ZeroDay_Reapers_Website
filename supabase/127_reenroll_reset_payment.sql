-- 127_reenroll_reset_payment.sql — A re-enrolled intern must pay the fee again for the new cohort.
-- Run after 126 (run order: 125 → 126 → 127). Idempotent; safe to re-run.
--
-- WHY
-- The Week-2 fee gate (117) lets an intern submit once profiles.payment_proof_url is not null. That column
-- lives on the single shared profile and nothing reset it on re-enroll, so a returning intern cleared the
-- Cohort-2 gate on their Cohort-1 proof. Policy: re-enrolling into a new cohort requires a fresh fee proof.
--
-- WHAT
--   (1) cohort_enrollments gains payment_proof_url / payment_proof_submitted_at / payment_confirmed, so the
--       Cohort-1 payment is PRESERVED as history on the archived enrollment row (founder's choice).
--   (2) re_enroll_intern (redefined — carries forward 126's reissue guard) now archives the old payment
--       onto the enrollment row, then nulls payment_proof_url + payment_proof_submitted_at and sets
--       payment_confirmed=false on the profile, so the fee card reappears and the gate re-arms for the new
--       cohort. The founder re-confirms after reviewing the new proof. (No app-code change: the Tasks fee
--       card and 117's trigger both key off payment_proof_url, which is now null again.)
--   (3) one-time repair for interns already re-enrolled under the old flow (currently just Taha): move their
--       lingering profile payment onto the archived enrollment, then clear it on the profile.

-- ── (1) preserve payment on the enrollment-history row ─────────────────────────────────────────────────
alter table public.cohort_enrollments add column if not exists payment_proof_url          text;
alter table public.cohort_enrollments add column if not exists payment_proof_submitted_at timestamptz;
alter table public.cohort_enrollments add column if not exists payment_confirmed          boolean;

-- ── (2) re_enroll_intern: archive the old payment, then reset it on the profile ────────────────────────
-- Body is migration 126's (founder gate, archive, mint id, reissue + post-UPDATE guard) plus payment
-- capture/reset. Redefining supersedes 126's definition — the guard is retained here on purpose.
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
begin
  if not public.is_founder() then
    raise exception 'Only a founder can re-enroll an intern.';
  end if;

  select member_id, domain_id, role, payment_proof_url, payment_proof_submitted_at, payment_confirmed
    into v_old_id, v_old_domain, v_role, v_old_proof, v_old_proof_at, v_old_confirmed
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

  -- Archive the current enrollment as history, including the fee proof they submitted for it.
  insert into public.cohort_enrollments
      (user_id, cohort, member_id, domain_id, status, ended_at,
       payment_proof_url, payment_proof_submitted_at, payment_confirmed)
    values (p_user, v_old_cohort, v_old_id, v_old_domain, 'archived', now(),
            v_old_proof, v_old_proof_at, v_old_confirmed)
  on conflict (user_id, cohort) do update
    set status    = 'archived',
        ended_at  = now(),
        member_id = coalesce(public.cohort_enrollments.member_id, excluded.member_id),
        domain_id = coalesce(public.cohort_enrollments.domain_id, excluded.domain_id),
        payment_proof_url          = coalesce(public.cohort_enrollments.payment_proof_url, excluded.payment_proof_url),
        payment_proof_submitted_at = coalesce(public.cohort_enrollments.payment_proof_submitted_at, excluded.payment_proof_submitted_at),
        payment_confirmed          = coalesce(public.cohort_enrollments.payment_confirmed, excluded.payment_confirmed);

  -- Mint the new member ID for (year, target cohort, new department) — same sequence as handle_new_user.
  insert into public.member_id_seq (year, cohort, dept_code, last_seq)
    values (v_year, v_cohort, v_dept_code, 1)
    on conflict (year, cohort, dept_code) do update set last_seq = public.member_id_seq.last_seq + 1
    returning last_seq into v_seq;
  v_new_id := 'ZDR-' || v_year || '-Cohort' || v_cohort || '-' || v_dept_code || '-' || lpad(v_seq::text, 3, '0');

  -- Move into the new cohort/domain, reactivate, and RESET the fee: they must submit fresh proof for the
  -- new cohort (030/126 permit a founder to reissue member_id; payment columns aren't founder-locked).
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

  -- Record the new, active enrollment (no payment yet — they pay for this cohort fresh).
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

-- ── (3) one-time repair: interns re-enrolled before this policy still carry their old fee proof ─────────
-- "Re-enrolled" == has an archived enrollment row (the backfill only ever creates 'active' rows, so an
-- archived row can only come from a prior re_enroll). Runs from the SQL editor (auth.uid() null → the
-- profiles trigger is bypassed). Step A preserves the lingering proof onto the most-recent archived
-- enrollment; step B then clears it on the profile so the intern re-pays for their current cohort.
update public.cohort_enrollments ce
set payment_proof_url          = p.payment_proof_url,
    payment_proof_submitted_at = p.payment_proof_submitted_at,
    payment_confirmed          = p.payment_confirmed
from public.profiles p
where ce.user_id = p.id
  and ce.status = 'archived'
  and ce.payment_proof_url is null
  and p.payment_proof_url is not null
  and ce.cohort = (select max(x.cohort) from public.cohort_enrollments x
                    where x.user_id = p.id and x.status = 'archived');

update public.profiles p
set payment_proof_url          = null,
    payment_proof_submitted_at = null,
    payment_confirmed          = false
where p.payment_proof_url is not null
  and exists (select 1 from public.cohort_enrollments a where a.user_id = p.id and a.status = 'archived');
