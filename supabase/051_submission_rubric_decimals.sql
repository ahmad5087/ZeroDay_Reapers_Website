-- 051_submission_rubric_decimals.sql — allow fractional rubric marks (e.g. 9.5/10). After 050. Idempotent.
-- Retypes the four rubric axes from int → numeric(4,2); overall (/40) stays the auto-summed total.

-- The generated overall depends on the four axes, so it must be dropped before retyping them.
alter table public.submissions drop column if exists score_overall;

alter table public.submissions alter column score_completeness type numeric(4,2);
alter table public.submissions alter column score_accuracy     type numeric(4,2);
alter table public.submissions alter column score_evidence      type numeric(4,2);
alter table public.submissions alter column score_report        type numeric(4,2);

-- Re-add overall (/40) as the numeric sum; NULL until at least one axis is scored.
alter table public.submissions add column score_overall numeric(5,2)
  generated always as (
    case
      when score_completeness is null and score_accuracy is null
       and score_evidence is null and score_report is null then null
      else coalesce(score_completeness, 0) + coalesce(score_accuracy, 0)
         + coalesce(score_evidence, 0) + coalesce(score_report, 0)
    end
  ) stored;

-- The 0..10 range check from 047 still holds for numeric values (9.5 is between 0 and 10).
