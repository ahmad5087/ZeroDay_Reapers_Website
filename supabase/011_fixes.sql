-- ZeroDay Reapers — Corrective migration. Run once in Supabase SQL Editor after 010. Idempotent.
-- Fixes three confirmed defects introduced by earlier migrations:
--   C1  007 referenced submissions.student_id / submissions.file_key — the table has user_id / file_path.
--       (auto_graduate trigger errored on every submission insert/grade; cleanup used a non-existent column.)
--   C2  handle_new_user (006) dropped gender + default avatar — restored here alongside the kicked/status logic.
--   C3  Week-4 unpaid removal fired on INSERT *or UPDATE* — any later task edit re-ran a mass account delete.

-- ================= C1: auto-graduate uses the real column (user_id) =================
create or replace function public.auto_graduate_on_6_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
declare approved_count int;
begin
  if new.status = 'approved' then
    select count(*) into approved_count
      from public.submissions where user_id = new.user_id and status = 'approved';
    if approved_count >= 6 then
      update public.profiles set is_alumni = true where id = new.user_id;
    end if;
  end if;
  return new;
end; $$;

-- ================= C1: 75-day cleanup uses user_id + file_path on submissions =================
create or replace function public.cleanup_75day_intern_data()
returns text[] language plpgsql security definer set search_path = public, auth as $$
declare
  expired_keys text[] := '{}';
  key text;
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;

  -- submission files (submissions.file_path is the R2 key)
  for key in
    select s.file_path from public.submissions s
    join public.profiles p on p.id = s.user_id
    where p.role <> 'admin' and s.submitted_at < now() - interval '75 days' and s.file_path is not null
  loop
    expired_keys := array_append(expired_keys, key);
  end loop;

  -- document files (documents.file_key is the R2 key)
  for key in
    select d.file_key from public.documents d
    join public.profiles p on p.id = d.user_id
    where p.role <> 'admin' and d.created_at < now() - interval '75 days' and d.file_key is not null
  loop
    expired_keys := array_append(expired_keys, key);
  end loop;

  delete from public.submissions s
    using public.profiles p
    where p.id = s.user_id and p.role <> 'admin' and s.submitted_at < now() - interval '75 days';

  delete from public.documents d
    using public.profiles p
    where p.id = d.user_id and p.role <> 'admin' and d.created_at < now() - interval '75 days';

  delete from public.messages m
    using public.profiles p
    where p.id = m.user_id and p.role <> 'admin' and m.created_at < now() - interval '75 days';

  delete from public.dm_messages dm
    using public.profiles p
    where p.id = dm.sender_id and p.role <> 'admin' and dm.created_at < now() - interval '75 days';

  update public.profiles set payment_proof_url = null, payment_proof_submitted_at = null
    where role <> 'admin' and created_at < now() - interval '75 days';

  return expired_keys;
end; $$;

-- ================= C2: restore gender + default avatar in signup trigger =================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := new.raw_user_meta_data;
  user_status text;
begin
  -- previously kicked/deleted emails must be re-approved by an admin
  if exists (select 1 from public.kicked_emails where lower(email) = lower(new.email)) then
    user_status := 'pending';
  else
    user_status := 'approved';
  end if;

  insert into public.profiles (id, email, display_name, full_name, domain_id, gender, avatar_url, status)
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
    user_status
  );
  return new;
end; $$;

-- ================= C3: Week-4 unpaid removal only on INSERT (never on task edits) =================
drop trigger if exists trg_week4_unpaid_removal on public.tasks;
create trigger trg_week4_unpaid_removal
  after insert on public.tasks
  for each row execute function public.auto_remove_unpaid_on_week4();
