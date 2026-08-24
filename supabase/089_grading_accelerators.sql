-- 089_grading_accelerators.sql — Grading accelerators (Phase 12 — growth: portal). Run after 088. Idempotent.
-- Client-only admin-UX helpers in the grade dialog (rubric presets + keyboard submit) so grading is faster
-- and bigger cohorts stay reviewable. No schema change — just seeds the flag (OFF) so it appears in
-- Founder → Feature Flags. When off, the grade dialog is exactly as before.
insert into public.feature_flags (key, label) values
  ('grading_accelerators', 'Grading accelerators — rubric presets + keyboard submit (Phase 12)')
on conflict (key) do nothing;
