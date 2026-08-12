-- 059_secure_founder_user_records.sql
-- Replace the public auth.users-backed founder_user_records view with a founder-only RPC.
--
-- Why: Supabase Security Advisor flags public-schema views that read auth.users
-- (auth_users_exposed), even when the view filters to founders. Keep auth.users
-- access behind an explicit SECURITY DEFINER function that rejects non-founders.

drop view if exists public.founder_user_records cascade;

create or replace function public.get_founder_user_records()
returns table (
  id uuid,
  email text,
  display_name text,
  full_name text,
  gender text,
  domain_id int,
  role text,
  status text,
  is_alumni boolean,
  is_founder boolean,
  country text,
  dial_code text,
  phone text,
  member_id text,
  ram text,
  discord_username text,
  has_password boolean,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  auth_created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_founder() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.email,
    p.display_name,
    p.full_name,
    p.gender,
    p.domain_id,
    p.role,
    p.status,
    p.is_alumni,
    p.is_founder,
    p.country,
    p.dial_code,
    p.phone,
    p.member_id,
    p.ram,
    p.discord_username,
    (u.encrypted_password is not null) as has_password,
    u.last_sign_in_at,
    u.email_confirmed_at,
    u.created_at as auth_created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  order by u.created_at desc;
end;
$$;

revoke all on function public.get_founder_user_records() from public;
grant execute on function public.get_founder_user_records() to authenticated;
