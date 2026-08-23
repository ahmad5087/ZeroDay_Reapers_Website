-- 081_feature_flag_sql_editor.sql — Let a founder flip flags from the Supabase SQL editor, and add
-- an in-app founder toggle. Run after 080. Idempotent.
--
-- WHY: set_feature_flag() (071) gated every write on is_founder(), which is
-- `exists(select 1 from profiles where id = auth.uid() and is_founder)`. In the Supabase SQL editor
-- there is NO JWT, so auth.uid() is NULL → is_founder() is false → the RAISE fired with
-- "Only a founder can change feature flags." — even for the actual founder. That made the documented
-- runbook (FEATURE_FLAGS.md, which says to run these from the SQL editor) impossible to follow.
--
-- FIX: enforce the founder check ONLY for real authenticated sessions. When auth.uid() is NULL
-- (SQL editor / service role) allow the write — exactly the "service-role bypass" escape hatch the
-- sibling founder guards in 028 (protect_profile_columns, guard_staff_delete) already use. A logged-in
-- non-founder is still rejected. This keeps the audit-log call (log_admin_action tolerates a NULL
-- actor: actor_id/actor_name just record NULL for an SQL-editor change).

create or replace function public.set_feature_flag(p_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Enforce founder-only for authenticated sessions only. auth.uid() IS NULL in the SQL editor /
  -- service role — the intended escape hatch (matches the guards in 028).
  if auth.uid() is not null and not public.is_founder() then
    raise exception 'Only a founder can change feature flags.';
  end if;
  insert into public.feature_flags (key, enabled, updated_at, updated_by)
  values (p_key, coalesce(p_enabled, false), now(), auth.uid())
  on conflict (key) do update
    set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
  perform public.log_admin_action('set_feature_flag', null, p_key || '=' || coalesce(p_enabled, false)::text);
end; $$;
grant execute on function public.set_feature_flag(text, boolean) to authenticated;

-- No schema change is needed for the in-app founder toggle (app/portal/_components/FeatureFlagsAdmin.jsx):
--   * a founder reads the flags through the existing "feature_flags_read" policy (071), and
--   * writes through set_feature_flag() above (auth.uid() is set + is_founder() true in-app).
