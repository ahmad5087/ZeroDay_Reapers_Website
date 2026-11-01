-- 111_renumber_cohort1_member_ids.sql — Re-sequence the Cohort-1 graduates' member IDs so each
-- department runs contiguously from 001, closing the gaps left by interns who didn't graduate.
--
-- Decisions (set by the founder):
--   • Scope:   the 25 graduated interns = profiles where role='student' AND is_alumni=true
--              AND member_id IS NOT NULL (admins/founder have no member_id, so they're excluded).
--   • Order:   within each department, BY SIGNUP DATE (created_at asc) → earliest = 001.
--   • Format:  KEEP EACH ID'S EXISTING PREFIX, renumber only the trailing -NNN (3-digit, zero-padded).
--              i.e. 'ZDR-2026-Cohort1-OS-017' → 'ZDR-2026-Cohort1-OS-003'; the year/cohort/dept
--              prefix is preserved exactly as that row currently has it.
--   • Grouping: per department, resolved from domain_id (public.dept_code_for(domains.key)), which is
--              authoritative; only the trailing number is derived here.
--
-- Safety notes:
--   • member_id is a DISPLAY/identity field only — it is NOT a foreign key anywhere (all joins use the
--     uuid id), so renumbering has no referential side-effects. Certificates (data/certificates.json,
--     e.g. ZDR-2026-OS-0001) are a SEPARATE namespace and are not touched.
--   • profiles has a partial unique index on member_id, so the apply step renumbers in two phases inside
--     one transaction (vacate the namespace to temp values, then assign finals) to avoid any transient
--     unique-index collision, and aborts before COMMIT if any duplicate slips through.
--   • RUN THIS IN THE SUPABASE SQL EDITOR (postgres/service role). There, auth.uid() is NULL, so the
--     protect_profile_columns trigger early-returns and allows the system-managed member_id to change.
--     Do NOT run it through the app (an end-user/admin session is blocked from editing member_id).
--   • member_id_seq is intentionally left untouched: its cohort-1 counters already sit at/above the old
--     max, so any (unlikely) future cohort-1 signup still lands above every renumbered ID — no collision.
--     Cohort 2+ uses its own per-cohort counter. (To hard-reset counters later, use the founder's
--     reset_member_id_counters tool.)
--
-- HOW TO USE: run STEP 1 alone first and eyeball the old→new mapping and the count (should be 25).
-- Only when it looks right, run STEP 2.

-- ============================================================================================
-- STEP 1 — PREVIEW (read-only; changes nothing). Run this block by itself first.
-- ============================================================================================
with targets as (
  select p.id,
         p.member_id                              as old_member_id,
         p.created_at,
         public.dept_code_for(d.key)              as dept_code,
         regexp_replace(p.member_id, '-[0-9]+$', '') as id_prefix
  from public.profiles p
  join public.domains d on d.id = p.domain_id
  where p.role = 'student'
    and p.is_alumni = true
    and p.member_id is not null
    and public.dept_code_for(d.key) is not null
),
ranked as (
  select *,
         row_number() over (partition by dept_code order by created_at asc, id asc) as rn
  from targets
)
select dept_code,
       rn                                                   as new_number,
       old_member_id,
       id_prefix || '-' || lpad(rn::text, 3, '0')           as new_member_id,
       (old_member_id <> id_prefix || '-' || lpad(rn::text, 3, '0')) as changes,
       created_at
from ranked
order by dept_code, rn;

-- Count sanity check (expect 25):
-- select count(*) as graduates
--   from public.profiles p join public.domains d on d.id = p.domain_id
--  where p.role='student' and p.is_alumni=true and p.member_id is not null
--    and public.dept_code_for(d.key) is not null;

-- ============================================================================================
-- STEP 2 — APPLY (transactional). Run only after STEP 1 looks correct.
-- ============================================================================================
begin;

create temp table _renumber_map on commit drop as
with targets as (
  select p.id,
         p.member_id                              as old_member_id,
         p.created_at,
         public.dept_code_for(d.key)              as dept_code,
         regexp_replace(p.member_id, '-[0-9]+$', '') as id_prefix
  from public.profiles p
  join public.domains d on d.id = p.domain_id
  where p.role = 'student'
    and p.is_alumni = true
    and p.member_id is not null
    and public.dept_code_for(d.key) is not null
)
select id,
       old_member_id,
       dept_code,
       id_prefix || '-' ||
         lpad(row_number() over (partition by dept_code order by created_at asc, id asc)::text, 3, '0')
         as new_member_id
from targets;

-- Phase 1: vacate the member_id namespace (unique, non-colliding temp values).
update public.profiles p
   set member_id = '__RENUM_' || p.id::text
  from _renumber_map m
 where p.id = m.id;

-- Phase 2: assign the final, contiguous per-department numbers.
update public.profiles p
   set member_id = m.new_member_id
  from _renumber_map m
 where p.id = m.id;

-- Abort if anything produced a duplicate member_id before we commit.
do $$
declare dups int;
begin
  select count(*) into dups
    from (
      select member_id
        from public.profiles
       where member_id is not null
       group by member_id
      having count(*) > 1
    ) x;
  if dups > 0 then
    raise exception 'Aborting renumber: % duplicate member_id(s) detected', dups;
  end if;
end $$;

commit;

-- Post-check (run after commit): list the renumbered IDs per department.
-- select public.dept_code_for(d.key) as dept, p.member_id, p.display_name, p.created_at
--   from public.profiles p join public.domains d on d.id = p.domain_id
--  where p.role='student' and p.is_alumni=true and p.member_id is not null
--  order by dept, p.member_id;
