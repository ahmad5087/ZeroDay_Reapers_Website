-- 103_lock_anon_execute.sql — Defense-in-depth: stop the `anon` role from invoking privileged
-- SECURITY DEFINER RPCs via /rest/v1/rpc (Supabase lint 0028 "Public Can Execute SECURITY DEFINER
-- Function"). Run after 102. Idempotent — safe to re-run.
--
-- ============================ SAFETY (verified before writing this) ============================
-- Every supabase.rpc() call site in the app was reviewed. This migration is built to be non-breaking:
--
--   1. TRIGGER functions are NEVER touched (prorettype = 'trigger'), so trigger firing — including
--      signup's handle_new_user, message rate-limiting, profile guards — is completely unaffected.
--
--   2. Functions used INSIDE RLS policies stay anon-callable: a grep of every migration shows the only
--      functions referenced in `using (...)` / `with check (...)` are is_admin(), is_founder(), and
--      is_feature_enabled(). If anon lost EXECUTE on those, anon reads on public tables (feature_flags,
--      published posts, etc.) would fail with "permission denied for function". They are in the allowlist.
--
--   3. The genuinely public RPCs — called by logged-out users on public pages, or by the anon-key
--      /api/apply route — stay anon-callable (allowlist).
--
--   4. For every OTHER SECURITY DEFINER function we `revoke ... from public, anon` (removing anonymous
--      access, including the default PUBLIC grant) and `grant ... to authenticated, service_role`. So
--      logged-in users, admins, and server-side (service-role) calls keep working EXACTLY as before —
--      only unauthenticated invocation is removed. Routes that forward a user's JWT run as `authenticated`
--      (not `anon`), so they are unaffected too. And these functions already self-guard with
--      is_admin()/is_founder()/auth.uid() checks, so the removed anon access was harmless to begin with.
--
--   5. Internal, definer-context calls (one function calling is_admin(), log_admin_action(), etc.) run as
--      the function OWNER, which always retains EXECUTE — unaffected by these role grants.
--
-- NOTE: this clears the `anon`-executable warnings. The `authenticated`-executable warnings are BY DESIGN
-- (admin/user RPCs must be callable by logged-in users) and are intentionally left in place.
-- ROLLBACK if ever needed: `grant execute on function public.<name>(<args>) to anon;`

do $$
declare
  r record;
  -- Must stay anon-callable: public RPCs (logged-out pages + anon-key /api/apply) and the RLS helpers.
  allow text[] := array[
    'get_public_stats', 'get_public_passport', 'get_engagement',
    'submit_service_request', 'subscribe', 'attribute_referral',
    'join_waitlist', 'join_waitlist_v2',
    'is_admin', 'is_founder', 'is_feature_enabled'
  ];
  n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace nsp on nsp.oid = p.pronamespace
    where nsp.nspname = 'public'
      and p.prosecdef                          -- SECURITY DEFINER only
      and p.prorettype <> 'trigger'::regtype   -- never touch trigger functions
      and not (p.proname = any(allow))         -- keep public RPCs + RLS helpers anon-callable
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    n := n + 1;
  end loop;
  raise notice 'lock_anon_execute: locked % security-definer function(s) to authenticated/service_role', n;
end $$;
