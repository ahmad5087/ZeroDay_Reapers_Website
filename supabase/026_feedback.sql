-- 026_feedback.sql — student feedback/ratings with admin approval + public testimonials.
-- Run after 025. Idempotent.

create table if not exists public.feedback (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  rating_program int  not null check (rating_program between 1 and 5),
  rating_portal  int  not null check (rating_portal between 1 and 5),
  body           text not null check (char_length(body) between 1 and 2000),
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  approved_by    uuid references public.profiles(id),
  approved_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists feedback_status_time on public.feedback (status, created_at desc);

alter table public.feedback enable row level security;

-- students submit their own feedback
drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own" on public.feedback
  for insert to authenticated with check (user_id = auth.uid());

-- read: your own rows, any approved row, or admin (all)
drop policy if exists "feedback_read" on public.feedback;
create policy "feedback_read" on public.feedback
  for select to authenticated using (
    user_id = auth.uid() or status = 'approved' or public.is_admin()
  );

-- approved rows are readable by anon too (public marketing site)
drop policy if exists "feedback_read_anon_approved" on public.feedback;
create policy "feedback_read_anon_approved" on public.feedback
  for select to anon using (status = 'approved');

-- admin approve/reject (audit-logged)
create or replace function public.admin_set_feedback_status(p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('pending','approved','rejected') then raise exception 'bad status'; end if;
  update public.feedback
     set status      = p_status,
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'approved' then now()      else approved_at end
   where id = p_id;
  perform public.log_admin_action('set_feedback_status', null, p_status);
end; $$;
grant execute on function public.admin_set_feedback_status(bigint, text) to authenticated;

-- public testimonials view: approved feedback + author display name/domain, safe columns only.
-- Owned by the migration role, so it reads under owner privileges (like public_profiles).
drop view if exists public.public_testimonials cascade;
create view public.public_testimonials as
  select f.id, p.display_name, d.name as domain,
         f.rating_program, f.rating_portal, f.body, f.created_at
  from public.feedback f
  join public.profiles p on p.id = f.user_id
  left join public.domains d on d.id = p.domain_id
  where f.status = 'approved'
  order by f.created_at desc;
grant select on public.public_testimonials to anon, authenticated;
