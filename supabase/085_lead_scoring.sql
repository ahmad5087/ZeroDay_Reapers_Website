-- 085_lead_scoring.sql — Client-lead scoring (Phase 11 — growth). Run after 084. Idempotent.
-- Adds a 0-100 `score` to service_requests and computes it inside the existing anon intake RPC
-- (extends 080's submit_service_request, same signature) from the scope questionnaire — budget /
-- timeline / engagement type / org / detail. Lets ClientRequestsAdmin chase the hot leads first.
-- No new flag; scoring is on as soon as this is applied. Tune the weights below to taste.

alter table public.service_requests add column if not exists score int;

create or replace function public.submit_service_request(p_name text, p_email text, p_org text, p_title text, p_scope jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text; v_score int; b text; t text; ty text; d text;
begin
  if char_length(coalesce(p_title, '')) < 1 or char_length(coalesce(p_email, '')) < 3 then
    raise exception 'title and email are required';
  end if;

  b  := coalesce(p_scope->>'budget', '');
  t  := coalesce(p_scope->>'timeline', '');
  ty := lower(coalesce(p_scope->>'type', ''));
  d  := coalesce(p_scope->>'description', '');

  v_score := least(100,
      case when b like '%15k+%'    then 40
           when b like '%5k%15k%'  then 30
           when b like '%1k%5k%'   then 20
           when b like '%< $1k%'   then 8
           else 5 end
    + case when t = 'ASAP'   then 25
           when t like '2%4%' then 20
           when t like '1%3%' then 12
           else 6 end
    + case when ty like '%red team%' or ty like '%penetration%' or ty like '%audit%' then 15
           when ty like '%consult%'  or ty like '%training%' then 8
           else 3 end
    + case when char_length(coalesce(p_org, '')) > 1 then 10 else 0 end
    + case when char_length(d) > 80 then 10 else 0 end
  );

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.service_requests (access_token, name, email, org, title, scope, score)
  values (v_token, left(p_name, 120), left(p_email, 180), left(p_org, 180), left(p_title, 200), coalesce(p_scope, '{}'::jsonb), v_score);
  return v_token;
end; $$;
grant execute on function public.submit_service_request(text, text, text, text, jsonb) to anon, authenticated;
