-- 086_referrals.sql — Referral & ambassador loops (Phase 11 — growth). Run after 085. Idempotent.
-- Per-user referral code + who-referred-whom attribution, plus RPCs to mint a code, attribute a signup,
-- and read stats (own count; founder sees a top-10 leaderboard). Reward fulfilment is intentionally
-- OUT of scope here — the founder decides the model (see docs/phases/PHASE-11-WEBSITE.md); this ships the
-- tracking + leaderboard. Flag: `referrals` (gates the visible share UI; attribution is inert until codes
-- exist, which only happens once the flag-gated share card hands them out).

alter table public.profiles add column if not exists referral_code text unique;
alter table public.profiles add column if not exists referred_by  uuid references public.profiles(id) on delete set null;

insert into public.feature_flags (key, label) values
  ('referrals', 'Referral & ambassador loops (Phase 11)')
on conflict (key) do nothing;

-- Caller mints (once) / returns their own short referral code.
create or replace function public.get_or_create_referral_code()
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select referral_code into v_code from public.profiles where id = auth.uid();
  if v_code is null then
    v_code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    update public.profiles set referral_code = v_code where id = auth.uid();
  end if;
  return v_code;
end; $$;
grant execute on function public.get_or_create_referral_code() to authenticated;

-- Set the CALLER's referrer from a code — once, never self, never overwrite an existing attribution.
create or replace function public.attribute_referral(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ref uuid;
begin
  if auth.uid() is null or coalesce(p_code, '') = '' then return; end if;
  select id into v_ref from public.profiles where referral_code = lower(p_code);
  if v_ref is null or v_ref = auth.uid() then return; end if;
  update public.profiles set referred_by = v_ref where id = auth.uid() and referred_by is null;
end; $$;
grant execute on function public.attribute_referral(text) to authenticated;

-- Caller's own referral count; founders additionally get the top-10 referrers leaderboard.
create or replace function public.referral_stats()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_mine int; v_board jsonb;
begin
  if auth.uid() is null then return null; end if;
  select count(*) into v_mine from public.profiles where referred_by = auth.uid();
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
  return jsonb_build_object('mine', coalesce(v_mine, 0), 'leaderboard', v_board);
end; $$;
grant execute on function public.referral_stats() to authenticated;
