-- 035_reset_safety.sql — make Testimonials survive a full reset + harden reset_portal.
-- Run after 034. Idempotent.
--
-- WHY: feedback.user_id was ON DELETE CASCADE and ANY authenticated user (not only alumni) can
-- submit feedback. reset_portal() deletes current interns, which would cascade-delete their
-- approved testimonials — contradicting "keep Testimonials & Feedback". Fix: snapshot the author's
-- name/domain onto each feedback row, switch the FK to ON DELETE SET NULL, and read the snapshot in
-- the public_testimonials view so an approved testimonial survives even after its author is deleted.

-- 1) Snapshot columns + backfill from current authors.
alter table public.feedback add column if not exists author_name   text;
alter table public.feedback add column if not exists author_domain text;

update public.feedback f
   set author_name   = p.display_name,
       author_domain = d.name
  from public.profiles p
  left join public.domains d on d.id = p.domain_id
 where p.id = f.user_id and f.author_name is null;

-- 2) Capture the author snapshot automatically on every new feedback row.
create or replace function public.feedback_snapshot_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.author_name is null then
    select p.display_name, d.name into new.author_name, new.author_domain
    from public.profiles p left join public.domains d on d.id = p.domain_id
    where p.id = new.user_id;
  end if;
  return new;
end; $$;
drop trigger if exists trg_feedback_snapshot on public.feedback;
create trigger trg_feedback_snapshot before insert on public.feedback
  for each row execute function public.feedback_snapshot_author();

-- 3) Deleting the author must KEEP the testimonial → user_id nullable + ON DELETE SET NULL.
alter table public.feedback alter column user_id drop not null;
alter table public.feedback drop constraint if exists feedback_user_id_fkey;
alter table public.feedback add constraint feedback_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

-- 4) View reads the snapshot when the author profile is gone (LEFT JOIN + coalesce).
drop view if exists public.public_testimonials cascade;
create view public.public_testimonials as
  select f.id,
         coalesce(p.display_name, f.author_name)   as display_name,
         coalesce(d.name,         f.author_domain) as domain,
         f.rating_program, f.rating_portal, f.body, f.created_at
  from public.feedback f
  left join public.profiles p on p.id = f.user_id
  left join public.domains  d on d.id = p.domain_id
  where f.status = 'approved'
  order by f.created_at desc;
grant select on public.public_testimonials to anon, authenticated;

-- 5) Harden reset_portal: ABORT if the Alumni domain is missing (otherwise the
--    "keep alumni room" filter would delete EVERY message). Otherwise unchanged.
create or replace function public.reset_portal()
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_alumni_id int;
begin
  if not public.is_founder() then raise exception 'Only a founder can reset the portal.'; end if;
  select id into v_alumni_id from public.domains where key = 'alumni';
  if v_alumni_id is null then
    raise exception 'Alumni domain not found — aborting reset to avoid deleting all messages.';
  end if;

  delete from public.messages where domain_id is distinct from v_alumni_id;  -- keep the alumni room
  delete from public.announcements;
  delete from public.dm_messages;

  delete from public.submissions;              -- submission_files cascade
  delete from public.task_extension_requests;
  delete from public.task_deadline_reminders;
  delete from public.tasks;

  delete from public.live_sessions;
  delete from public.kicked_emails;
  delete from public.member_id_seq;

  -- Remove current interns (non-alumni students). Founder/Admin/Alumni preserved. Approved
  -- testimonials survive because feedback.user_id is now ON DELETE SET NULL (steps 1–4).
  delete from auth.users where id in (
    select id from public.profiles where role = 'student' and coalesce(is_alumni, false) = false
  );

  perform public.log_admin_action('reset_portal', null, 'full portal reset (kept founder/admin/alumni + alumni chat + feedback)');
end; $$;
