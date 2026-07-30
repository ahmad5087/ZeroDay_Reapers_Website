-- 036_chat_attachments.sql — file attachments in group chats. Run after 035. Idempotent.
-- Adds an optional R2 file reference to a message. Content still carries the caption (or the
-- file name) so the existing 1..2000 char_length check is satisfied. Announcements are a separate
-- table/flow and are intentionally NOT touched.
alter table public.messages add column if not exists file_key  text;  -- R2 key: chat/{uid}/...
alter table public.messages add column if not exists file_name text;  -- original file name
