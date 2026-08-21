-- 078_alumni_board.sql — Alumni opportunities board (Phase 7, #7). Run after 077. Idempotent.
-- Jobs / referrals / competitions / certifications / volunteer projects. Admins publish (admin-write
-- RLS, like live_sessions); interns + alumni browse published ones, save, and track applications.
-- Flag: alumni_board.

create table if not exists public.opportunities (
  id           bigint generated always as identity primary key,
  type         text not null default 'job' check (type in ('job','referral','competition','certification','volunteer')),
  title        text not null check (char_length(title) between 1 and 200),
  org          text,
  link         text,
  description  text check (description is null or char_length(description) <= 4000),
  location     text,
  posted_by    uuid references public.profiles(id) on delete set null,
  expires_at   timestamptz,
  is_published boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists opportunities_pub on public.opportunities (is_published, created_at desc);

create table if not exists public.opportunity_saves (
  user_id        uuid   not null references public.profiles(id) on delete cascade,
  opportunity_id bigint not null references public.opportunities(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (user_id, opportunity_id)
);

create table if not exists public.applications (
  id             bigint generated always as identity primary key,
  opportunity_id bigint not null references public.opportunities(id) on delete cascade,
  user_id        uuid   not null references public.profiles(id) on delete cascade,
  status         text not null default 'applied' check (status in ('saved','applied','interview','offer','rejected','withdrawn')),
  notes          text check (notes is null or char_length(notes) <= 2000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (opportunity_id, user_id)
);
create index if not exists applications_user on public.applications (user_id, updated_at desc);

alter table public.opportunities     enable row level security;
alter table public.opportunity_saves enable row level security;
alter table public.applications       enable row level security;

-- Opportunities: read published (or admin); admins create/update/delete directly.
drop policy if exists "opportunities_read" on public.opportunities;
create policy "opportunities_read" on public.opportunities
  for select to authenticated using (is_published or public.is_admin());
drop policy if exists "opportunities_admin_write" on public.opportunities;
create policy "opportunities_admin_write" on public.opportunities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Saves + applications: users own their rows (admins may read applications).
drop policy if exists "opp_saves_rw" on public.opportunity_saves;
create policy "opp_saves_rw" on public.opportunity_saves
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "applications_rw" on public.applications;
create policy "applications_rw" on public.applications
  for all to authenticated using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid());

create or replace function public.touch_application()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists touch_application_trg on public.applications;
create trigger touch_application_trg before update on public.applications
  for each row execute function public.touch_application();
