-- 067_freely_replace_until_approved.sql — interns may now freely re-upload a submission while it is
-- pending review OR was rejected ("needs changes") — no founder-approved change request required. Only
-- an APPROVED submission stays locked (see 066). This supersedes the change-request gate that 056/066
-- put in protect_submission for non-admin UPDATEs. The submission_change_requests table, its RPC, and
-- the 066 block/cancel triggers are intentionally left in place (dormant / harmless) so any historical
-- rows and the founder review queue keep working. Run after 066. Idempotent.

create or replace function public.protect_submission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    -- Students can't self-grade: any non-admin write re-queues the submission and wipes grade fields.
    new.status             := 'submitted';
    new.feedback           := null;
    new.graded_by          := null;
    new.graded_at          := null;
    new.score_completeness := null;
    new.score_accuracy     := null;
    new.score_evidence     := null;
    new.score_report       := null;

    -- Approved is final: an approved submission can never be replaced by the intern (a founder can still
    -- reopen it from the Admin Panel by moving the status back to pending/rejected). Pending and rejected
    -- submissions are freely re-uploadable — the client-side deadline gate is the only remaining limit.
    if tg_op = 'UPDATE' and old.status = 'approved' then
      raise exception 'SUBMISSION_APPROVED_LOCKED: This week''s submission has been approved and can no longer be replaced.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists protect_submission_trg on public.submissions;
create trigger protect_submission_trg before insert or update on public.submissions
  for each row execute function public.protect_submission();
