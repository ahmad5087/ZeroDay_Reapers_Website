-- 027_security.sql — device tracking (new-device alerts + active-devices list) + password-change marker.
-- Run after 026. Idempotent.

-- password-change marker (shown on the Security panel)
alter table public.profiles add column if not exists password_changed_at timestamptz;

-- known devices/browsers per user
create table if not exists public.user_devices (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  device_id  text not null,            -- random id persisted in the browser (localStorage)
  user_agent text,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  revoked_at timestamptz,                 -- set when this device is logged out from elsewhere
  unique (user_id, device_id)
);
create index if not exists user_devices_user on public.user_devices (user_id, last_seen desc);

alter table public.user_devices enable row level security;

drop policy if exists "devices_read_own" on public.user_devices;
create policy "devices_read_own" on public.user_devices
  for select to authenticated using (user_id = auth.uid());
-- users may forget their own devices from the Security panel
drop policy if exists "devices_delete_own" on public.user_devices;
create policy "devices_delete_own" on public.user_devices
  for delete to authenticated using (user_id = auth.uid());
-- inserts/updates go through register_device (SECURITY DEFINER) only

-- register a device on login; returns TRUE if it's new for this user (→ send a new-device alert).
create or replace function public.register_device(p_device_id text, p_user_agent text)
returns boolean language plpgsql security definer set search_path = public as $$
declare is_new boolean;
begin
  if auth.uid() is null then return false; end if;
  insert into public.user_devices (user_id, device_id, user_agent)
  values (auth.uid(), p_device_id, p_user_agent)
  on conflict (user_id, device_id)
    do update set last_seen = now(), user_agent = excluded.user_agent, revoked_at = null  -- a fresh login clears any prior revoke
  returning (xmax = 0) into is_new;   -- xmax = 0 ⇒ the row was INSERTed (new device), not updated
  return coalesce(is_new, false);
end; $$;
grant execute on function public.register_device(text, text) to authenticated;

-- Log out one specific device: mark it revoked. That device sees the change (Realtime) and
-- signs itself out. Users can only revoke their own devices.
create or replace function public.revoke_device(p_device_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update public.user_devices set revoked_at = now()
   where user_id = auth.uid() and device_id = p_device_id;
end; $$;
grant execute on function public.revoke_device(text) to authenticated;

-- Realtime so a revoked device is signed out promptly (full row so device_id is in the payload).
alter table public.user_devices replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='user_devices') then
    alter publication supabase_realtime add table public.user_devices;
  end if;
end $$;
