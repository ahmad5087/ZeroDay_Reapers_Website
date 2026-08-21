-- 077_submission_similarity.sql — Content-based submission similarity (Phase 6). Run after 076. Idempotent.
-- Extracted PDF text + a MinHash fingerprint per submission, plus admin-visible similarity pairs with
-- matched passages + a confidence score. Extraction/compare run in app/api/similarity/extract (service
-- role). Admin-only, HUMAN-IN-THE-LOOP: this flags for review, it never auto-penalizes. Flag: submission_similarity.

create table if not exists public.submission_text (
  submission_id bigint primary key references public.submissions(id) on delete cascade,
  content       text,
  char_len      int,
  minhash       bigint[],
  extracted_at  timestamptz not null default now()
);

create table if not exists public.similarity_pairs (
  id          bigint generated always as identity primary key,
  a_id        bigint not null references public.submissions(id) on delete cascade,
  b_id        bigint not null references public.submissions(id) on delete cascade,
  a_label     text,
  b_label     text,
  score       numeric not null default 0,               -- estimated Jaccard, 0..1
  matched     jsonb   not null default '[]'::jsonb,      -- shared passages, denormalized for the UI
  dismissed   boolean not null default false,
  computed_at timestamptz not null default now(),
  unique (a_id, b_id)
);
create index if not exists similarity_pairs_score on public.similarity_pairs (dismissed, score desc);

alter table public.submission_text  enable row level security;
alter table public.similarity_pairs enable row level security;

-- Admin-only read. Inserts/updates via the service-role extraction route (bypasses RLS).
drop policy if exists "submission_text_admin" on public.submission_text;
create policy "submission_text_admin" on public.submission_text
  for select to authenticated using (public.is_admin());

drop policy if exists "similarity_pairs_admin" on public.similarity_pairs;
create policy "similarity_pairs_admin" on public.similarity_pairs
  for select to authenticated using (public.is_admin());

-- Admin dismisses / restores a flagged pair (audit-logged).
create or replace function public.set_similarity_dismissed(p_id bigint, p_dismissed boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.similarity_pairs set dismissed = coalesce(p_dismissed, true) where id = p_id;
  perform public.log_admin_action(case when coalesce(p_dismissed, true) then 'dismiss_similarity' else 'restore_similarity' end, null, p_id::text);
end; $$;
grant execute on function public.set_similarity_dismissed(bigint, boolean) to authenticated;
