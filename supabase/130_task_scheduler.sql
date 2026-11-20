-- 130_task_scheduler.sql — schedule a task's release for a future date/time.
--
-- A task with a FUTURE publish_at is hidden from interns (RLS below) and its "now live" announcement +
-- email are DEFERRED: the cron /api/cron/publish-tasks fires them once the time arrives, exactly once per
-- task (announced_at guard). publish_at NULL = publish immediately — the legacy behaviour, unchanged, so
-- every task that exists today keeps working with no backfill.
--
-- Deploy note: the admin "Create task" flow only writes publish_at / created_by when a release is
-- actually scheduled, so immediate task creation keeps working even before this migration runs. Run this
-- before using the "Schedule release" field (and before the publish-tasks cron can do anything).

alter table public.tasks
  add column if not exists publish_at   timestamptz,          -- when the task becomes visible + notifies
  add column if not exists announced_at timestamptz,          -- set by the cron once it has notified
  add column if not exists created_by   uuid;                 -- who the deferred announcement posts as

-- ---- tasks visible to a student: now also gated on publish_at (admins still see all, to schedule/preview)
-- Mirrors tasks_read from 120_tasks_per_cohort.sql with an added "is it live yet?" clause. A NULL
-- publish_at means "already published" (every legacy row), so nothing is hidden by the backfill-free add.
drop policy if exists "tasks_read" on public.tasks;
create policy "tasks_read" on public.tasks
  for select to authenticated using (
    public.is_admin()
    or (
      (publish_at is null or publish_at <= now())
      and (domain_id is null or domain_id = (select domain_id from public.profiles where id = auth.uid()))
      and (ram is null or ram = (select ram from public.profiles where id = auth.uid()))
      and (cohort is null or cohort = public.my_cohort())
    )
  );

-- Fast lookup for the cron: tasks whose release has (or will) arrive but haven't been announced yet.
create index if not exists tasks_publish_pending on public.tasks (publish_at)
  where publish_at is not null and announced_at is null;
