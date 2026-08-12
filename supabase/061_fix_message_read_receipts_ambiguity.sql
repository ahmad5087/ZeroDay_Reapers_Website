-- 061_fix_message_read_receipts_ambiguity.sql
-- Fix Postgres ambiguity in get_message_read_receipts().
--
-- In RETURNS TABLE functions, output column names such as id/domain_id/seen are
-- visible as PL/pgSQL variables. Qualify table columns and avoid ORDER BY output
-- names so Message Info does not fail with "column reference id is ambiguous".

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

  select msg.* into v_message
  from public.messages as msg
  where msg.id = p_message_id;

  if not found then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  if v_message.user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select d.key into v_room_key
  from public.domains as d
  where d.id = v_message.domain_id;

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
  from public.profiles as p
  left join public.room_reads as rr
    on rr.user_id = p.id
   and rr.domain_id = v_message.domain_id
  where p.id <> auth.uid()
    and (
      p.role = 'admin'
      or (v_room_key = 'alumni' and p.is_alumni = true)
      or (v_room_key = 'lobby' and p.role <> 'admin' and p.is_alumni = false)
      or (v_room_key not in ('lobby', 'alumni') and p.domain_id = v_message.domain_id and p.is_alumni = false)
    )
  order by coalesce(rr.last_read_at >= v_message.created_at, false) desc, p.display_name asc nulls last;
end;
$$;

revoke execute on function public.get_message_read_receipts(bigint) from anon;
revoke execute on function public.get_message_read_receipts(bigint) from public;
grant execute on function public.get_message_read_receipts(bigint) to authenticated;
