-- ZeroDay Reapers — Portal Phase: gender/default avatar + admin DMs.
-- Run once in Supabase SQL Editor after 002. Idempotent.

-- ========================= GENDER + DEFAULT AVATAR =========================
alter table public.profiles add column if not exists gender text;
alter table public.profiles drop constraint if exists profiles_gender_chk;
alter table public.profiles add constraint profiles_gender_chk
  check (gender is null or gender in ('male','female'));

-- Signup trigger: store gender + pick the default avatar from it.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare meta jsonb := new.raw_user_meta_data;
begin
  insert into public.profiles (id, email, display_name, full_name, domain_id, gender, avatar_url)
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
    end
  );
  return new;
end; $$;

-- ========================= DIRECT MESSAGES (student <-> admins) =========================
-- One thread per student, shared by all admins. Students cannot DM each other.
create table if not exists public.dm_messages (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.profiles(id) on delete cascade, -- thread owner (the non-admin)
  sender_id  uuid not null references public.profiles(id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists dm_thread on public.dm_messages (student_id, created_at);
alter table public.dm_messages replica identity full;
alter table public.dm_messages enable row level security;

-- read: your own thread, or any admin
drop policy if exists "dm_read" on public.dm_messages;
create policy "dm_read" on public.dm_messages
  for select to authenticated using (student_id = auth.uid() or public.is_admin());

-- insert: a student may only write to THEIR OWN thread; an admin may write to any thread.
-- This makes student<->student DMs impossible (a student can't set student_id to someone else).
drop policy if exists "dm_insert" on public.dm_messages;
create policy "dm_insert" on public.dm_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and (
      (student_id = auth.uid() and not public.is_admin())
      or public.is_admin()
    )
  );

-- realtime (idempotent)
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='dm_messages') then
    alter publication supabase_realtime add table public.dm_messages;
  end if;
end $$;
