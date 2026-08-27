-- 100_referral_on_waitlist.sql — Referral code on the Cohort 2 application + readable code scheme (Phase 11).
-- Run after 099. Idempotent. Three parts:
--   (1) waitlist gets referral_code (what the applicant typed) + referred_by (the resolved referrer's
--       profile id); join_waitlist_v2 validates the code SERVER-SIDE and rejects an unknown one.
--   (2) get_or_create_referral_code() now mints a HUMAN-READABLE code — <DEPT><FirstInitial+LastName or
--       FirstName><last3 phone digits> — and GUARANTEES uniqueness by appending a number on the rare
--       collision (the column is already unique). Existing codes are never regenerated.
--   (3) referral_stats() / referral_leaderboard() also count waitlist applications, so a referrer earns a
--       "point" the moment their referral applies (and you can see who was accepted).

-- (1) Referral columns on the application ---------------------------------------------------------------
alter table public.waitlist
  add column if not exists referral_code text,
  add column if not exists referred_by   uuid references public.profiles(id) on delete set null;
create index if not exists waitlist_referred_by_idx on public.waitlist (referred_by);

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
  v_ref_code   text := trim(coalesce(p->>'referral_code', ''));
  v_ref_by     uuid;
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid_email'; end if;
  if v_name = '' then raise exception 'name_required'; end if;
  if v_phone !~ '^\+[0-9][0-9 ()\-]{6,18}$' then raise exception 'invalid_phone'; end if;
  if v_country = '' then raise exception 'country_required'; end if;
  if v_city = '' then raise exception 'city_required'; end if;
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

  -- Referral code is OPTIONAL, but if given it must match an existing intern's code.
  if v_ref_code <> '' then
    select id into v_ref_by from public.profiles where lower(referral_code) = lower(v_ref_code) limit 1;
    if v_ref_by is null then raise exception 'invalid_referral'; end if;
  end if;

  insert into public.waitlist
    (email, name, source, phone, country, city, linkedin_url, domain, ram, current_status, college, study_year,
     gender, experience, motivation, referral_code, referred_by)
  values
    (left(v_email,180), left(v_name,120), 'cohort-2', left(v_phone,40), left(v_country,80), left(v_city,80),
     left(v_linkedin,200), v_domain, v_ram, v_status, left(nullif(v_college,''),160), left(nullif(v_study_year,''),80),
     v_gender, v_experience, left(v_motivation,1200), left(nullif(v_ref_code,''),40), v_ref_by)
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
    motivation     = excluded.motivation,
    referral_code  = excluded.referral_code,
    referred_by    = excluded.referred_by;
end; $$;
grant execute on function public.join_waitlist_v2(jsonb) to anon, authenticated;

-- (2) Human-readable, guaranteed-unique referral codes --------------------------------------------------
create or replace function public.get_or_create_referral_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code   text;
  v_full   text; v_phone text; v_dom text;
  v_dept   text; v_namepart text; v_digits text; v_base text; v_cand text;
  v_tokens text[]; v_i int := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select referral_code into v_code from public.profiles where id = auth.uid();
  if v_code is not null then return v_code; end if;  -- never regenerate an existing code

  select p.full_name, p.phone, d.name
    into v_full, v_phone, v_dom
    from public.profiles p left join public.domains d on d.id = p.domain_id
    where p.id = auth.uid();

  -- Department short code (from the referrer's own department).
  v_dept := case
    when v_dom ilike '%offensive%'  then 'OFF'
    when v_dom ilike '%defensive%'  then 'DEF'
    when v_dom ilike '%cloud%'      then 'CLD'
    when v_dom ilike '%ai%' or v_dom ilike '%artificial%' then 'AIS'
    when v_dom ilike '%grc%' or v_dom ilike '%governance%' or v_dom ilike '%compliance%' then 'GRC'
    when v_dom ilike '%forensic%'   then 'DFR'
    else coalesce(nullif(upper(substr(regexp_replace(coalesce(v_dom,''), '[^A-Za-z]', '', 'g'), 1, 3)), ''), 'ZDR')
  end;

  -- Name part: first-initial + last name, or just the first name when there's only one token.
  v_tokens := regexp_split_to_array(trim(regexp_replace(coalesce(v_full,''), '[^A-Za-z ]', '', 'g')), '\s+');
  if v_tokens is null or array_length(v_tokens,1) is null or coalesce(v_tokens[1],'') = '' then
    v_namepart := 'USER';
  elsif array_length(v_tokens,1) = 1 then
    v_namepart := upper(v_tokens[1]);
  else
    v_namepart := upper(substr(v_tokens[1],1,1) || v_tokens[array_length(v_tokens,1)]);
  end if;

  -- Last 3 phone digits (fallback: random 3 digits when there's no usable phone).
  v_digits := regexp_replace(coalesce(v_phone,''), '[^0-9]', '', 'g');
  if char_length(v_digits) >= 3 then v_digits := right(v_digits, 3);
  else v_digits := lpad((floor(random()*1000))::int::text, 3, '0'); end if;

  v_base := substr(upper(v_dept || v_namepart || v_digits), 1, 24);

  -- Guarantee uniqueness: append an incrementing number on the rare collision.
  v_cand := v_base;
  while exists (select 1 from public.profiles where referral_code = v_cand) loop
    v_i := v_i + 1;
    v_cand := v_base || v_i::text;
    if v_i > 50 then v_cand := lower(substr(replace(gen_random_uuid()::text,'-',''),1,8)); exit; end if;
  end loop;

  begin
    update public.profiles set referral_code = v_cand where id = auth.uid();
  exception when unique_violation then  -- extremely rare race between two identical bases
    v_cand := v_base || upper(substr(replace(gen_random_uuid()::text,'-',''),1,3));
    update public.profiles set referral_code = v_cand where id = auth.uid();
  end;
  return v_cand;
end; $$;
grant execute on function public.get_or_create_referral_code() to authenticated;

-- (3) Count waitlist applications toward the referrer's tally -------------------------------------------
create or replace function public.referral_stats()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_mine int; v_applied int; v_board jsonb;
begin
  if auth.uid() is null then return null; end if;
  select count(*) into v_mine    from public.profiles where referred_by = auth.uid();
  select count(*) into v_applied from public.waitlist where referred_by = auth.uid();
  if public.is_admin() then
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', c) order by c desc), '[]'::jsonb) into v_board
    from (
      select coalesce(p.display_name, p.full_name, 'Intern') as name, count(r.id) as c
      from public.profiles p
      join public.profiles r on r.referred_by = p.id
      group by p.id, p.display_name, p.full_name
      order by c desc
      limit 10
    ) t;
  end if;
  return jsonb_build_object('mine', coalesce(v_mine,0), 'applied', coalesce(v_applied,0), 'leaderboard', v_board);
end; $$;
grant execute on function public.referral_stats() to authenticated;

create or replace function public.referral_leaderboard()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  with referrers as (
    select referred_by as id from public.profiles where referred_by is not null
    union
    select referred_by       from public.waitlist where referred_by is not null
  )
  select coalesce(jsonb_agg(row order by (total + applied) desc, approved desc), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'referrer_id', p.id,
      'name',        coalesce(p.display_name, p.full_name, 'Intern'),
      'member_id',   p.member_id,
      'total',       (select count(*) from public.profiles r where r.referred_by = p.id),
      'approved',    (select count(*) from public.profiles r where r.referred_by = p.id and r.status = 'approved'),
      'applied',     (select count(*) from public.waitlist w where w.referred_by = p.id),
      'accepted',    (select count(*) from public.waitlist w where w.referred_by = p.id and w.decision = 'accepted'),
      'referred',    (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(r.display_name, r.full_name, 'Intern'), 'status', coalesce(r.status,'pending')) order by r.created_at), '[]'::jsonb)
                        from public.profiles r where r.referred_by = p.id)
    ) as row,
    (select count(*) from public.profiles r where r.referred_by = p.id) as total,
    (select count(*) from public.profiles r where r.referred_by = p.id and r.status='approved') as approved,
    (select count(*) from public.waitlist w where w.referred_by = p.id) as applied
    from (select distinct id from referrers) rr
    join public.profiles p on p.id = rr.id
  ) t;
  return v;
end; $$;
grant execute on function public.referral_leaderboard() to authenticated;
