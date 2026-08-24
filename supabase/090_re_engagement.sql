-- 090_re_engagement.sql — Behavioral re-engagement (Phase 12 — growth: portal). Run after 089. Idempotent.
-- Supports a daily cron that nudges *engaged-but-stalling* interns (≥1 submission, but nothing in the last
-- STALE_DAYS) so fade-outs don't become drop-outs. De-dup table caps one nudge per intern per week; the
-- cron itself is gated by the `re_engagement` flag (SENDS EMAIL — enable in Wave 3). Founder controls the
-- threshold/copy in code + docs/phases/PHASE-12-PORTAL.md.

create table if not exists public.re_engagement_nudges (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  sent_on    date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);
create index if not exists re_engagement_nudges_user on public.re_engagement_nudges (user_id, sent_on desc);

alter table public.re_engagement_nudges enable row level security;
-- Writes happen only via the service-role cron (bypasses RLS). Admins may read for auditing.
drop policy if exists "re_engagement_admin_read" on public.re_engagement_nudges;
create policy "re_engagement_admin_read" on public.re_engagement_nudges
  for select to authenticated using (public.is_admin());

insert into public.feature_flags (key, label) values
  ('re_engagement', 'Behavioral re-engagement nudges — SENDS EMAIL (Phase 12)')
on conflict (key) do nothing;
