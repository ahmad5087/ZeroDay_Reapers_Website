-- 083_console_v2_flag.sql — Founder Console v2 (Phase 10) feature flag. Run after 082. Idempotent.
-- Client-only redesign of the admin console (grouped two-tier nav + ⌘K command palette + a "Home"
-- signal dashboard), fully additive in `AdminPanel.jsx` and gated by `console_v2`. No schema changes —
-- this migration only SEEDS the flag (OFF) so it shows up in Founder → Feature Flags. When the flag is
-- off the original flat tab strip renders unchanged.
insert into public.feature_flags (key, label) values
  ('console_v2', 'Founder Console v2 — grouped nav + command palette (Phase 10)')
on conflict (key) do nothing;
