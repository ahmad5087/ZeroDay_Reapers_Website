-- 119_reset_cohort_member_numbering.sql — Founder tool: restart the CURRENT cohort's per-department
-- member-ID numbering at 001. Run after 105 (which added the `cohort` column to member_id_seq). Idempotent.
--
-- Why: member_id_seq only ever counts UP; deleting an account (admin_delete_user, etc.) does NOT release its
-- number. After repeated signup/delete cycles during testing, the next intern in a department gets -004, -005…
-- This clears the counter rows for the configured current_cohort ONLY, so the next signup in each department
-- of that cohort starts again at -001.
--
-- SCOPED TO THE CURRENT COHORT ONLY: it deletes member_id_seq rows where cohort = current_cohort. Previous
-- cohorts' counters (e.g. Cohort 1) are left untouched — their IDs and future numbering are unaffected.
-- (Unlike the older public.reset_id_counters(), which zeroes every cohort at once.) Existing profiles keep
-- their already-assigned member_id; this only affects numbers handed out to FUTURE signups.

create or replace function public.reset_cohort_member_numbering()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_cohort  int;
  v_deleted int;
begin
  if not public.is_founder() then
    raise exception 'Only a founder can reset member-ID numbering.';
  end if;

  select current_cohort into v_cohort from public.app_settings where id = true;
  v_cohort := coalesce(v_cohort, 1);

  -- Only this cohort's per-department counters; other cohorts are untouched.
  delete from public.member_id_seq where cohort = v_cohort;
  get diagnostics v_deleted = row_count;

  perform public.log_admin_action(
    'reset_cohort_member_numbering', null,
    'Reset member-ID numbering for cohort ' || v_cohort || ' (' || v_deleted || ' department counter(s) cleared)'
  );
  return v_cohort;
end; $$;

grant execute on function public.reset_cohort_member_numbering() to authenticated;
