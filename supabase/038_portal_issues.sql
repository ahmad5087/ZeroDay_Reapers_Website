-- 038_portal_issues.sql — let any user report a portal issue; admins triage them. Run after 037. Idempotent.
--
-- A permanent "Report a Portal Issue" box lives in every user's Profile. Rows are private: a user
-- sees only their own, admins see all. Author name/email are snapshotted on insert so a report
-- survives even if the reporter's account is later deleted (same pattern as feedback in 035).

create table if not exists public.portal_issues (
  id           bigint generated always as identity primary key,
  user_id      uuid references public.profiles(id) on delete set null,
  author_name  text,
  author_email text,
  category     text not null default 'other' check (category in ('bug','ui','access','account','other')),
  body         text not null check (char_length(body) between 1 and 2000),
  status       text not null default 'open' check (status in ('open','resolved')),
  resolved_by  uuid references public.profiles(id),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists portal_issues_status_time on public.portal_issues (status, created_at desc);

alter table public.portal_issues enable row level security;

-- A user files issues under their own id.
drop policy if exists "portal_issues_insert_own" on public.portal_issues;
create policy "portal_issues_insert_own" on public.portal_issues
  for insert to authenticated with check (user_id = auth.uid());

-- Read: your own rows, or admin (all).
drop policy if exists "portal_issues_read" on public.portal_issues;
create policy "portal_issues_read" on public.portal_issues
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Snapshot the reporter's name + email on insert (kept if the account is later deleted).
create or replace function public.portal_issue_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.author_name is null or new.author_email is null then
    select display_name, email into new.author_name, new.author_email
    from public.profiles where id = new.user_id;
  end if;
  return new;
end; $$;
drop trigger if exists trg_portal_issue_snapshot on public.portal_issues;
create trigger trg_portal_issue_snapshot before insert on public.portal_issues
  for each row execute function public.portal_issue_snapshot();

-- Admin: mark an issue resolved / reopen it (audit-logged).
create or replace function public.admin_set_issue_status(p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('open','resolved') then raise exception 'bad status'; end if;
  update public.portal_issues
     set status      = p_status,
         resolved_by = case when p_status = 'resolved' then auth.uid() else null end,
         resolved_at = case when p_status = 'resolved' then now()      else null end
   where id = p_id;
  perform public.log_admin_action('set_issue_status', null, p_status);
end; $$;
grant execute on function public.admin_set_issue_status(bigint, text) to authenticated;
