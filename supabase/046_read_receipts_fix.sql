-- 046_read_receipts_fix.sql — guarantee group "seen" read-receipts work on the live DB.
-- Symptom this fixes: "Message info" always shows "Seen by 0", because the room_reads watermark
-- table / mark_room_read RPC / grants weren't fully in place (or writes were silently failing).
-- Re-runnable and idempotent — safe to run on production even if 041 already applied.

-- Per-user per-room last-read watermark → drives "message info" seen/unseen.
-- domain_id is a plain int (NOT a FK to domains) on purpose — a FK here makes the
-- profiles->domains embed ambiguous to PostgREST and breaks other portal queries.
create table if not exists public.room_reads (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  domain_id    int  not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, domain_id)
);
alter table public.room_reads drop constraint if exists room_reads_domain_id_fkey;

-- RLS: any authenticated user may READ all watermarks (needed to compute who has seen a message);
-- each user may WRITE only their own row.
alter table public.room_reads enable row level security;
drop policy if exists rr_select on public.room_reads;
create policy rr_select on public.room_reads for select to authenticated using (true);
drop policy if exists rr_write on public.room_reads;
create policy rr_write on public.room_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Watermark upsert. security definer so it runs regardless of the caller's RLS, writing only their row.
create or replace function public.mark_room_read(p_domain_id int)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.room_reads (user_id, domain_id, last_read_at)
  values (auth.uid(), p_domain_id, now())
  on conflict (user_id, domain_id) do update set last_read_at = now();
end; $$;
grant execute on function public.mark_room_read(int) to authenticated;

-- Realtime so receipts sync live across a user's own tabs/devices.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='room_reads') then
    alter publication supabase_realtime add table public.room_reads;
  end if;
end $$;
