-- 048_announcement_attachments.sql — optional file + link on announcements. Run after 047. Idempotent.
-- attachment_key is an R2 object key under announcements/… (world-readable to authed users; see lib/r2.js).
alter table public.announcements add column if not exists link_url        text;
alter table public.announcements add column if not exists attachment_key  text;
alter table public.announcements add column if not exists attachment_name text;
-- RLS unchanged: ann_read (any authenticated user) + ann_admin_write (admins only) already cover
-- these columns, and announcements is already in the realtime publication.
