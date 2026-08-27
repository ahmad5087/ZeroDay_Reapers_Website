-- 094_export_feedback_messages.sql — Extend the GDPR self-serve export (093) to also include the user's
-- own feedback, group-chat messages, and direct messages. Run after 093. Idempotent (create or replace).
-- Unchanged security posture: SECURITY DEFINER, own-rows only (keyed on auth.uid()), read-only, stable.
create or replace function public.export_my_data()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v uuid; res jsonb;
begin
  v := auth.uid();
  if v is null then raise exception 'not authenticated'; end if;
  select jsonb_build_object(
    'exported_at',     now(),
    'profile',         (select to_jsonb(p) from public.profiles p where p.id = v),
    'submissions',     coalesce((select jsonb_agg(to_jsonb(s)) from public.submissions s where s.user_id = v), '[]'::jsonb),
    'activity',        coalesce((select jsonb_agg(to_jsonb(a)) from public.activity_events a where a.user_id = v), '[]'::jsonb),
    'feedback',        coalesce((select jsonb_agg(to_jsonb(f)) from public.feedback f where f.user_id = v), '[]'::jsonb),
    'messages',        coalesce((select jsonb_agg(to_jsonb(m)) from public.messages m where m.user_id = v), '[]'::jsonb),
    -- DM threads the user owns (student_id) or sent into (sender_id); this is their own conversation.
    'direct_messages', coalesce((select jsonb_agg(to_jsonb(dm)) from public.dm_messages dm where dm.student_id = v or dm.sender_id = v), '[]'::jsonb)
  ) into res;
  return res;
end; $$;
grant execute on function public.export_my_data() to authenticated;
