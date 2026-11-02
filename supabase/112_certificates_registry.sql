-- 112_certificates_registry.sql — Move the public credential registry from the static
-- data/certificates.json into the database, so /verify resolves live and the portal can
-- publish new certificates at runtime (Vercel's filesystem is read-only, so a static file
-- can't be written from the app). Run after 111. Idempotent.
--
-- Read path mirrors the Skill Passport: a logged-out /verify page calls the anon-callable
-- SECURITY DEFINER RPC verify_certificate() (added to 103's allowlist). The table itself has
-- RLS on with NO anon/authenticated policy, so the whole registry can't be enumerated over
-- REST — a verifier must know the exact certificate ID (as printed / in the QR deep link).
-- Lookup is case-insensitive because canonical IDs contain mixed case ("Cohort1").

-- ---- (1) registry table ----
create table if not exists public.certificates (
  id         text primary key,                       -- canonical ID = the intern's member_id
  name       text not null,                           -- full legal name shown as "Awarded To"
  type       text not null,                           -- 'Completion Certificate' | 'Best Intern'
  department text,
  cohort     int,
  issued     date,                                    -- publish date
  period     text,                                    -- program period, e.g. "01 August 2026 – 30 September 2026"
  created_at timestamptz not null default now()
);

alter table public.certificates enable row level security;
-- No SELECT policy on purpose: reads go only through verify_certificate() below (no bulk harvest).

-- ---- (2) public, by-exact-id lookup (no enumeration) ----
create or replace function public.verify_certificate(p_id text)
returns public.certificates
language sql
stable
security definer
set search_path = public
as $$
  select * from public.certificates
   where lower(id) = lower(btrim(p_id))
   limit 1;
$$;

revoke execute on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated, service_role;

-- ---- (3) seed the 25 Cohort-1 graduates (idempotent) ----
insert into public.certificates (id, name, type, department, cohort, issued, period) values
  ('ZDR-2026-Cohort1-AIS-001', 'Muhammad Bilal Zeeshan',                'Best Intern',            'AI Security',                   1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-AIS-002', 'Taha Amanat',                           'Completion Certificate', 'AI Security',                   1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-CS-001',  'Busari Mutairu Afolabi',                'Best Intern',            'Cloud Security',                1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-CS-002',  'Shahzeen Shahbaz',                      'Best Intern',            'Cloud Security',                1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-CS-003',  'Irha Batool',                           'Best Intern',            'Cloud Security',                1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-CS-004',  'Muneeb Ahmed',                          'Completion Certificate', 'Cloud Security',                1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DF-001',  'Muhammad Faisal Kamran',                'Completion Certificate', 'Digital Forensics',             1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DF-002',  'Tasneem Monir',                         'Best Intern',            'Digital Forensics',             1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DS-001',  'Ahmed Ayman Abdelhalim Moustafa Ahmed', 'Best Intern',            'Defensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DS-002',  'Uzma Bibi',                             'Completion Certificate', 'Defensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DS-003',  'Sawera Zeb',                            'Best Intern',            'Defensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DS-004',  'Tehzeeb Kousar',                        'Best Intern',            'Defensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DS-005',  'Yell Mahn Oo',                          'Completion Certificate', 'Defensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DS-006',  'Sara Irshad',                           'Completion Certificate', 'Defensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-DS-007',  'MBODO MBOULANA Lucie-Astride-Lucresse', 'Completion Certificate', 'Defensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-GRC-001', 'Halima Khan',                           'Best Intern',            'Governance, Risk & Compliance', 1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-GRC-002', 'Zamarak Bashari',                       'Completion Certificate', 'Governance, Risk & Compliance', 1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-GRC-003', 'Moiz Ahmed',                            'Best Intern',            'Governance, Risk & Compliance', 1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-GRC-004', 'Abdullah Zubair',                       'Best Intern',            'Governance, Risk & Compliance', 1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-GRC-005', 'Owais Ahmed',                           'Completion Certificate', 'Governance, Risk & Compliance', 1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-OS-001',  'Muhib Saleem',                          'Completion Certificate', 'Offensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-OS-002',  'Mir Nasir Hassan',                      'Best Intern',            'Offensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-OS-003',  'Muhammad Mubshar Sultan',               'Completion Certificate', 'Offensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-OS-004',  'Rabiya Masood',                         'Best Intern',            'Offensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026'),
  ('ZDR-2026-Cohort1-OS-005',  'Ali Hassan Pervaiz',                    'Best Intern',            'Offensive Security',            1, date '2026-11-02', '01 August 2026 – 30 September 2026')
on conflict (id) do update
  set name = excluded.name,
      type = excluded.type,
      department = excluded.department,
      cohort = excluded.cohort,
      issued = excluded.issued,
      period = excluded.period;

-- ---- (4) correct two source profile names (capitalisation fixes) so full_name is consistent
--          everywhere it's used (offer letter, portfolio, future one-click auto-fill). Idempotent;
--          matches 0 rows in CI/test DBs. Runs as the SQL editor (auth.uid() null) so the
--          protect_profile_columns trigger allows it. ----
update public.profiles set full_name = 'Muhammad Mubshar Sultan'
 where member_id = 'ZDR-2026-Cohort1-OS-003' and full_name is distinct from 'Muhammad Mubshar Sultan';
update public.profiles set full_name = 'Uzma Bibi'
 where member_id = 'ZDR-2026-Cohort1-DS-002' and full_name is distinct from 'Uzma Bibi';
