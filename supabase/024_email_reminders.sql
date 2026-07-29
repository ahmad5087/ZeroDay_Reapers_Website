-- 024_email_reminders.sql — de-dup markers for the deadline-reminder cron. Run after 023. Idempotent.
-- One row per (task, student) once a reminder email has been sent, so the daily cron never
-- emails the same student twice for the same task. Written/read only by the service-role cron.

create table if not exists public.task_deadline_reminders (
  task_id bigint      not null references public.tasks(id)    on delete cascade,
  user_id uuid        not null references public.profiles(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

alter table public.task_deadline_reminders enable row level security;
-- No policies on purpose: the cron uses the service role (bypasses RLS); no client may touch it.
