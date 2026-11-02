-- 118_drop_auto_unpaid_removal.sql — Remove the AUTOMATIC removal of unpaid interns. Run after 117.
-- Idempotent.
--
-- Previously a trigger on public.tasks (trg_week4_unpaid_removal -> auto_remove_unpaid_on_week4, from
-- migrations 006/011) deleted every intern with no payment proof when a Week-4 task was inserted. The
-- founder now removes unpaid interns MANUALLY, and the Week-2 fee hard gate (migration 117) already blocks
-- unpaid interns from progressing, so the automatic purge is removed to avoid surprise mass deletions
-- (and it was inert for a cohort that reuses task rows anyway).
--
-- The manual admin tool public.audit_unpaid_interns() (wired to a button in the Admin Panel) is kept, so
-- the founder can still review/remove unpaid interns on demand.

drop trigger if exists trg_week4_unpaid_removal on public.tasks;
drop function if exists public.auto_remove_unpaid_on_week4();
