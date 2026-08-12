-- 060_group_read_receipts_rpc.sql
-- Harden and fix group "message info" read receipts.
--
-- The client used to query room_reads directly. If table grants/RLS drifted on
-- production, that read failed silently and Message Info showed "Seen by 0".
-- Keep writes via mark_room_read(), but calculate seen/unseen through an RPC.

create table if not exists public.room_reads (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  domain_id    int  not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, domain_id)
);

alter table public.room_reads drop constraint if exists room_reads_domain_id_fkey;
alter table public.room_reads enable row level security;

drop policy if exists rr_select on public.room_reads;
create policy rr_select on public.room_reads for select to authenticated using (true);

drop policy if exists rr_write on public.room_reads;
create policy rr_write on public.room_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.room_reads from anon;
grant select, insert, update on public.room_reads to authenticated;

create or replace function public.mark_room_read(p_domain_id int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  insert into public.room_reads (user_id, domain_id, last_read_at)
  values (auth.uid(), p_domain_id, now())
  on conflict (user_id, domain_id) do update set last_read_at = now();
end;
$$;

revoke execute on function public.mark_room_read(int) from anon;
revoke execute on function public.mark_room_read(int) from public;
grant execute on function public.mark_room_read(int) to authenticated;

create or replace function public.get_message_read_receipts(p_message_id bigint)
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  role text,
  is_alumni boolean,
  domain_id int,
  country text,
  seen boolean,
  last_read_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.messages%rowtype;
  v_room_key text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_message
  from public.messages
  where id = p_message_id;

  if not found then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  if v_message.user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select key into v_room_key
  from public.domains
  where id = v_message.domain_id;

  return query
  select
    p.id,
    p.display_name,
    p.avatar_url,
    p.role,
    p.is_alumni,
    p.domain_id,
    p.country,
    coalesce(rr.last_read_at >= v_message.created_at, false) as seen,
    rr.last_read_at
  from public.profiles p
  left join public.room_reads rr
    on rr.user_id = p.id
   and rr.domain_id = v_message.domain_id
  where p.id <> auth.uid()
    and (
      p.role = 'admin'
      or (v_room_key = 'alumni' and p.is_alumni = true)
      or (v_room_key = 'lobby' and p.role <> 'admin' and p.is_alumni = false)
      or (v_room_key not in ('lobby', 'alumni') and p.domain_id = v_message.domain_id and p.is_alumni = false)
    )
  order by seen desc, p.display_name asc nulls last;
end;
$$;

revoke execute on function public.get_message_read_receipts(bigint) from anon;
revoke execute on function public.get_message_read_receipts(bigint) from public;
grant execute on function public.get_message_read_receipts(bigint) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_reads'
  ) then
    alter publication supabase_realtime add table public.room_reads;
  end if;
end $$;
