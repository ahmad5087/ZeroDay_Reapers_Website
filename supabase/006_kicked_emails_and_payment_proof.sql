-- ================== KICKED EMAILS TRACKING ==================
create table if not exists public.kicked_emails (
  email text primary key,
  kicked_at timestamptz not null default now(),
  reason text
);

-- ================== PAYMENT PROOF COLUMNS ==================
alter table public.profiles add column if not exists payment_proof_url text;
alter table public.profiles add column if not exists payment_proof_submitted_at timestamptz;

drop view if exists public.public_profiles cascade;
create or replace view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, payment_proof_url from public.profiles;
grant select on public.public_profiles to authenticated;

-- =============== AUTO-CREATE PROFILE: INITIALLY APPROVED UNLESS PREVIOUSLY KICKED ===============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  user_status text;
begin
  if exists (select 1 from public.kicked_emails where lower(email) = lower(new.email)) then
    user_status := 'pending';
  else
    user_status := 'approved';
  end if;

  insert into public.profiles (id, email, display_name, full_name, domain_id, status)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'full_name',
    nullif(new.raw_user_meta_data->>'domain_id','')::int,
    user_status
  );
  return new;
end; $$;

-- =============== ADMIN: DELETE USER ACCOUNT AND RECORD IN KICKED_EMAILS ===============
create or replace function public.admin_delete_user(target_user_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized: only admins can delete users';
  end if;

  -- Record email in kicked_emails so re-registration requires approval
  insert into public.kicked_emails (email, reason)
  select lower(email), 'Admin deleted/kicked account' from public.profiles where id = target_user_id and email is not null
  on conflict (email) do update set kicked_at = now(), reason = 'Admin deleted/kicked account';

  delete from public.profiles where id = target_user_id;
  delete from auth.users where id = target_user_id;
end; $$;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- =============== ADMIN: SET APPROVAL STATUS (CLEARS KICKED STATUS IF APPROVED) ===============
create or replace function public.admin_set_status(target uuid, new_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.profiles set status = new_status where id = target;
  if new_status = 'approved' then
    delete from public.kicked_emails where lower(email) = (select lower(email) from public.profiles where id = target);
  end if;
end; $$;
grant execute on function public.admin_set_status(uuid, text) to authenticated;

-- =============== ADMIN/SYSTEM: AUDIT AND AUTO-REMOVE UNPAID INTERNS (WEEK 4) ===============
create or replace function public.audit_unpaid_interns()
returns int language plpgsql security definer set search_path = public, auth as $$
declare removed_count int := 0;
declare rec record;
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;

  for rec in select id, email from public.profiles where role <> 'admin' and payment_proof_url is null loop
    if rec.email is not null then
      insert into public.kicked_emails (email, reason) values (lower(rec.email), 'Auto-removed: No payment proof submitted by Week 4')
      on conflict (email) do update set kicked_at = now(), reason = 'Auto-removed: No payment proof submitted by Week 4';
    end if;

    delete from public.profiles where id = rec.id;
    delete from auth.users where id = rec.id;
    removed_count := removed_count + 1;
  end loop;

  return removed_count;
end; $$;
grant execute on function public.audit_unpaid_interns() to authenticated;

-- =============== TRIGGER: AUTO-REMOVE UNPAID INTERNS WHEN WEEK 4 TASK IS PUBLISHED ===============
create or replace function public.auto_remove_unpaid_on_week4()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare rec record;
begin
  if new.week >= 4 then
    for rec in select id, email from public.profiles where role <> 'admin' and payment_proof_url is null loop
      if rec.email is not null then
        insert into public.kicked_emails (email, reason) values (lower(rec.email), 'Auto-removed: No payment proof submitted by Week 4')
        on conflict (email) do update set kicked_at = now(), reason = 'Auto-removed: No payment proof submitted by Week 4';
      end if;

      delete from public.profiles where id = rec.id;
      delete from auth.users where id = rec.id;
    end loop;
  end if;
  return new;
end; $$;
drop trigger if exists trg_week4_unpaid_removal on public.tasks;
create trigger trg_week4_unpaid_removal
  after insert or update on public.tasks
  for each row execute function public.auto_remove_unpaid_on_week4();
