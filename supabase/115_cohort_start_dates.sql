-- 115_cohort_start_dates.sql — Founder-set per-cohort start dates. Run after 114. Idempotent.
--
-- The admin "late comer" tag (and any future date-based feature) needs to know when each cohort begins.
-- Tasks are shared across cohorts (migration 105 only changed member-id numbering, not the task set), so
-- a task's created_at/due_at can't anchor this — a Cohort-2 intern would look "late" against a Week-1
-- task created back in Cohort 1. This stores a per-cohort start date the founder sets in the panel, as a
-- JSON map { "<cohort>": "YYYY-MM-DD" }. Only a founder can write it; everyone authenticated can read
-- app_settings, so the panel reads the map directly.

-- ---- (1) storage ---------------------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists cohort_starts jsonb not null default '{}'::jsonb;

-- ---- (2) founder setter --------------------------------------------------------------------------------
-- Pass p_date = null to clear a cohort's start date (removes its key from the map).
create or replace function public.set_cohort_start(p_cohort int, p_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Only a founder can set a cohort start date.';
  end if;
  if p_cohort is null or p_cohort < 1 or p_cohort > 99 then
    raise exception 'Cohort must be between 1 and 99.';
  end if;
  update public.app_settings
     set cohort_starts = case
           when p_date is null then (cohort_starts - p_cohort::text)
           else jsonb_set(cohort_starts, array[p_cohort::text], to_jsonb(p_date::text), true)
         end,
         updated_at = now(), updated_by = auth.uid()
   where id = true;
  perform public.log_admin_action(
    'set_cohort_start', null,
    'Cohort ' || p_cohort || ' start = ' || coalesce(p_date::text, '(cleared)')
  );
end; $$;
grant execute on function public.set_cohort_start(int, date) to authenticated;
