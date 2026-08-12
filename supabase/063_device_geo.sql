-- 063_device_geo.sql - approximate city/country per known device + geo-aware register_device.
-- Run after 062. Idempotent. Location is best-effort (resolved client-side from the user's IP at login)
-- and only ever coarse city/country - no precise coordinates, no raw IP is stored.

alter table public.user_devices add column if not exists city    text;
alter table public.user_devices add column if not exists country text;

-- Replace register_device with a geo-aware version. Drop the old 2-arg form first so the new
-- defaulted 4-arg form isn't ambiguous with it; old 2-arg call sites still work via the defaults.
-- Still returns TRUE only when the device row is newly inserted (drives the new-device alert).
drop function if exists public.register_device(text, text);
create or replace function public.register_device(
  p_device_id  text,
  p_user_agent text,
  p_city       text default null,
  p_country    text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare is_new boolean;
begin
  if auth.uid() is null then return false; end if;
  insert into public.user_devices (user_id, device_id, user_agent, city, country)
  values (auth.uid(), p_device_id, p_user_agent, nullif(p_city, ''), nullif(p_country, ''))
  on conflict (user_id, device_id)
    do update set last_seen  = now(),
                  user_agent = excluded.user_agent,
                  -- keep the last known location if this login couldn't resolve one
                  city       = coalesce(nullif(excluded.city, ''), user_devices.city),
                  country    = coalesce(nullif(excluded.country, ''), user_devices.country),
                  revoked_at = null   -- a fresh login clears any prior revoke
  returning (xmax = 0) into is_new;   -- xmax = 0 => the row was INSERTed (new device), not updated
  return coalesce(is_new, false);
end; $$;
grant execute on function public.register_device(text, text, text, text) to authenticated;
