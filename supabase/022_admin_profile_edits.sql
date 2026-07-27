-- 022_admin_profile_edits.sql — admins can set gender (own + others) and edit any
-- user's core profile fields (never email/password). Idempotent; safe to re-run.

-- Allow ADMINS to change gender; non-admins stay locked once it's set.
-- auth.uid() null = SQL editor / service role → allowed.
create or replace function public.prevent_gender_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare acting_admin boolean;
begin
  if auth.uid() is null then return new; end if;
  select (role = 'admin') into acting_admin from public.profiles where id = auth.uid();
  if new.gender is distinct from old.gender
     and old.gender is not null
     and coalesce(acting_admin, false) = false then
    new.gender := old.gender; -- students can't change gender after signup
  end if;
  return new;
end; $$;

-- Admin edits another user's core profile (display name, full name, gender).
-- Email + password are auth.users concerns and are intentionally NOT touchable here.
create or replace function public.admin_update_profile(target uuid, p_display_name text, p_full_name text, p_gender text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.profiles set
    display_name = coalesce(nullif(btrim(p_display_name), ''), display_name),
    full_name    = nullif(btrim(coalesce(p_full_name, '')), ''),
    gender       = case when p_gender in ('male', 'female') then p_gender else gender end
  where id = target;
  perform public.log_admin_action('update_profile', target, 'edited name/gender');
end $$;

grant execute on function public.admin_update_profile(uuid, text, text, text) to authenticated;
