-- 032_reply_notifications.sql — notify a message's author when someone replies to it.
-- Run after 031. Idempotent.
--
-- Reuses the mentions inbox (the 🔔 bell): a reply to your message drops a row into `mentions`
-- so you get the badge + beep + jump. A `kind` column distinguishes '@mention' from 'reply'.
alter table public.mentions add column if not exists kind text not null default 'mention'; -- 'mention' | 'reply'
