-- 118_drop_auto_unpaid_removal.sql — Remove ALL bulk/automatic removal of unpaid interns. Run after 117.
-- Idempotent.
--
-- Two mechanisms removed:
--   1. Trigger on public.tasks (trg_week4_unpaid_removal -> auto_remove_unpaid_on_week4, migrations 006/011)
--      deleted every intern with no payment proof when a Week-4 task was inserted.
--   2. The manual admin RPC public.audit_unpaid_interns() deleted EVERY non-admin with no payment proof the
--      moment it was called — ignoring the new "Week 1 is free / pay before Week 2" rule and cohort, so it
--      would have wiped legitimately-unpaid Week-1 interns. Its Admin Panel button is removed too.
--
-- The founder now removes unpaid interns MANUALLY (per-member Ban/delete), and the Week-2 fee hard gate
-- (migration 117) is the real enforcement.

drop trigger if exists trg_week4_unpaid_removal on public.tasks;
drop function if exists public.auto_remove_unpaid_on_week4();
drop function if exists public.audit_unpaid_interns();
