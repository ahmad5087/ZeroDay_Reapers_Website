-- ================== ALUMNI GROUP & GRADUATION ==================
alter table public.profiles add column if not exists is_alumni boolean not null default false;

create or replace view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, payment_proof_url, is_alumni from public.profiles;
grant select on public.public_profiles to authenticated;

-- Insert Alumni Group into domains/rooms
insert into public.domains (key, name, sort) values ('alumni', 'Alumni Group', 8) on conflict (key) do nothing;

-- Admin RPC: set alumni status
create or replace function public.admin_set_alumni(target uuid, graduated boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.profiles set is_alumni = graduated where id = target;
end; $$;
grant execute on function public.admin_set_alumni(uuid, boolean) to authenticated;

-- Trigger: auto-graduate to Alumni when 6th task submission is approved
create or replace function public.auto_graduate_on_6_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  approved_count int;
begin
  if new.status = 'approved' then
    select count(*) into approved_count from public.submissions where student_id = new.student_id and status = 'approved';
    if approved_count >= 6 then
      update public.profiles set is_alumni = true where id = new.student_id;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_auto_graduate on public.submissions;
create trigger trg_auto_graduate
  after insert or update of status on public.submissions
  for each row execute function public.auto_graduate_on_6_tasks();

-- ================== 75-DAY DATA RETENTION CLEANUP ==================
create or replace function public.cleanup_75day_intern_data()
returns text[] language plpgsql security definer set search_path = public, auth as $$
declare
  expired_keys text[] := '{}';
  key text;
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;

  -- Collect file_keys from old submissions by non-admins (>75 days)
  for key in
    select s.file_key from public.submissions s
    join public.profiles p on p.id = s.student_id
    where p.role <> 'admin' and s.created_at < now() - interval '75 days' and s.file_key is not null
  loop
    expired_keys := array_append(expired_keys, key);
  end loop;

  -- Collect file_keys from old documents by non-admins (>75 days)
  for key in
    select d.file_key from public.documents d
    join public.profiles p on p.id = d.user_id
    where p.role <> 'admin' and d.created_at < now() - interval '75 days' and d.file_key is not null
  loop
    expired_keys := array_append(expired_keys, key);
  end loop;

  -- Delete old submissions
  delete from public.submissions where id in (
    select s.id from public.submissions s
    join public.profiles p on p.id = s.student_id
    where p.role <> 'admin' and s.created_at < now() - interval '75 days'
  );

  -- Delete old documents
  delete from public.documents where id in (
    select d.id from public.documents d
    join public.profiles p on p.id = d.user_id
    where p.role <> 'admin' and d.created_at < now() - interval '75 days'
  );

  -- Delete old messages in group chats
  delete from public.messages where id in (
    select m.id from public.messages m
    join public.profiles p on p.id = m.user_id
    where p.role <> 'admin' and m.created_at < now() - interval '75 days'
  );

  -- Delete old DM messages
  delete from public.dm_messages where id in (
    select dm.id from public.dm_messages dm
    join public.profiles p on p.id = dm.sender_id
    where p.role <> 'admin' and dm.created_at < now() - interval '75 days'
  );

  -- Clear payment proof if older than 75 days
  update public.profiles set payment_proof_url = null, payment_proof_submitted_at = null
  where role <> 'admin' and created_at < now() - interval '75 days';

  return expired_keys;
end; $$;
grant execute on function public.cleanup_75day_intern_data() to authenticated;

-- Update profile column protection to protect is_alumni
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
    new.is_alumni     := old.is_alumni;
  end if;
  return new;
end; $$;
