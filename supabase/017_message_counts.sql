-- 017_message_counts.sql — admin-only message-count analytics.
-- SECURITY DEFINER so counts span all rooms; every function guards on is_admin().
-- Idempotent: safe to re-run.

-- Per-room counts (used in the chat members sidebar).
create or replace function public.room_message_counts(p_domain_id int)
returns table(user_id uuid, cnt bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
    select m.user_id, count(*)::bigint
    from public.messages m
    where m.domain_id = p_domain_id and m.deleted = false
    group by m.user_id;
end $$;

-- Global leaderboard across every group chat (used in the Admin panel).
create or replace function public.global_message_counts(p_limit int default 25)
returns table(user_id uuid, display_name text, domain_id int, cnt bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
    select m.user_id, pp.display_name, pp.domain_id, count(*)::bigint as c
    from public.messages m
    left join public.profiles pp on pp.id = m.user_id
    where m.deleted = false
    group by m.user_id, pp.display_name, pp.domain_id
    order by c desc
    limit greatest(1, p_limit);
end $$;

grant execute on function public.room_message_counts(int) to authenticated;
grant execute on function public.global_message_counts(int) to authenticated;
