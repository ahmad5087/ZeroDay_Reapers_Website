-- 049_announcement_seen.sql — one-time "new announcement" login popup, tracked per ACCOUNT. After 048.
-- A pointer to the highest announcement id the user has already been shown. Existing rows default to 0,
-- so everyone gets the current newest announcement's popup once on their next login.
alter table public.profiles add column if not exists last_seen_announcement_id bigint not null default 0;

-- Advance the caller's pointer. security definer so protect_profile_columns can't revert it; only ever
-- moves forward (greatest), and only touches the caller's own row.
create or replace function public.mark_announcements_seen(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set last_seen_announcement_id = greatest(coalesce(last_seen_announcement_id, 0), p_id)
   where id = auth.uid();
end; $$;
grant execute on function public.mark_announcements_seen(bigint) to authenticated;
