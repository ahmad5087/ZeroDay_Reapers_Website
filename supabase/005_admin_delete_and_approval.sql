-- ================== ACCOUNT APPROVAL STATUS ==================
alter table public.profiles add column if not exists status text not null default 'approved' check (status in ('pending', 'approved', 'rejected'));

-- Update public_profiles view to include status
drop view if exists public.public_profiles cascade;
create or replace view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status from public.profiles;
grant select on public.public_profiles to authenticated;

-- =============== AUTO-CREATE PROFILE ON SIGNUP WITH PENDING STATUS ===============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, full_name, domain_id, status)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'full_name',
    nullif(new.raw_user_meta_data->>'domain_id','')::int,
    'pending'
  );
  return new;
end; $$;

-- =============== ADMIN: SET APPROVAL STATUS ===============
create or replace function public.admin_set_status(target uuid, new_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.profiles set status = new_status where id = target;
end; $$;
grant execute on function public.admin_set_status(uuid, text) to authenticated;

-- =============== ADMIN: DELETE USER ACCOUNT ===============
create or replace function public.admin_delete_user(target_user_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized: only admins can delete users';
  end if;

  delete from public.profiles where id = target_user_id;
  delete from auth.users where id = target_user_id;
end; $$;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ===== PREVENT STUDENTS CHANGING THEIR OWN STATUS =====
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare is_admin boolean;
begin
  if auth.uid() is null then return new; end if;
  select (role = 'admin') into is_admin from public.profiles where id = auth.uid();
  if coalesce(is_admin,false) = false then
    if old.domain_id is not null then new.domain_id := old.domain_id; end if;
    new.role          := old.role;
    new.banned        := old.banned;
    new.timeout_until := old.timeout_until;
    new.status        := old.status;
  end if;
  return new;
end; $$;
