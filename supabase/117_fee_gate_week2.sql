-- 117_fee_gate_week2.sql — Require the internship fee proof before Week 2+ submissions. Run after 116.
-- Idempotent.
--
-- Policy: Week 1 is free; from Week 2 onward an intern must have submitted their fee payment proof
-- (profiles.payment_proof_url is not null) before they can submit a task. This is the server-side half of
-- the "hard gate" — the Tasks UI also hides the upload button, but this trigger makes it non-bypassable.
-- Enforced on INSERT only, so it gates the FIRST submission of a Week 2+ task and never interferes with
-- admin grading (which UPDATEs an existing row) or the data-retention nulling of old proofs.

create or replace function public.enforce_fee_before_week2()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_week int;
  v_role text;
  v_paid boolean;
begin
  select week into v_week from public.tasks where id = new.task_id;
  if coalesce(v_week, 1) < 2 then
    return new;  -- Week 1 (or unknown) is free
  end if;
  select role, (payment_proof_url is not null)
    into v_role, v_paid
    from public.profiles where id = new.user_id;
  if v_role = 'admin' then
    return new;  -- admins are never gated
  end if;
  if not coalesce(v_paid, false) then
    raise exception 'FEE_REQUIRED: submit your internship fee proof before the Week 2 task.';
  end if;
  return new;
end; $$;

drop trigger if exists trg_fee_before_week2 on public.submissions;
create trigger trg_fee_before_week2
  before insert on public.submissions
  for each row execute function public.enforce_fee_before_week2();
