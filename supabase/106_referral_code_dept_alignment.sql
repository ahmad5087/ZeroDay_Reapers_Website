-- 106_referral_code_dept_alignment.sql — Align referral-code department codes with member IDs. Run after
-- 105. Idempotent. Migration 100 built get_or_create_referral_code() with its own hardcoded dept mapping
-- (OFF/DEF/CLD/DFR) that didn't match the canonical dept_code_for() used for member IDs (OS/DS/CS/AIS/GRC/DF).
-- This redefines it to call dept_code_for() so both share ONE source of truth. Existing codes are never
-- regenerated (the function returns an already-set code), so only newly-minted codes change.
--
-- create-or-replace preserves the ACL set in migration 103 (anon/public revoked, authenticated granted).

create or replace function public.get_or_create_referral_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code     text;
  v_full     text; v_phone text; v_dom_key text;
  v_dept     text; v_namepart text; v_digits text; v_base text; v_cand text;
  v_tokens   text[]; v_i int := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select referral_code into v_code from public.profiles where id = auth.uid();
  if v_code is not null then return v_code; end if;  -- never regenerate an existing code

  select p.full_name, p.phone, d.key
    into v_full, v_phone, v_dom_key
    from public.profiles p left join public.domains d on d.id = p.domain_id
    where p.id = auth.uid();

  -- Same canonical department code as member IDs (OS/DS/CS/AIS/GRC/DF); 'ZDR' if the intern has no domain.
  v_dept := coalesce(public.dept_code_for(v_dom_key), 'ZDR');

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
  exception when unique_violation then
    v_cand := v_base || upper(substr(replace(gen_random_uuid()::text,'-',''),1,3));
    update public.profiles set referral_code = v_cand where id = auth.uid();
  end;
  return v_cand;
end; $$;
