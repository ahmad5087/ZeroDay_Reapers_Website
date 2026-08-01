-- 052_founder_reset_password.sql — let a FOUNDER set a new password for an intern/admin without
-- knowing the current one. Run after 051. Idempotent. Mirrors admin_delete_user's auth.users access.
--
-- Uses bcrypt via pgcrypto (the same scheme Supabase Auth/GoTrue uses), so the user can sign in with
-- the new password immediately. Guards: caller must be a founder; target must exist, must NOT be a
-- founder, and must not be the caller themselves.

create extension if not exists pgcrypto;

create or replace function public.founder_reset_password(target uuid, new_password text)
returns void language plpgsql security definer set search_path = public, auth, extensions as $$
declare tgt_is_founder boolean;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and coalesce(is_founder, false) = true) then
    raise exception 'founder only';
  end if;
  if new_password is null or length(new_password) < 8 then
    raise exception 'Password must be at least 8 characters.';
  end if;
  if target = auth.uid() then
    raise exception 'Use your own password change for your account.';
  end if;

  select coalesce(is_founder, false) into tgt_is_founder from public.profiles where id = target;
  if not found then raise exception 'User not found.'; end if;
  if tgt_is_founder then raise exception 'Cannot reset another founder''s password.'; end if;

  update auth.users
     set encrypted_password = crypt(new_password, gen_salt('bf')),
         updated_at = now()
   where id = target;

  perform public.log_admin_action('reset_password', target, 'founder reset password');
end; $$;

grant execute on function public.founder_reset_password(uuid, text) to authenticated;
