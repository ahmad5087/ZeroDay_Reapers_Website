-- ZeroDay Reapers — RAM specs on signup + RAM-scoped tasks. Run after 014. Idempotent.
-- Students pick RAM (8GB/16GB/24GB) at signup; can't change it later. Admins can.
-- Tasks are tagged for a RAM tier (or 'All RAM' = null); students only see tasks for their RAM.

-- ---- profiles.ram ----
alter table public.profiles add column if not exists ram text;
alter table public.profiles drop constraint if exists profiles_ram_chk;
alter table public.profiles add constraint profiles_ram_chk
  check (ram is null or ram in ('8GB','16GB','24GB'));

-- ---- tasks.ram (null = every RAM tier) ----
alter table public.tasks add column if not exists ram text;
alter table public.tasks drop constraint if exists tasks_ram_chk;
alter table public.tasks add constraint tasks_ram_chk
  check (ram is null or ram in ('8GB','16GB','24GB'));

-- ---- signup trigger: store ram (keeps gender/avatar/status/kicked logic) ----
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := new.raw_user_meta_data;
  user_status text;
begin
  if exists (select 1 from public.kicked_emails where lower(email) = lower(new.email)) then
    user_status := 'pending';
  else
    user_status := 'approved';
  end if;

  insert into public.profiles (id, email, display_name, full_name, domain_id, gender, avatar_url, status, ram)
  values (
    new.id,
    new.email,
    coalesce(nullif(meta->>'display_name',''), split_part(new.email,'@',1)),
    meta->>'full_name',
    nullif(meta->>'domain_id','')::int,
    nullif(meta->>'gender',''),
    case lower(nullif(meta->>'gender',''))
      when 'male'   then '/avatars/male.webp'
      when 'female' then '/avatars/female.webp'
      else null
    end,
    user_status,
    nullif(meta->>'ram','')
  );
  return new;
end; $$;

-- ---- students can't change their own ram (admins can, via admin_set_ram) ----
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare is_admin boolean;
begin
  if auth.uid() is null then return new; end if;
  select (role = 'admin') into is_admin from public.profiles where id = auth.uid();
  if coalesce(is_admin,false) = false then
    if old.domain_id is not null then new.domain_id := old.domain_id; end if;
    new.role              := old.role;
    new.banned            := old.banned;
    new.timeout_until     := old.timeout_until;
    new.status            := old.status;
    new.is_alumni         := old.is_alumni;
    new.payment_confirmed := old.payment_confirmed;
    new.ram               := old.ram;
  end if;
  return new;
end; $$;

-- ---- admin changes a student's ram ----
create or replace function public.admin_set_ram(target uuid, new_ram text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then raise exception 'not authorized'; end if;
  update public.profiles set ram = new_ram where id = target;
  perform public.log_admin_action('set_ram', target, new_ram);
end; $$;
grant execute on function public.admin_set_ram(uuid, text) to authenticated;

-- ---- tasks visible to a student: matching domain AND matching RAM (or untagged) ----
drop policy if exists "tasks_read" on public.tasks;
create policy "tasks_read" on public.tasks
  for select to authenticated using (
    public.is_admin()
    or (
      (domain_id is null or domain_id = (select domain_id from public.profiles where id = auth.uid()))
      and (ram is null or ram = (select ram from public.profiles where id = auth.uid()))
    )
  );

-- expose ram on the safe view (handy for admin lists / badges)
drop view if exists public.public_profiles cascade;
create or replace view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, payment_proof_url, is_alumni, ram
  from public.profiles;
grant select on public.public_profiles to authenticated;
