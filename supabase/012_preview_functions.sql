-- ZeroDay Reapers — Read-only PREVIEW functions for the destructive operations.
-- Run once after 011. These DELETE NOTHING — they only report what *would* happen,
-- so you can test the Week-4 purge and 75-day cleanup safely before trusting them.
-- Admin-gated (in the SQL Editor auth.uid() is null, which is treated as privileged).

-- ---- Preview: who would the Week-4 unpaid purge remove? (M3) ----
create or replace function public.audit_unpaid_preview()
returns table(id uuid, email text, display_name text, domain_id int, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin'
     and auth.uid() is not null then
    raise exception 'not authorized';
  end if;
  return query
    select p.id, p.email, p.display_name, p.domain_id, p.created_at
    from public.profiles p
    where p.role <> 'admin' and p.payment_proof_url is null
    order by p.created_at;
end; $$;
grant execute on function public.audit_unpaid_preview() to authenticated;

-- ---- Preview: what would the 75-day cleanup delete? (M4) ----
create or replace function public.cleanup_75day_preview()
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin'
     and auth.uid() is not null then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'submissions_to_delete', (
      select count(*) from public.submissions s join public.profiles p on p.id = s.user_id
      where p.role <> 'admin' and s.submitted_at < now() - interval '75 days'),
    'documents_to_delete', (
      select count(*) from public.documents d join public.profiles p on p.id = d.user_id
      where p.role <> 'admin' and d.created_at < now() - interval '75 days'),
    'messages_to_delete', (
      select count(*) from public.messages m join public.profiles p on p.id = m.user_id
      where p.role <> 'admin' and m.created_at < now() - interval '75 days'),
    'dm_messages_to_delete', (
      select count(*) from public.dm_messages dm join public.profiles p on p.id = dm.sender_id
      where p.role <> 'admin' and dm.created_at < now() - interval '75 days'),
    'r2_keys_sample', (
      select coalesce(jsonb_agg(k), '[]'::jsonb) from (
        select s.file_path k from public.submissions s join public.profiles p on p.id = s.user_id
          where p.role <> 'admin' and s.submitted_at < now() - interval '75 days' and s.file_path is not null
        union all
        select d.file_key from public.documents d join public.profiles p on p.id = d.user_id
          where p.role <> 'admin' and d.created_at < now() - interval '75 days' and d.file_key is not null
        limit 20
      ) t)
  ) into result;
  return result;
end; $$;
grant execute on function public.cleanup_75day_preview() to authenticated;
