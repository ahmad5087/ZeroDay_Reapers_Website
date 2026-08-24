-- 093_data_export.sql — Self-serve data export / GDPR (Phase 17 — quality). Run after 092. Idempotent.
-- An authenticated user can download everything the portal holds about them (profile + submissions +
-- activity) as one JSON blob, from their dashboard. Read-only, own-rows only (SECURITY DEFINER keyed on
-- auth.uid()). Account deletion stays admin-mediated (it must respect the kicked_emails / retention model).
create or replace function public.export_my_data()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v uuid; res jsonb;
begin
  v := auth.uid();
  if v is null then raise exception 'not authenticated'; end if;
  select jsonb_build_object(
    'exported_at', now(),
    'profile',     (select to_jsonb(p) from public.profiles p where p.id = v),
    'submissions', coalesce((select jsonb_agg(to_jsonb(s)) from public.submissions s where s.user_id = v), '[]'::jsonb),
    'activity',    coalesce((select jsonb_agg(to_jsonb(a)) from public.activity_events a where a.user_id = v), '[]'::jsonb)
  ) into res;
  return res;
end; $$;
grant execute on function public.export_my_data() to authenticated;
