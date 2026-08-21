-- 071_feature_flags.sql — Per-feature on/off switches so new work ships dark and a founder flips it
-- on when ready. An extensible key/value companion to app_settings (055). Run after 070. Idempotent.
--
-- Any authenticated user may READ the flags (the client gates UI from them). Only a founder writes,
-- through set_feature_flag(). is_feature_enabled(key) is a SECURITY DEFINER helper usable inside RLS
-- and other functions. Unknown keys read as false (disabled).

create table if not exists public.feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  label       text,                       -- human description for the admin toggle list
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

alter table public.feature_flags enable row level security;

drop policy if exists "feature_flags_read" on public.feature_flags;
create policy "feature_flags_read" on public.feature_flags
  for select to authenticated using (true);
-- No client writes — founders change flags only through set_feature_flag().

-- Seed the roadmap feature keys (all OFF). Safe to re-run: existing rows keep their current state.
insert into public.feature_flags (key, label) values
  ('interventions',          'Intervention case management (Phase 1)'),
  ('competency_matrix',      'Competency matrix & skill passport (Phase 2)'),
  ('resource_library',       'Resource & knowledge library (Phase 3)'),
  ('weekly_digest',          'Weekly cohort digest & action center (Phase 3)'),
  ('office_hours',           'Mentor office hours & booking (Phase 4)'),
  ('passkeys',               'WebAuthn passkey authentication (Phase 5)'),
  ('submission_similarity',  'Content-based submission similarity (Phase 6)'),
  ('alumni_board',           'Alumni opportunities board (Phase 7)'),
  ('case_studies',           'Public case studies & publishing (Phase 7)'),
  ('client_portal',          'Website lead & client portal (Phase 8)')
on conflict (key) do nothing;

-- Read a flag (unknown → false). SECURITY DEFINER so it also works inside RLS / other definer fns.
create or replace function public.is_feature_enabled(p_key text)
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce((select enabled from public.feature_flags where key = p_key), false);
$$;
grant execute on function public.is_feature_enabled(text) to authenticated;

-- Founder-only: flip a flag (audit-logged). Creates the key if it doesn't exist yet.
create or replace function public.set_feature_flag(p_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Only a founder can change feature flags.';
  end if;
  insert into public.feature_flags (key, enabled, updated_at, updated_by)
  values (p_key, coalesce(p_enabled, false), now(), auth.uid())
  on conflict (key) do update
    set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
  perform public.log_admin_action('set_feature_flag', null, p_key || '=' || coalesce(p_enabled, false)::text);
end; $$;
grant execute on function public.set_feature_flag(text, boolean) to authenticated;
