-- 021_security_hardening.sql — OWASP review fixes. Idempotent; safe to re-run.

-- (1) Stop leaking payment_proof_url via the public view.
-- Nothing reads it from the view (chat/DM only need name/avatar/role/alumni; admins
-- read the base profiles table under RLS). Recreate the view without it.
-- Payment proofs also move to private R2 storage (see app changes) — the value stored
-- in profiles.payment_proof_url becomes an R2 key, fetched via a presigned download.
drop view if exists public.public_profiles cascade;
create view public.public_profiles as
  select id, display_name, avatar_url, role, domain_id, status, is_alumni, ram
  from public.profiles;
grant select on public.public_profiles to authenticated;

-- (2) Lock down kicked_emails (PII: emails + reasons of removed users).
-- Only admins may read it via the API. The SECURITY DEFINER functions that write it
-- (handle_new_user, admin_delete_user, audit_unpaid_interns, admin_set_status) run as
-- the table owner and bypass RLS, so signup + removal flows keep working.
alter table public.kicked_emails enable row level security;

drop policy if exists kicked_emails_read on public.kicked_emails;
create policy kicked_emails_read on public.kicked_emails
  for select to authenticated using (public.is_admin());
-- No insert/update/delete policies: direct API writes are denied; only the
-- SECURITY DEFINER functions (which bypass RLS) modify this table.
