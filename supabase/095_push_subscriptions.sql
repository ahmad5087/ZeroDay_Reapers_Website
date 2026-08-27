-- 095_push_subscriptions.sql — Web Push (Phase 17). Stores each browser/device push subscription so the
-- server can deliver Web Push notifications (VAPID / Web Push Protocol). Run after 094. Idempotent.
-- RLS: a user manages ONLY their own subscriptions; the server sends via the service role (bypasses RLS).
create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_own_select" on public.push_subscriptions;
create policy "push_own_select" on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists "push_own_insert" on public.push_subscriptions;
create policy "push_own_insert" on public.push_subscriptions
  for insert with check (user_id = auth.uid());

drop policy if exists "push_own_update" on public.push_subscriptions;
create policy "push_own_update" on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "push_own_delete" on public.push_subscriptions;
create policy "push_own_delete" on public.push_subscriptions
  for delete using (user_id = auth.uid());
