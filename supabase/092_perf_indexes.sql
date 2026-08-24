-- 092_perf_indexes.sql — Targeted performance indexes (Phase 16 — scale). Run after 091. Idempotent.
-- The schema is already well-indexed; this closes the two real gaps on `submissions`, which only had a
-- (user_id) index. Everything that reads submissions BY TASK (deadline/re-engagement crons, bulk approve,
-- the Weekly Task Report's per-task grouping) and the passport/digest "approved BY USER" filters were doing
-- (user_id)-scan or seq-scan. These are additive B-tree indexes (no data change). Prefer a low-traffic
-- window; at current cohort size the build is near-instant. Cross-check the Supabase Performance advisor
-- (docs/phases/PHASE-16-PERFORMANCE.md) and drop anything it flags as redundant.

-- Task-scoped submission lookups: "who submitted task N", per-task grouping, grading.
create index if not exists submissions_task on public.submissions (task_id, user_id);

-- Per-user status filters: approved-by-user (Skill Passport, weekly digest, competency), rejected counts.
create index if not exists submissions_user_status on public.submissions (user_id, status);
