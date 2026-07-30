-- 031_replies_reactions.sql — message replies + emoji reactions for group chat AND DMs.
-- Run after 030. Idempotent. (Announcements stay reactions-only via their own table — untouched.)

-- ============ GROUP CHAT ============
alter table public.messages add column if not exists reply_to bigint references public.messages(id) on delete set null;

create table if not exists public.message_reactions (
  id         bigint generated always as identity primary key,
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id    uuid   not null references public.profiles(id) on delete cascade,
  emoji      text   not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create index if not exists message_reactions_msg on public.message_reactions (message_id);
alter table public.message_reactions replica identity full; -- DELETE events carry the row (live removal)
alter table public.message_reactions enable row level security;

drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions
  for select to authenticated using (true);
drop policy if exists message_reactions_insert on public.message_reactions;
create policy message_reactions_insert on public.message_reactions
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists message_reactions_delete on public.message_reactions;
create policy message_reactions_delete on public.message_reactions
  for delete to authenticated using (user_id = auth.uid());

-- ============ DIRECT MESSAGES ============
alter table public.dm_messages add column if not exists reply_to bigint references public.dm_messages(id) on delete set null;

create table if not exists public.dm_reactions (
  id            bigint generated always as identity primary key,
  dm_message_id bigint not null references public.dm_messages(id) on delete cascade,
  user_id       uuid   not null references public.profiles(id) on delete cascade,
  emoji         text   not null,
  created_at    timestamptz not null default now(),
  unique (dm_message_id, user_id, emoji)
);
create index if not exists dm_reactions_msg on public.dm_reactions (dm_message_id);
alter table public.dm_reactions replica identity full;
alter table public.dm_reactions enable row level security;

-- DM reactions are visible/insertable only by the thread's participants (student + admins).
drop policy if exists dm_reactions_select on public.dm_reactions;
create policy dm_reactions_select on public.dm_reactions
  for select to authenticated using (
    exists (select 1 from public.dm_messages dm
            where dm.id = dm_message_id and (dm.student_id = auth.uid() or public.is_admin()))
  );
drop policy if exists dm_reactions_insert on public.dm_reactions;
create policy dm_reactions_insert on public.dm_reactions
  for insert to authenticated with check (
    user_id = auth.uid() and exists (
      select 1 from public.dm_messages dm
      where dm.id = dm_message_id and (dm.student_id = auth.uid() or public.is_admin()))
  );
drop policy if exists dm_reactions_delete on public.dm_reactions;
create policy dm_reactions_delete on public.dm_reactions
  for delete to authenticated using (user_id = auth.uid());

-- ============ REALTIME ============
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dm_reactions') then
    alter publication supabase_realtime add table public.dm_reactions;
  end if;
end $$;
