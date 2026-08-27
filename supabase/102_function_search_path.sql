-- 102_function_search_path.sql — Pin search_path on the functions the Supabase linter flagged as
-- `function_search_path_mutable` (lint 0011). Run after 101. Idempotent. A mutable search_path lets a
-- caller shadow built-in objects, so SECURITY DEFINER / trigger functions should always pin it. We resolve
-- each function's full signature via regprocedure so overloads and any arg types are handled automatically;
-- a name that doesn't exist is simply skipped (no error).

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'rate_limit_messages',
        'automod_check_message',
        'check_link_approval',
        'dept_code_for',
        'touch_live_session_attendance',
        'touch_application',
        'touch_service_request'
      )
  loop
    execute format('alter function %s set search_path = public', r.sig);
  end loop;
end $$;
