-- 074_weekly_digest.sql — idempotency log for the weekly cohort digest cron. Run after 073.
-- The digest is composed in app/api/cron/weekly-digest (service role, reads across RLS); this table
-- just guarantees each intern is emailed at most once per ISO week. Idempotent.

create table if not exists public.weekly_digest_log (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  week_of  date not null,               -- Monday (UTC) of the ISO week the digest covers
  sent_at  timestamptz not null default now(),
  primary key (user_id, week_of)
);
create index if not exists weekly_digest_log_week on public.weekly_digest_log (week_of);

alter table public.weekly_digest_log enable row level security;
-- Written only by the service-role cron (bypasses RLS); no client write policy. Admins may read it.
drop policy if exists "digest_log_read" on public.weekly_digest_log;
create policy "digest_log_read" on public.weekly_digest_log
  for select to authenticated using (public.is_admin());
