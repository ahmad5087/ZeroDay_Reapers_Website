-- 098_referral_leaderboard.sql — Admin referral standings (Phase 11 — growth). Run after 097. Idempotent.
-- The referral loop (codes + `?ref=` capture + attribution + `referral_stats`) already ships; this adds the
-- OPERATIONAL view the founder needs to fulfil any of the three reward models — recognition, portal credit
-- per *approved* referral, and the "refer interns → become a community admin" path. Admin-only.
--
-- Returns, per referrer: total referred, how many of those became APPROVED students, and the list of who
-- they referred (name + status). Recognition = order by total; portal credit = the approved count.

create or replace function public.referral_leaderboard()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(row order by total_referred desc, approved_referred desc), '[]'::jsonb) into v
  from (
    select
      jsonb_build_object(
        'referrer_id', p.id,
        'name',        coalesce(p.display_name, p.full_name, 'Intern'),
        'member_id',   p.member_id,
        'total',       count(r.id),
        'approved',    count(r.id) filter (where r.status = 'approved'),
        'referred',    jsonb_agg(
                         jsonb_build_object(
                           'name',   coalesce(r.display_name, r.full_name, 'Intern'),
                           'status', coalesce(r.status, 'pending')
                         ) order by r.created_at
                       )
      ) as row,
      count(r.id) as total_referred,
      count(r.id) filter (where r.status = 'approved') as approved_referred
    from public.profiles p
    join public.profiles r on r.referred_by = p.id
    group by p.id, p.display_name, p.full_name, p.member_id
  ) t;
  return v;
end; $$;

grant execute on function public.referral_leaderboard() to authenticated;
