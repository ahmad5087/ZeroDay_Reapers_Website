-- ================== AUTOMOD & 10-MINUTE TIMEOUT ==================
-- Automatically detect abuse/NSFW/slurs, timeout user for 10 mins, and remove message.

alter table public.dm_messages add column if not exists deleted boolean not null default false;

create or replace function public.automod_check_message()
returns trigger
language plpgsql
security definer
as $$
declare
  is_adm boolean;
  sender uuid;
begin
  if tg_table_name = 'dm_messages' then
    sender := new.sender_id;
  else
    sender := new.user_id;
  end if;

  select (role = 'admin') into is_adm from public.profiles where id = sender;

  if coalesce(is_adm, false) = false then
    if new.content ~* '\b(fuck|shit|bitch|asshole|cunt|dick|pussy|cock|bastard|whore|slut|nigger|faggot|retard|wank|twat|douche|jackass|motherfucker|bollocks|crap|piss|nsfw)\b' then
      -- Automatically timeout user for 10 minutes
      update public.profiles
      set timeout_until = now() + interval '10 minutes'
      where id = sender;

      -- Mark message as removed and flag content
      new.content := '⚠️ [Message removed by AutoMod: Abusive or NSFW language detected. User timed out for 10 minutes.]';
      new.deleted := true;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_automod_messages on public.messages;
create trigger trg_automod_messages
  before insert on public.messages
  for each row
  execute function public.automod_check_message();

drop trigger if exists trg_automod_dm on public.dm_messages;
create trigger trg_automod_dm
  before insert on public.dm_messages
  for each row
  execute function public.automod_check_message();

-- ================== ADMIN DELETE PERMISSIONS ==================
drop policy if exists "messages_admin_delete" on public.messages;
create policy "messages_admin_delete" on public.messages
  for delete to authenticated using (
    (select role from public.profiles where id = auth.uid()) = 'admin'
  );

drop policy if exists "dm_admin_update" on public.dm_messages;
create policy "dm_admin_update" on public.dm_messages
  for update to authenticated using (
    (select role from public.profiles where id = auth.uid()) = 'admin'
  );

drop policy if exists "dm_admin_delete" on public.dm_messages;
create policy "dm_admin_delete" on public.dm_messages
  for delete to authenticated using (
    (select role from public.profiles where id = auth.uid()) = 'admin'
  );

drop policy if exists "ann_admin_delete" on public.announcements;
create policy "ann_admin_delete" on public.announcements
  for delete to authenticated using (
    (select role from public.profiles where id = auth.uid()) = 'admin'
  );

-- ================== IDEMPOTENT PUBLIC_PROFILES VIEW ==================
drop view if exists public.public_profiles cascade;
create or replace view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, payment_proof_url, is_alumni from public.profiles;
grant select on public.public_profiles to authenticated;
