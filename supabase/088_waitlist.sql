-- 088_waitlist.sql — Cohort waitlist / apply funnel (Phase 12 — growth: portal). Run after 087. Idempotent.
-- Public `/apply` collects demand between cohorts. Admin-only reads; the public writes only through the
-- anon `join_waitlist()` RPC. Flag `waitlist` gates whether the form is open (off → "not open" message),
-- so you can collect a waitlist, then open applications, without a deploy.

create table if not exists public.waitlist (
  id         bigint generated always as identity primary key,
  email      text not null unique,
  name       text,
  source     text,
  created_at timestamptz not null default now()
);
alter table public.waitlist enable row level security;

drop policy if exists "waitlist_admin" on public.waitlist;
create policy "waitlist_admin" on public.waitlist
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.feature_flags (key, label) values
  ('waitlist', 'Cohort waitlist / apply funnel (Phase 12)')
on conflict (key) do nothing;

create or replace function public.join_waitlist(p_email text, p_name text, p_source text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_email, '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email';
  end if;
  insert into public.waitlist (email, name, source)
  values (lower(left(p_email, 180)), left(nullif(p_name, ''), 120), left(nullif(p_source, ''), 60))
  on conflict (email) do nothing;
end; $$;
grant execute on function public.join_waitlist(text, text, text) to anon, authenticated;
