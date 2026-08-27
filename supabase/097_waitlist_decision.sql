-- 097_waitlist_decision.sql — Admin accept/reject for Cohort 2 applications (Phase 12). Run after 096.
-- Idempotent. Adds a decision workflow to public.waitlist so an admin can Accept or Reject each applicant
-- (which triggers a confirmation email server-side, see app/api/apply/decision). Reads + updates are already
-- admin-only via the `waitlist_admin` policy from 088 — no new policy needed. `decided_by` references the
-- deciding admin's profile for an audit trail.

alter table public.waitlist
  add column if not exists decision    text not null default 'pending',
  add column if not exists decided_at  timestamptz,
  add column if not exists decided_by  uuid references public.profiles(id) on delete set null;

-- Constrain to the three valid states (drop-then-add so re-running stays idempotent).
alter table public.waitlist drop constraint if exists waitlist_decision_chk;
alter table public.waitlist
  add constraint waitlist_decision_chk check (decision in ('pending', 'accepted', 'rejected'));

create index if not exists waitlist_decision_idx on public.waitlist (decision, created_at desc);
