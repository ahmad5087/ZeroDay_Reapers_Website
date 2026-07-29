-- 028_founder_role.sql — Founder tier (a super-admin over the admin tier). Run after 027. Idempotent.
--
-- A FOUNDER is an admin (role='admin') carrying is_founder=true, so it inherits EVERY admin
-- capability automatically (is_admin(), all RLS, all admin RPCs) — nothing to special-case.
-- On top of that, ONLY a founder may delete / ban / edit other ADMIN accounts. Regular admins
-- keep managing students only. Enforced in the DB (triggers), so it holds even if a client is bypassed.
--
-- This migration also fixes the reason admins couldn't be deleted at all: four FKs pointed at the
-- admin who graded/decided/created/approved a row with the default (blocking) ON DELETE action.

-- 1) Founder flag ---------------------------------------------------------------------------------
alter table public.profiles add column if not exists is_founder boolean not null default false;

-- 2) Fix admin-referencing FKs so deleting an admin no longer violates a foreign key.
--    Keep the history row, just null out the reference to the departed admin.
alter table public.submissions              drop constraint if exists submissions_graded_by_fkey;
alter table public.submissions              add  constraint submissions_graded_by_fkey
  foreign key (graded_by)  references public.profiles(id) on delete set null;

alter table public.task_extension_requests  drop constraint if exists task_extension_requests_decided_by_fkey;
alter table public.task_extension_requests  add  constraint task_extension_requests_decided_by_fkey
  foreign key (decided_by) references public.profiles(id) on delete set null;

alter table public.live_sessions            drop constraint if exists live_sessions_created_by_fkey;
alter table public.live_sessions            add  constraint live_sessions_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.feedback                 drop constraint if exists feedback_approved_by_fkey;
alter table public.feedback                 add  constraint feedback_approved_by_fkey
  foreign key (approved_by) references public.profiles(id) on delete set null;

-- 3) Helper: is the caller a founder? (no RLS recursion, like is_admin) ---------------------------
create or replace function public.is_founder()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_founder = true);
$$;

-- 4) Column protection (extends 023): only a founder may grant/revoke is_founder, and a
--    NON-founder admin may not modify another admin/founder's protected columns.
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare caller_role text; caller_founder boolean; target_is_staff boolean;
begin
  if auth.uid() is null then return new; end if;              -- SQL editor / service role bypass
  select role, is_founder into caller_role, caller_founder from public.profiles where id = auth.uid();
  target_is_staff := (old.role = 'admin' or coalesce(old.is_founder, false));

  -- is_founder can only ever be granted/revoked by an existing founder.
  if (new.is_founder is distinct from old.is_founder) and coalesce(caller_founder, false) = false then
    new.is_founder := old.is_founder;
  end if;

  if coalesce(caller_role, 'student') <> 'admin' then
    -- non-admin: lock every protected column (original 023 behavior).
    if old.domain_id is not null then new.domain_id := old.domain_id; end if;
    new.role := old.role; new.banned := old.banned; new.timeout_until := old.timeout_until;
    new.status := old.status; new.is_alumni := old.is_alumni; new.payment_confirmed := old.payment_confirmed;
    new.ram := old.ram; new.discord_id := old.discord_id; new.discord_username := old.discord_username;
    new.classroom_confirmed := old.classroom_confirmed; new.is_founder := old.is_founder;
  elsif target_is_staff and coalesce(caller_founder, false) = false and auth.uid() <> old.id then
    -- a non-founder admin must not touch another admin/founder's protected columns.
    new.role := old.role; new.banned := old.banned; new.timeout_until := old.timeout_until;
    new.status := old.status; new.is_alumni := old.is_alumni; new.payment_confirmed := old.payment_confirmed;
    new.ram := old.ram; new.domain_id := old.domain_id;
    new.discord_id := old.discord_id; new.discord_username := old.discord_username;
    new.classroom_confirmed := old.classroom_confirmed; new.is_founder := old.is_founder;
  end if;
  return new;
end; $$;

-- 5) Deletion guard: an admin/founder row can only be deleted by a founder, and a founder
--    account can't be deleted through the app at all (remove via SQL to avoid a top-tier lockout).
--    auth.uid() is null (dashboard / SQL / service role) bypasses — that's the intended escape hatch.
create or replace function public.guard_staff_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return old; end if;             -- SQL editor / dashboard / service role bypass
  if (old.role = 'admin' or coalesce(old.is_founder, false)) then
    if not public.is_founder() then
      raise exception 'Only a founder can delete an admin account.';
    end if;
    if coalesce(old.is_founder, false) then
      raise exception 'A founder account cannot be deleted from the app — remove it via SQL.';
    end if;
  end if;
  return old;
end; $$;

drop trigger if exists trg_guard_staff_delete on public.profiles;
create trigger trg_guard_staff_delete
  before delete on public.profiles
  for each row execute function public.guard_staff_delete();

-- ------------------------------------------------------------------------------------------------
-- CREATE YOUR FOUNDER: the account must already exist (sign up / be an admin), then run once:
--   update public.profiles set role = 'admin', is_founder = true where lower(email) = lower('you@example.com');
-- (auth.uid() is null in the SQL editor, so the protect trigger lets this through.)
-- ------------------------------------------------------------------------------------------------
