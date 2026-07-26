-- ZeroDay Reapers — Portal Phase 4 migration: Add file attachment support to tasks.
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.

alter table public.tasks add column if not exists file_path text;
alter table public.tasks add column if not exists file_name text;
