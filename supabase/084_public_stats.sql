-- 084_public_stats.sql — Public proof/trust stats (Phase 11 — growth). Run after 083. Idempotent.
-- One anon-safe RPC returning non-PII cohort/agency aggregates for the marketing site's "proof" section
-- (interns trained, alumni, certificates issued, approved deliverables, projects delivered). No table or
-- flag changes. Adjust the counted sets here if you want to expose a different headline number.
--
-- SECURITY: returns only counts (never rows/PII). SECURITY DEFINER so it reads past RLS for accurate
-- totals; granted to anon so the public landing page can call it without a session.

create or replace function public.get_public_stats()
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'interns_trained',      (select count(*) from public.profiles where role = 'student'),
    'alumni',               (select count(*) from public.profiles where is_alumni = true),
    'certificates_issued',  (select count(*) from public.profiles where certificate_key is not null),
    'deliverables_approved',(select count(*) from public.submissions where status = 'approved'),
    'projects_delivered',   (select count(*) from public.service_requests where status = 'closed')
  );
$$;
grant execute on function public.get_public_stats() to anon, authenticated;
