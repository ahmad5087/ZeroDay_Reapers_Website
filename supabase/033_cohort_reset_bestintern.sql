-- 033_cohort_reset_bestintern.sql — Cohort ID format, founder reset RPCs, Best Intern + certificates.
-- Run after 032. Idempotent.

-- ============ 1) NEW ID FORMAT: ZDR-<year>-Cohort1-<DEPT>-NNN ============
-- Re-defines handle_new_user (keeps all 029 fields) with the Cohort segment, and makes
-- display_name fall back to FULL NAME (then email) since display name is now optional.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := new.raw_user_meta_data;
  user_status text;
  v_domain_id int := nullif(meta->>'domain_id','')::int;
  v_dept_key  text;
  v_dept_code text;
  v_year      int := extract(year from now())::int;
  v_seq       int;
  v_member_id text;
begin
  if exists (select 1 from public.kicked_emails where lower(email) = lower(new.email)) then
    user_status := 'pending';
  else
    user_status := 'approved';
  end if;

  if v_domain_id is not null then
    select key into v_dept_key from public.domains where id = v_domain_id;
    v_dept_code := public.dept_code_for(v_dept_key);
    if v_dept_code is not null then
      insert into public.member_id_seq (year, dept_code, last_seq)
        values (v_year, v_dept_code, 1)
        on conflict (year, dept_code) do update set last_seq = public.member_id_seq.last_seq + 1
        returning last_seq into v_seq;
      v_member_id := 'ZDR-' || v_year || '-Cohort1-' || v_dept_code || '-' || lpad(v_seq::text, 3, '0');
    end if;
  end if;

  insert into public.profiles (
    id, email, display_name, full_name, domain_id, gender, avatar_url, status, ram,
    discord_id, discord_username, classroom_confirmed,
    country, dial_code, phone, member_id
  )
  values (
    new.id,
    new.email,
    coalesce(nullif(meta->>'display_name',''), nullif(meta->>'full_name',''), split_part(new.email,'@',1)),
    nullif(meta->>'full_name',''),
    v_domain_id,
    nullif(meta->>'gender',''),
    case lower(nullif(meta->>'gender',''))
      when 'male'   then '/avatars/male.webp'
      when 'female' then '/avatars/female.webp'
      else null
    end,
    user_status,
    nullif(meta->>'ram',''),
    nullif(meta->>'discord_id',''),
    nullif(meta->>'discord_username',''),
    coalesce((nullif(meta->>'classroom_confirmed',''))::boolean, false),
    upper(nullif(meta->>'country','')),
    nullif(meta->>'dial_code',''),
    nullif(meta->>'phone',''),
    v_member_id
  );
  return new;
end; $$;

-- ============ 2) FOUNDER: reset the ID counters (next signup = -001 everywhere) ============
create or replace function public.reset_member_id_counters()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'Only a founder can reset ID counters.'; end if;
  delete from public.member_id_seq;                     -- next insert re-creates each dept at 1
  perform public.log_admin_action('reset_id_counters', null, 'zeroed all department counters');
end; $$;
grant execute on function public.reset_member_id_counters() to authenticated;

-- ============ 3) FOUNDER: full portal reset (fresh cohort) ============
-- Keeps: Founder/Admin/Alumni accounts, the Alumni-room chat, Testimonials & Feedback (alumni-owned).
-- Wipes: all other messages, announcements, all DMs, tasks/submissions/extensions, live sessions,
--        kicked_emails, and every current (non-alumni) intern account. Zeroes the ID counters.
create or replace function public.reset_portal()
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_alumni_id int;
begin
  if not public.is_founder() then raise exception 'Only a founder can reset the portal.'; end if;
  select id into v_alumni_id from public.domains where key = 'alumni';

  -- Chat + announcements (keep the alumni room). Reactions/reports/mentions cascade.
  delete from public.messages where domain_id is distinct from v_alumni_id;
  delete from public.announcements;
  delete from public.dm_messages;

  -- Tasks + everything derived from them.
  delete from public.submissions;
  delete from public.task_extension_requests;
  delete from public.task_deadline_reminders;
  delete from public.tasks;

  -- Calendar / live sessions.
  delete from public.live_sessions;

  -- Re-registration + ID counters → clean slate.
  delete from public.kicked_emails;
  delete from public.member_id_seq;

  -- Remove current interns (non-alumni students). Alumni/Admin/Founder are preserved.
  -- Deleting auth.users cascades to profiles (and their documents/devices/etc).
  delete from auth.users where id in (
    select id from public.profiles where role = 'student' and coalesce(is_alumni, false) = false
  );

  perform public.log_admin_action('reset_portal', null, 'full portal reset (kept founder/admin/alumni + alumni chat + feedback)');
end; $$;
grant execute on function public.reset_portal() to authenticated;

-- ============ 4) BEST INTERN (max 3 per department) ============
alter table public.profiles add column if not exists is_best_intern boolean not null default false;

create or replace function public.admin_set_best_intern(target uuid, val boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_dom int; v_cnt int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;   -- admins + founders
  if val then
    select domain_id into v_dom from public.profiles where id = target;
    select count(*) into v_cnt from public.profiles
      where is_best_intern = true and domain_id is not distinct from v_dom and id <> target;
    if v_cnt >= 3 then
      raise exception 'This department already has 3 Best Interns. Unmark one first.';
    end if;
  end if;
  update public.profiles set is_best_intern = val where id = target;
  perform public.log_admin_action(case when val then 'mark_best_intern' else 'unmark_best_intern' end, target, null);
end; $$;
grant execute on function public.admin_set_best_intern(uuid, boolean) to authenticated;

-- ============ 5) CERTIFICATES (admin uploads, alumni downloads) ============
-- R2 keys stored on the profile; files live under certificates/{uid}/ (R2 route allows admin write there).
alter table public.profiles add column if not exists certificate_key text;  -- internship / best-intern certificate
alter table public.profiles add column if not exists lor_key text;          -- letter of recommendation (best interns)

create or replace function public.admin_set_certificate(target uuid, p_certificate_key text, p_lor_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.profiles set
    certificate_key = case when p_certificate_key is null then certificate_key else nullif(p_certificate_key,'') end,
    lor_key         = case when p_lor_key is null then lor_key else nullif(p_lor_key,'') end
  where id = target;
  perform public.log_admin_action('set_certificate', target, null);
end; $$;
grant execute on function public.admin_set_certificate(uuid, text, text) to authenticated;

-- Expose the badge + cert presence via the public view is NOT needed; the alumni reads their own
-- base profile row (RLS lets owners read their full row), so certificate_key/lor_key/is_best_intern
-- are available to the owner directly.
