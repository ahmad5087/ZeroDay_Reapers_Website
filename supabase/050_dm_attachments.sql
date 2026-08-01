-- 050_dm_attachments.sql — file attachments in DMs (student ↔ admin). Run after 049. Idempotent.
-- Files live in R2 under dm/{student_id}/… so ownsKey() limits download to that student + admins
-- (NOT the world-readable chat/ prefix — DMs are private).
alter table public.dm_messages add column if not exists file_key  text;
alter table public.dm_messages add column if not exists file_name text;
-- RLS unchanged: the existing dm_messages insert/select policies already gate by student_id / sender,
-- and content stays non-empty (the client stores the caption or the file name as the message text).
