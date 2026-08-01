-- 047_submission_rubric.sql — per-rubric marks on accepted submissions. Run after 046. Idempotent.
-- Admin grades an approved submission on 4 axes (each /10); overall (/40) is the auto-summed total,
-- and the UI derives a percentage from it. Students can VIEW their marks but never set them.

alter table public.submissions add column if not exists score_completeness int;
alter table public.submissions add column if not exists score_accuracy     int;
alter table public.submissions add column if not exists score_evidence      int;
alter table public.submissions add column if not exists score_report        int;

alter table public.submissions drop constraint if exists submissions_scores_chk;
alter table public.submissions add constraint submissions_scores_chk check (
  (score_completeness is null or score_completeness between 0 and 10) and
  (score_accuracy     is null or score_accuracy     between 0 and 10) and
  (score_evidence     is null or score_evidence     between 0 and 10) and
  (score_report       is null or score_report       between 0 and 10)
);

-- Overall (/40) = sum of the four axes; NULL until at least one axis is scored.
-- Stored generated column keeps it always consistent with the parts (can't be set directly).
alter table public.submissions drop column if exists score_overall;
alter table public.submissions add column score_overall int
  generated always as (
    case
      when score_completeness is null and score_accuracy is null
       and score_evidence is null and score_report is null then null
      else coalesce(score_completeness, 0) + coalesce(score_accuracy, 0)
         + coalesce(score_evidence, 0) + coalesce(score_report, 0)
    end
  ) stored;

-- Students can't self-grade: any non-admin write re-queues the submission AND wipes the grade fields,
-- now including the rubric scores. (Extends the original protect_submission from migration 002.)
create or replace function public.protect_submission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.status             := 'submitted';
    new.feedback           := null;
    new.graded_by          := null;
    new.graded_at          := null;
    new.score_completeness := null;
    new.score_accuracy     := null;
    new.score_evidence     := null;
    new.score_report       := null;
  end if;
  return new;
end; $$;
