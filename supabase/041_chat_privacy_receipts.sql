-- 041_chat_privacy_receipts.sql — WhatsApp-style chat privacy + group read receipts.
-- Run in the Supabase SQL editor after 040. Idempotent (safe to re-run).
--
-- Adds:
--   * "Delete for everyone" by the author  -> hidden from other students, STILL visible to
--     admins/founders (moderation preserved), via messages.author_deleted / dm_messages.author_deleted.
--   * "Delete for me"                       -> per-user hide rows (message_hides / dm_message_hides).
--   * "Clear chat" (group rooms only)       -> per-user watermark (room_clears).
--   * Group "message info" read receipts    -> per-user-per-room last-read watermark (room_reads),
--     one row per user per room (scales to hundreds of members).

-- 1) Author "delete for everyone" flag (distinct from admin moderation `deleted`).
alter table public.messages    add column if not exists author_deleted boolean not null default false;
alter table public.dm_messages add column if not exists author_deleted boolean not null default false;

-- 2) Per-user "delete for me" hides.
create table if not exists public.message_hides (
  user_id    uuid   not null references public.profiles(id) on delete cascade,
  message_id bigint not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
create table if not exists public.dm_message_hides (
  user_id       uuid   not null references public.profiles(id) on delete cascade,
  dm_message_id bigint not null references public.dm_messages(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, dm_message_id)
);

-- 3) Per-user "clear chat" watermark (group rooms only; Announcements are never cleared).
-- NOTE: domain_id is a plain int (NOT a FK to domains). A table with FKs to both profiles and
-- domains reads to PostgREST as a junction table, which makes the profiles->domains embed
-- ambiguous (PGRST201) and breaks the portal's profile query. domains are static, so we skip the FK.
create table if not exists public.room_clears (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  domain_id  int  not null,
  cleared_at timestamptz not null default now(),
  primary key (user_id, domain_id)
);

-- 4) Per-user per-room last-read watermark → drives "message info" seen/unseen.
create table if not exists public.room_reads (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  domain_id    int  not null,                       -- plain int, not a FK to domains (see room_clears note)
  last_read_at timestamptz not null default now(),
  primary key (user_id, domain_id)
);

-- Heal existing installs (this file's first version added the domains FKs): drop them so the
-- profiles->domains embed is unambiguous again. Idempotent.
alter table public.room_clears drop constraint if exists room_clears_domain_id_fkey;
alter table public.room_reads  drop constraint if exists room_reads_domain_id_fkey;

-- ---- RLS ----
alter table public.message_hides    enable row level security;
alter table public.dm_message_hides enable row level security;
alter table public.room_clears      enable row level security;
alter table public.room_reads       enable row level security;

drop policy if exists mh_all on public.message_hides;
create policy mh_all on public.message_hides for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists dmh_all on public.dm_message_hides;
create policy dmh_all on public.dm_message_hides for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists rc_all on public.room_clears;
create policy rc_all on public.room_clears for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- room_reads: readable by any authenticated user (needed to compute who has seen a message),
-- writable only for your own row.
drop policy if exists rr_select on public.room_reads;
create policy rr_select on public.room_reads for select to authenticated using (true);
drop policy if exists rr_write on public.room_reads;
create policy rr_write on public.room_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 5) Author-only "delete for everyone" (staff still read it; students no longer see it).
create or replace function public.message_delete_for_everyone(p_message_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.messages set author_deleted = true
   where id = p_message_id and user_id = auth.uid();
  if not found then raise exception 'not your message'; end if;
end; $$;
grant execute on function public.message_delete_for_everyone(bigint) to authenticated;

create or replace function public.dm_delete_for_everyone(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.dm_messages set author_deleted = true
   where id = p_id and sender_id = auth.uid();
  if not found then raise exception 'not your message'; end if;
end; $$;
grant execute on function public.dm_delete_for_everyone(bigint) to authenticated;

-- 6) Watermark upserts.
create or replace function public.mark_room_read(p_domain_id int)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.room_reads (user_id, domain_id, last_read_at)
  values (auth.uid(), p_domain_id, now())
  on conflict (user_id, domain_id) do update set last_read_at = now();
end; $$;
grant execute on function public.mark_room_read(int) to authenticated;

create or replace function public.clear_room(p_domain_id int)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.room_clears (user_id, domain_id, cleared_at)
  values (auth.uid(), p_domain_id, now())
  on conflict (user_id, domain_id) do update set cleared_at = now();
end; $$;
grant execute on function public.clear_room(int) to authenticated;

-- 6b) Let an intern mark that they've joined their Google Classroom from their profile.
--     classroom_confirmed is otherwise locked for interns by protect_profile_columns, so a
--     direct update would be reverted — this security-definer RPC updates only the caller's row.
create or replace function public.set_classroom_confirmed(p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set classroom_confirmed = p_value where id = auth.uid();
end; $$;
grant execute on function public.set_classroom_confirmed(boolean) to authenticated;

-- 7) Realtime so hides / receipts sync live across a user's own tabs and devices.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='message_hides') then
    alter publication supabase_realtime add table public.message_hides;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dm_message_hides') then
    alter publication supabase_realtime add table public.dm_message_hides;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='room_clears') then
    alter publication supabase_realtime add table public.room_clears;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='room_reads') then
    alter publication supabase_realtime add table public.room_reads;
  end if;
end $$;
