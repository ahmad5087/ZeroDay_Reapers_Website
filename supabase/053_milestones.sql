-- 053_milestones.sql — a separate READ-ONLY feed for auto-posted achievements (First Blood + future
-- badges), kept out of Announcements so that channel stays for important manual posts. After 052. Idempotent.

create table if not exists public.milestones (
  id         bigint generated always as identity primary key,
  title      text not null,
  body       text not null,
  created_at timestamptz not null default now()
);

alter table public.milestones enable row level security;
-- Everyone reads; NOBODY writes from the client (no insert/update/delete policy at all). Only the
-- security-definer trigger below (which bypasses RLS) posts here — so it is display-only for everyone,
-- including admins and founders.
drop policy if exists milestones_read on public.milestones;
create policy milestones_read on public.milestones for select to authenticated using (true);

-- First Blood: when a submission first becomes 'approved' for its task, post a milestone. Moved
-- server-side from the client so it can't be raced/missed and can write to the locked table.
create or replace function public.emit_first_blood()
returns trigger language plpgsql security definer set search_path = public as $$
declare wk int; ttl text; sname text;
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if not exists (
      select 1 from public.submissions s
       where s.task_id = new.task_id and s.status = 'approved' and s.id <> new.id
    ) then
      select week, title into wk, ttl from public.tasks where id = new.task_id;
      select display_name into sname from public.profiles where id = new.user_id;
      insert into public.milestones (title, body)
      values (
        '🩸 First Blood',
        coalesce(sname, 'A reaper') || ' is first to clear Week ' || coalesce(wk::text, '?')
          || ' · ' || coalesce(ttl, 'a task') || '. Respect. Who''s next?'
      );
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists first_blood_trg on public.submissions;
create trigger first_blood_trg after insert or update on public.submissions
  for each row execute function public.emit_first_blood();

-- Realtime so new milestones appear live in the feed.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='milestones') then
    alter publication supabase_realtime add table public.milestones;
  end if;
end $$;
