-- 054_move_first_blood_to_milestones.sql — one-time: move existing "First Blood" posts out of
-- Announcements into the Milestones feed (they predate migration 053). Run AFTER 053.
-- Idempotent: once moved, the source rows are gone, so re-running matches nothing and is a no-op.

insert into public.milestones (title, body, created_at)
  select title, body, created_at
    from public.announcements
   where title ilike '%first blood%';

delete from public.announcements
 where title ilike '%first blood%';
