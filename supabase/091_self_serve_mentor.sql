-- 091_self_serve_mentor.sql — Self-serve mentor (Phase 12 — growth: portal). Run after 090. Idempotent.
-- The Mentor screen already gives bounded, decision-tree guidance. This adds a KNOWLEDGE-BASE SEARCH over
-- the resource library's existing full-text index (migration 073's `resources.search` tsvector), so interns
-- can unblock themselves 24/7. No schema change — just seeds the `self_serve_mentor` flag (OFF). Curated FAQ
-- content is the founder's to add as resources (see docs/phases/PHASE-12-PORTAL.md).
insert into public.feature_flags (key, label) values
  ('self_serve_mentor', 'Self-serve mentor — knowledge-base search (Phase 12)')
on conflict (key) do nothing;
