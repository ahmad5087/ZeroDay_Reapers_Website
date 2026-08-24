-- 087_subscribers.sql — Newsletter / lead capture (Phase 11 — growth). Run after 086. Idempotent.
-- Captures emails from the marketing site (Insights) so slow-burn leads aren't lost. Admin-only reads;
-- the public writes only through the anon `subscribe()` RPC. Sending the nurture drip reuses Resend and
-- is a founder-cadence decision (see docs/phases/PHASE-11-WEBSITE.md) — not wired to auto-send here.

create table if not exists public.subscribers (
  id           bigint generated always as identity primary key,
  email        text not null unique,
  source       text,
  unsubscribed boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.subscribers enable row level security;

drop policy if exists "subscribers_admin" on public.subscribers;
create policy "subscribers_admin" on public.subscribers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Public double-checks the email shape, then inserts (idempotent on email).
create or replace function public.subscribe(p_email text, p_source text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_email, '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email';
  end if;
  insert into public.subscribers (email, source)
  values (lower(left(p_email, 180)), left(nullif(p_source, ''), 60))
  on conflict (email) do nothing;
end; $$;
grant execute on function public.subscribe(text, text) to anon, authenticated;
