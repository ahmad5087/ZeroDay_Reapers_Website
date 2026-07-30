-- 040_realtime_profiles.sql — broadcast profile inserts/updates over Realtime so the founder
-- "User Records" panel and the admin member lists update live as people sign up / change.
-- Run after 039. Idempotent. RLS still applies to Realtime, so a client only receives rows it
-- is allowed to SELECT (admins/founders see all; a student only sees their own).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
