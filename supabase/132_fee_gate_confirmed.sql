-- 132_fee_gate_confirmed.sql — Require the internship fee to be ADMIN-CONFIRMED (not merely uploaded)
-- before Week 2+ submissions. Run after 117 (and any time after 127). Idempotent; safe to re-run.
--
-- Change vs 117: the Week-2 hard gate used to open the moment a student uploaded a proof file
-- (profiles.payment_proof_url is not null). Founder policy is now stricter — a student must have their
-- payment CONFIRMED by an admin (profiles.payment_confirmed = true, set via admin_set_payment_confirmed)
-- before they can submit from Week 2 onward. This stops a student unlocking Week 2 on an unreviewed or
-- invalid proof. Week 1 stays free and admins are never gated. Re-enrollment (127) already resets
-- payment_confirmed to false, so the gate re-arms for the new cohort.
--
-- Self-contained: redefines the function AND re-asserts the trigger, so running this establishes the
-- confirmed-gate even if 117's trigger was never applied on this database. INSERT-only, so it gates the
-- FIRST submission of a Week-2+ task and never interferes with admin grading (an UPDATE).

create or replace function public.enforce_fee_before_week2()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_week      int;
  v_role      text;
  v_confirmed boolean;
begin
  select week into v_week from public.tasks where id = new.task_id;
  if coalesce(v_week, 1) < 2 then
    return new;  -- Week 1 (or unknown) is free
  end if;
  select role, coalesce(payment_confirmed, false)
    into v_role, v_confirmed
    from public.profiles where id = new.user_id;
  if v_role = 'admin' then
    return new;  -- admins are never gated
  end if;
  if not v_confirmed then
    raise exception 'FEE_REQUIRED: your internship fee must be confirmed by an admin before the Week 2 task.';
  end if;
  return new;
end; $$;

drop trigger if exists trg_fee_before_week2 on public.submissions;
create trigger trg_fee_before_week2
  before insert on public.submissions
  for each row execute function public.enforce_fee_before_week2();
