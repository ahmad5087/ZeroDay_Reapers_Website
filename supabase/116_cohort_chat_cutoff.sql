-- 116_cohort_chat_cutoff.sql — Scope chat history to the reader's cohort. Run after 115. Idempotent.
--
-- Message visibility was scoped only by department (+ the global lobby), and milestones were global —
-- neither had any cohort dimension. So a fresh Cohort-2 intern could read Cohort-1's entire department
-- chat, the lobby, and every past milestone. This hides messages/milestones created BEFORE the reader's
-- cohort start date (app_settings.cohort_starts, migration 115).
--
-- Rules: admins are exempt (still see everything, as before). If the reader's cohort has no start date
-- set, nothing is hidden (safe default) — so Cohort-1 members and anyone pre-rollout are unaffected until
-- the founder sets their cohort's start date. Only the READ policies change; insert/update are untouched.

-- Reader's cohort start, parsed from their member_id -> cohort number -> cohort_starts map. NULL when the
-- member_id has no cohort, or that cohort has no date set. security definer so an RLS policy can read
-- app_settings + the caller's own profile row regardless of the caller's own grants.
create or replace function public.my_cohort_start()
returns timestamptz language sql stable security definer set search_path = public as $$
  select (s.cohort_starts ->> (regexp_match(p.member_id, 'Cohort\s*([0-9]+)', 'i'))[1])::timestamptz
    from public.profiles p, public.app_settings s
   where p.id = auth.uid()
     and s.id = true
     and p.member_id ~* 'Cohort\s*[0-9]+';
$$;
grant execute on function public.my_cohort_start() to authenticated;

-- Small helper: is the caller an admin? (keeps the policies readable)
-- (public.is_founder() already exists; role check mirrors the original messages policy.)

-- messages: read your domain OR the lobby (admin reads all) — now also gated to your cohort's window.
drop policy if exists "messages_read_own_domain" on public.messages;
create policy "messages_read_own_domain" on public.messages
  for select to authenticated using (
    (
      domain_id = (select domain_id from public.profiles where id = auth.uid())
      or domain_id = (select id from public.domains where key = 'lobby')
      or (select role from public.profiles where id = auth.uid()) = 'admin'
    )
    and (
      (select role from public.profiles where id = auth.uid()) = 'admin'
      or public.my_cohort_start() is null
      or created_at >= public.my_cohort_start()
    )
  );

-- milestones: global read feed — gate purely by the same cohort window (admins exempt).
drop policy if exists milestones_read on public.milestones;
create policy milestones_read on public.milestones
  for select to authenticated using (
    (select role from public.profiles where id = auth.uid()) = 'admin'
    or public.my_cohort_start() is null
    or created_at >= public.my_cohort_start()
  );
