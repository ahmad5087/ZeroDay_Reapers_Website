-- 034_dm_seen.sql — DM read receipts (Received/Seen) + unread counts. Run after 033. Idempotent.
--
-- seen_at = when the *recipient* first viewed the message. Recipient is defined by sender role:
--   student's message  -> recipient is the admin side (any admin viewing the thread marks it seen)
--   admin's message    -> recipient is the thread's student (that student viewing marks it seen)
-- Unread-for-me = messages addressed to me with seen_at IS NULL. "Received" = row exists; "Seen" = seen_at set.

alter table public.dm_messages add column if not exists seen_at timestamptz;
create index if not exists dm_messages_unseen on public.dm_messages (student_id, seen_at);

-- Mark the messages *I* should see (in a thread) as seen. Safe to call on open.
--   p_student_id = the thread owner (student). Caller is either that student or an admin.
create or replace function public.mark_dm_seen(p_student_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean := public.is_admin();
begin
  if v_is_admin then
    -- an admin opened the thread → student's messages are now seen
    update public.dm_messages
       set seen_at = now()
     where student_id = p_student_id and seen_at is null
       and sender_id = p_student_id;                    -- messages the student sent
  elsif auth.uid() = p_student_id then
    -- the student opened their own thread → admins' messages are now seen
    update public.dm_messages
       set seen_at = now()
     where student_id = p_student_id and seen_at is null
       and sender_id <> p_student_id;                   -- messages an admin sent
  end if;
end; $$;
grant execute on function public.mark_dm_seen(uuid) to authenticated;
