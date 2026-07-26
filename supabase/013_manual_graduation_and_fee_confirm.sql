-- ZeroDay Reapers — Manual graduation + admin fee confirmation. Run after 012. Idempotent.
-- 1. Graduation is now MANUAL only (admin presses Graduate) — remove the auto-graduate trigger.
-- 2. Add an admin "Confirm Fee" flag (payment_confirmed) separate from account status.
--    Note: the Week-4 purge still targets students with NO proof uploaded (payment_proof_url is null);
--    payment_confirmed is a review marker and does not affect removal.

-- ---- 1. Stop auto-graduation on 6 approved tasks (Graduate button remains) ----
drop trigger if exists trg_auto_graduate on public.submissions;

-- ---- 2. Fee confirmation flag ----
alter table public.profiles add column if not exists payment_confirmed boolean not null default false;

-- Admins only can confirm/unconfirm a student's fee.
create or replace function public.admin_set_payment_confirmed(target uuid, confirmed boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.profiles set payment_confirmed = confirmed where id = target;
end; $$;
grant execute on function public.admin_set_payment_confirmed(uuid, boolean) to authenticated;

-- Students may still upload their own payment_proof_url, but cannot self-confirm.
-- (Re-declare the guard with payment_confirmed added; keeps all existing protections.)
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare is_admin boolean;
begin
  if auth.uid() is null then return new; end if;
  select (role = 'admin') into is_admin from public.profiles where id = auth.uid();
  if coalesce(is_admin,false) = false then
    if old.domain_id is not null then new.domain_id := old.domain_id; end if;
    new.role              := old.role;
    new.banned            := old.banned;
    new.timeout_until     := old.timeout_until;
    new.status            := old.status;
    new.is_alumni         := old.is_alumni;
    new.payment_confirmed := old.payment_confirmed;
  end if;
  return new;
end; $$;
