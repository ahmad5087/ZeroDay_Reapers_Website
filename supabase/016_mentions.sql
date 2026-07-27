-- 016_mentions.sql — @mentions with a persistent inbox (unread badge) + realtime beep.
-- Idempotent: safe to re-run.

create table if not exists public.mentions (
  id                bigint generated always as identity primary key,
  message_id        bigint references public.messages(id) on delete cascade, -- optional link
  domain_id         int references public.domains(id),
  author_id         uuid not null references public.profiles(id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles(id) on delete cascade,
  content           text,               -- snapshot for the inbox preview
  read              boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists mentions_recipient
  on public.mentions (mentioned_user_id, read, created_at desc);

alter table public.mentions enable row level security;

-- Recipient (or an admin) can read their mentions.
drop policy if exists mentions_select on public.mentions;
create policy mentions_select on public.mentions
  for select using (mentioned_user_id = auth.uid() or public.is_admin());

-- Only the message author may create a mention, and only as themselves.
drop policy if exists mentions_insert on public.mentions;
create policy mentions_insert on public.mentions
  for insert with check (author_id = auth.uid());

-- Recipient can mark their own mentions read.
drop policy if exists mentions_update_own on public.mentions;
create policy mentions_update_own on public.mentions
  for update using (mentioned_user_id = auth.uid())
  with check (mentioned_user_id = auth.uid());

-- Realtime (idempotent add).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mentions'
  ) then
    alter publication supabase_realtime add table public.mentions;
  end if;
end $$;
