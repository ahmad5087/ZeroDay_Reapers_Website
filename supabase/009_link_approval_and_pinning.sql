-- ================== LINK MODERATION & MESSAGE PINNING ==================

-- 1. Add columns for link moderation and pinning to messages
alter table public.messages add column if not exists link_status text not null default 'approved' check (link_status in ('approved', 'pending', 'rejected'));
alter table public.messages add column if not exists is_pinned boolean not null default false;
alter table public.messages add column if not exists pinned_at timestamptz;

-- 2. Add columns for pinning to announcements and DM messages
alter table public.announcements add column if not exists is_pinned boolean not null default false;
alter table public.announcements add column if not exists pinned_at timestamptz;
alter table public.dm_messages add column if not exists is_pinned boolean not null default false;
alter table public.dm_messages add column if not exists pinned_at timestamptz;

-- 3. Database Trigger: Automatically mark links sent by non-admins as pending approval
create or replace function public.check_link_approval()
returns trigger
language plpgsql
security definer
as $$
declare
  is_adm boolean;
begin
  select (role = 'admin') into is_adm from public.profiles where id = new.user_id;
  if coalesce(is_adm, false) = false then
    -- If message contains a web link or URL
    if new.content ~* '(https?://\s*[^\s]+|www\.\s*[^\s]+|\b[a-z0-9][a-z0-9.-]*\.(com|org|net|io|ai|pk|edu|gov|co|uk|us|ca|dev|app|tech|info|tv|gg|xyz|biz|au|de|fr|jp|cn|ru|br|nl|se|es|mil|int|site|online|store|shop|blog|club|vip|live|cloud|pro)\b(\/[^\s]*)?)' then
      new.link_status := 'pending';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_link_approval on public.messages;
create trigger trg_link_approval
  before insert on public.messages
  for each row
  execute function public.check_link_approval();

-- 4. Recreate public_profiles view idempotently
drop view if exists public.public_profiles cascade;
create or replace view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, payment_proof_url, is_alumni from public.profiles;
grant select on public.public_profiles to authenticated;
