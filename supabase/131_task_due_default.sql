-- 131_task_due_default.sql — a task's deadline defaults to 7 days after it goes live.
--
-- Founders upload weekly tasks and the "Due date" field is optional; left blank, due_at was NULL and the
-- task never appeared on the intern Calendar (CalendarScreen fetches `.not(due_at is null)`). Per founder
-- request, a missing deadline now means "7 days after the task goes live", where go-live is the task's
-- publish_at (a scheduled release, migration 130) or, for an immediately-published task, its created_at.
--
-- Idempotent and independent of 130: re-adds publish_at with IF NOT EXISTS (a no-op once 130 has run), so
-- this is safe to run whether or not the scheduler migration is applied yet. Run after 129.

-- Ensure the column we read exists even if the scheduler migration (130) has not been applied yet.
alter table public.tasks add column if not exists publish_at timestamptz;

-- Backfill: every task with no deadline (e.g. Week-1 rows uploaded with the Due date left blank) gets
-- its go-live + 7 days. A scheduled task uses publish_at; an immediate one uses created_at.
update public.tasks
  set due_at = coalesce(publish_at, created_at) + interval '7 days'
  where due_at is null;

-- Going forward: fill due_at on insert whenever the admin leaves it blank. Column defaults (created_at's
-- now()) are applied before BEFORE-INSERT triggers fire, so new.created_at is already set here.
create or replace function public.task_default_due_at()
returns trigger language plpgsql as $$
begin
  if new.due_at is null then
    new.due_at := coalesce(new.publish_at, new.created_at, now()) + interval '7 days';
  end if;
  return new;
end; $$;

drop trigger if exists task_default_due_at on public.tasks;
create trigger task_default_due_at
  before insert on public.tasks
  for each row execute function public.task_default_due_at();
