-- 043_late_comer_ack.sql — one-time "you joined late" popup acknowledgement.
-- Run in the Supabase SQL editor after 042. Idempotent (safe to re-run).
--
-- "Late comer" STATUS is computed live (a student's signup time vs their department's Week-1 task
-- upload time), so no stored status column is needed and existing users are covered automatically.
-- This only records that the one-time popup has been dismissed, so it never shows again.
--
-- Note: late_comer_ack is intentionally NOT added to protect_profile_columns' locked list, so a
-- student can set their own flag directly (profiles_update_own RLS already scopes it to their row).
alter table public.profiles add column if not exists late_comer_ack boolean not null default false;
