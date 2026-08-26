-- 096_cohort2_application_fields.sql — Extend the waitlist into a full Cohort 2 application (Phase 12).
-- Run after 095. Idempotent. Adds the applicant fields the founder requires and a single validating RPC
-- `join_waitlist_v2(jsonb)` (anon-callable) that enforces every rule SERVER-SIDE — so the LinkedIn URL
-- format, RAM/domain/status/gender/experience enums, and "college required for students" all hold even if
-- the client is bypassed. Admin-only reads stay as defined in 088. The old join_waitlist() is left intact.

alter table public.waitlist
  add column if not exists phone          text,
  add column if not exists country        text,
  add column if not exists city           text,
  add column if not exists linkedin_url   text,
  add column if not exists domain         text,
  add column if not exists ram            int,
  add column if not exists current_status text,
  add column if not exists college        text,
  add column if not exists study_year     text,
  add column if not exists gender         text,
  add column if not exists experience     text,
  add column if not exists motivation     text;

create or replace function public.join_waitlist_v2(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email      text := lower(trim(coalesce(p->>'email', '')));
  v_name       text := trim(coalesce(p->>'name', ''));
  v_phone      text := trim(coalesce(p->>'phone', ''));
  v_country    text := trim(coalesce(p->>'country', ''));
  v_city       text := trim(coalesce(p->>'city', ''));
  v_linkedin   text := trim(coalesce(p->>'linkedin_url', ''));
  v_domain     text := trim(coalesce(p->>'domain', ''));
  v_ram        int  := nullif(p->>'ram', '')::int;
  v_status     text := trim(coalesce(p->>'current_status', ''));
  v_college    text := trim(coalesce(p->>'college', ''));
  v_study_year text := trim(coalesce(p->>'study_year', ''));
  v_gender     text := trim(coalesce(p->>'gender', ''));
  v_experience text := trim(coalesce(p->>'experience', ''));
  v_motivation text := trim(coalesce(p->>'motivation', ''));
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid_email'; end if;
  if v_name = '' then raise exception 'name_required'; end if;
  -- WhatsApp number with country code, e.g. +923001234567
  if v_phone !~ '^\+[0-9][0-9 ()\-]{6,18}$' then raise exception 'invalid_phone'; end if;
  if v_country = '' then raise exception 'country_required'; end if;
  if v_city = '' then raise exception 'city_required'; end if;
  -- LinkedIn profile shape: https://www.linkedin.com/in/<slug> (trailing slash optional)
  if v_linkedin !~ '^https://www\.linkedin\.com/in/[A-Za-z0-9%._-]+/?$' then raise exception 'invalid_linkedin'; end if;
  if v_domain not in ('Offensive Security','Defensive Security','Cloud Security','AI Security','GRC','Digital Forensics')
    then raise exception 'invalid_domain'; end if;
  if v_ram is null or v_ram not in (8,16,24) then raise exception 'invalid_ram'; end if;
  if v_status not in ('Student','Unemployed','Employed') then raise exception 'invalid_status'; end if;
  if v_status = 'Student' and v_college = '' then raise exception 'college_required'; end if;
  if v_status = 'Student' and v_study_year = '' then raise exception 'study_year_required'; end if;
  if v_gender not in ('Male','Female','Trans') then raise exception 'invalid_gender'; end if;
  if v_experience not in ('Beginner','Intermediate','Advanced') then raise exception 'invalid_experience'; end if;
  if char_length(v_motivation) < 10 then raise exception 'motivation_required'; end if;

  insert into public.waitlist
    (email, name, source, phone, country, city, linkedin_url, domain, ram, current_status, college, study_year, gender, experience, motivation)
  values
    (left(v_email,180), left(v_name,120), 'cohort-2', left(v_phone,40), left(v_country,80), left(v_city,80),
     left(v_linkedin,200), v_domain, v_ram, v_status, left(nullif(v_college,''),160), left(nullif(v_study_year,''),80),
     v_gender, v_experience, left(v_motivation,1200))
  on conflict (email) do update set
    name           = excluded.name,
    source         = excluded.source,
    phone          = excluded.phone,
    country        = excluded.country,
    city           = excluded.city,
    linkedin_url   = excluded.linkedin_url,
    domain         = excluded.domain,
    ram            = excluded.ram,
    current_status = excluded.current_status,
    college        = excluded.college,
    study_year     = excluded.study_year,
    gender         = excluded.gender,
    experience     = excluded.experience,
    motivation     = excluded.motivation;
end; $$;

grant execute on function public.join_waitlist_v2(jsonb) to anon, authenticated;
