-- 030_admin_edit_country_id.sql — let admins/founders edit a member's country + member_id.
-- Run after 029. Idempotent; safe to re-run.
--
-- 029 locked country/dial_code/member_id for everyone. Owner wants admins + founders to be able to
-- change an intern's country and their ZDR member ID (and their own country). Interns still can't
-- change their own country/ID (only their phone). Admins/founders never get a member ID themselves.

-- (1) Column protection: keep interns locked, but DROP the blanket member_id lock so admins/founders
--     can edit it. (Interns are still blocked via the non-admin branch, which reverts country/dial_code/
--     member_id. Non-founder admins still can't touch another admin/founder's protected columns.)
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare caller_role text; caller_founder boolean; target_is_staff boolean;
begin
  if auth.uid() is null then return new; end if;              -- SQL editor / service role bypass
  select role, is_founder into caller_role, caller_founder from public.profiles where id = auth.uid();
  target_is_staff := (old.role = 'admin' or coalesce(old.is_founder, false));

  if (new.is_founder is distinct from old.is_founder) and coalesce(caller_founder, false) = false then
    new.is_founder := old.is_founder;
  end if;

  if coalesce(caller_role, 'student') <> 'admin' then
    -- non-admin (intern): locked. phone stays editable; country/dial_code/member_id do NOT.
    if old.domain_id is not null then new.domain_id := old.domain_id; end if;
    new.role := old.role; new.banned := old.banned; new.timeout_until := old.timeout_until;
    new.status := old.status; new.is_alumni := old.is_alumni; new.payment_confirmed := old.payment_confirmed;
    new.ram := old.ram; new.discord_id := old.discord_id; new.discord_username := old.discord_username;
    new.classroom_confirmed := old.classroom_confirmed; new.is_founder := old.is_founder;
    new.country := old.country; new.dial_code := old.dial_code; new.member_id := old.member_id;
  elsif target_is_staff and coalesce(caller_founder, false) = false and auth.uid() <> old.id then
    -- a non-founder admin must not touch another admin/founder's protected columns.
    new.role := old.role; new.banned := old.banned; new.timeout_until := old.timeout_until;
    new.status := old.status; new.is_alumni := old.is_alumni; new.payment_confirmed := old.payment_confirmed;
    new.ram := old.ram; new.domain_id := old.domain_id;
    new.discord_id := old.discord_id; new.discord_username := old.discord_username;
    new.classroom_confirmed := old.classroom_confirmed; new.is_founder := old.is_founder;
    new.country := old.country; new.dial_code := old.dial_code; new.member_id := old.member_id;
  end if;
  -- (no blanket member_id lock anymore — admins/founders may re-issue an intern's ID)
  return new;
end; $$;

-- (2) Extend admin_update_profile so admins/founders can also set country / dial_code / member_id.
--     New params default NULL = "leave unchanged" (keeps any old 4-arg callers safe). Empty string clears.
drop function if exists public.admin_update_profile(uuid, text, text, text);
create or replace function public.admin_update_profile(
  target uuid, p_display_name text, p_full_name text, p_gender text,
  p_country text default null, p_dial_code text default null, p_member_id text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;   -- is_admin() = admin or founder
  update public.profiles set
    display_name = coalesce(nullif(btrim(p_display_name), ''), display_name),
    full_name    = nullif(btrim(coalesce(p_full_name, '')), ''),
    gender       = case when p_gender in ('male', 'female') then p_gender else gender end,
    country      = case when p_country   is null then country   else nullif(upper(btrim(p_country)), '') end,
    dial_code    = case when p_dial_code is null then dial_code else nullif(btrim(p_dial_code), '')       end,
    member_id    = case when p_member_id is null then member_id else nullif(btrim(p_member_id), '')       end
  where id = target;
  perform public.log_admin_action('update_profile', target, 'edited name/gender/country/id');
end $$;
grant execute on function public.admin_update_profile(uuid, text, text, text, text, text, text) to authenticated;
