-- 120_tasks_per_cohort.sql — Make the task set per-cohort + a founder "reset this cohort's tasks"
-- tool. Run after 119. Idempotent — safe to re-run.
--
-- Until now tasks were a single shared curriculum (migration 115: "Tasks are shared across cohorts").
-- That meant a new cohort inherited the previous cohort's published tasks and there was no way to
-- clear/republish a cohort's tasks short of the full portal wipe (reset_portal). This migration:
--   1. adds a `cohort` column to public.tasks and backfills every existing row to Cohort 1,
--   2. gates task visibility so an intern only sees their own cohort's tasks (admins still see all),
--   3. adds reset_cohort_tasks(p_cohort) — a founder-only, cohort-scoped delete that mirrors
--      reset_cohort_member_numbering() (migration 119).
--
-- The intern Tasks view and the admin publish flow read/write this column; the per-cohort TIMELINE
-- (migration 115/116 cohort_starts) is unchanged and still drives due dates.

-- ---- (1) column + backfill -----------------------------------------------------------------------------
-- Nullable: a NULL cohort means "every cohort" (same convention as domain_id NULL = every domain). All
-- rows that exist today belong to Cohort 1, so backfill them; new tasks carry their cohort explicitly.
alter table public.tasks
  add column if not exists cohort int;

update public.tasks set cohort = 1 where cohort is null;

create index if not exists tasks_cohort_week on public.tasks (cohort, week);

-- ---- (2) caller's cohort (for the RLS read policy) -----------------------------------------------------
-- Parsed from the caller's member_id -> cohort number (mirrors my_cohort_start(), migration 116).
-- NULL when the caller has no cohort segment (unassigned / non-student). security definer so an RLS
-- policy can read the caller's own profile row regardless of the caller's grants.
create or replace function public.my_cohort()
returns int language sql stable security definer set search_path = public as $$
  select (regexp_match(member_id, 'Cohort\s*([0-9]+)', 'i'))[1]::int
    from public.profiles
   where id = auth.uid()
     and member_id ~* 'Cohort\s*[0-9]+';
$$;
grant execute on function public.my_cohort() to authenticated;

-- ---- (3) tasks visible to a student: domain AND ram AND cohort (admins exempt) -------------------------
-- Extends the policy from 015_ram_specs.sql with a cohort gate. A NULL cohort stays visible to all
-- (legacy fallback — none exist after the backfill above).
drop policy if exists "tasks_read" on public.tasks;
create policy "tasks_read" on public.tasks
  for select to authenticated using (
    public.is_admin()
    or (
      (domain_id is null or domain_id = (select domain_id from public.profiles where id = auth.uid()))
      and (ram is null or ram = (select ram from public.profiles where id = auth.uid()))
      and (cohort is null or cohort = public.my_cohort())
    )
  );

-- ---- (4) founder tool: reset ONE cohort's published tasks ----------------------------------------------
-- Deletes every task row for p_cohort; all dependent rows (submissions, submission versions,
-- task_extension_requests, email reminders, submission_change_requests) cascade via their
-- `references public.tasks(id) on delete cascade`. Other cohorts are untouched. Returns the number of
-- task rows deleted. R2 objects (task PDFs + submission files) are purged by the calling API route
-- BEFORE this runs, because Postgres cannot reach R2 and the keys vanish once the rows are gone.
create or replace function public.reset_cohort_tasks(p_cohort int)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_deleted int;
begin
  if not public.is_founder() then
    raise exception 'Only a founder can reset a cohort''s tasks.';
  end if;
  if p_cohort is null or p_cohort < 1 or p_cohort > 99 then
    raise exception 'Cohort must be between 1 and 99.';
  end if;

  delete from public.tasks where cohort = p_cohort;
  get diagnostics v_deleted = row_count;

  perform public.log_admin_action(
    'reset_cohort_tasks', null,
    'Deleted ' || v_deleted || ' task(s) for cohort ' || p_cohort
  );
  return v_deleted;
end; $$;

grant execute on function public.reset_cohort_tasks(int) to authenticated;
