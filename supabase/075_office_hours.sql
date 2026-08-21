-- 075_office_hours.sql — Mentor office hours & booking (Phase 4). Run after 074. Idempotent.
-- Distinct from live_sessions (group RSVP, 025/062): these are limited-capacity slots an intern books
-- with a question. Admins create slots (RLS admin-write, like live_sessions). Bookings go through
-- capacity-checked SECURITY DEFINER RPCs. A no-show can auto-open a Phase-1 risk case. Flag: office_hours.

create table if not exists public.office_hour_slots (
  id           bigint generated always as identity primary key,
  mentor_id    uuid references public.profiles(id) on delete set null,
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  capacity     int not null default 1 check (capacity between 1 and 100),
  join_url     text,
  location     text,
  domain_id    int references public.domains(id) on delete set null,  -- null = all departments
  notes        text,
  booked_count int not null default 0,                                -- maintained by trigger, for display
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists office_hour_slots_time on public.office_hour_slots (starts_at);

create table if not exists public.office_hour_bookings (
  id         bigint generated always as identity primary key,
  slot_id    bigint not null references public.office_hour_slots(id) on delete cascade,
  intern_id  uuid   not null references public.profiles(id) on delete cascade,
  question   text check (question is null or char_length(question) <= 1000),
  status     text not null default 'booked' check (status in ('booked','cancelled','attended','no_show')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slot_id, intern_id)
);
create index if not exists office_hour_bookings_slot on public.office_hour_bookings (slot_id, status);
create index if not exists office_hour_bookings_intern on public.office_hour_bookings (intern_id);

alter table public.office_hour_slots    enable row level security;
alter table public.office_hour_bookings enable row level security;

-- Slots: read yours-or-global (like live_sessions); admins create/update/delete directly.
drop policy if exists "office_slots_read" on public.office_hour_slots;
create policy "office_slots_read" on public.office_hour_slots
  for select to authenticated using (
    public.is_admin()
    or domain_id is null
    or domain_id = (select domain_id from public.profiles where id = auth.uid())
  );
drop policy if exists "office_slots_admin_write" on public.office_hour_slots;
create policy "office_slots_admin_write" on public.office_hour_slots
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Bookings: read your own (or admin). All writes go through the RPCs below (no client write policy).
drop policy if exists "office_bookings_read" on public.office_hour_bookings;
create policy "office_bookings_read" on public.office_hour_bookings
  for select to authenticated using (intern_id = auth.uid() or public.is_admin());

-- Keep slot.booked_count in sync with active bookings (for capacity display).
create or replace function public.recount_office_hour_slot()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid bigint;
begin
  sid := coalesce(new.slot_id, old.slot_id);
  update public.office_hour_slots
     set booked_count = (select count(*) from public.office_hour_bookings
                          where slot_id = sid and status in ('booked','attended'))
   where id = sid;
  return null;
end; $$;
drop trigger if exists office_hour_bookings_recount on public.office_hour_bookings;
create trigger office_hour_bookings_recount
  after insert or update or delete on public.office_hour_bookings
  for each row execute function public.recount_office_hour_slot();

-- Intern books a slot (capacity-checked, serialized per slot). Re-activates a cancelled booking.
create or replace function public.book_office_hour(p_slot bigint, p_question text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_cap int; v_start timestamptz; v_mentor uuid; v_count int; v_id bigint; v_status text; a_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(p_slot);                       -- serialize concurrent bookings for this slot
  select capacity, starts_at, mentor_id into v_cap, v_start, v_mentor from public.office_hour_slots where id = p_slot;
  if v_cap is null then raise exception 'no such slot'; end if;
  if v_start <= now() then raise exception 'this slot has already started'; end if;

  select id, status into v_id, v_status from public.office_hour_bookings where slot_id = p_slot and intern_id = auth.uid();
  select count(*) into v_count from public.office_hour_bookings where slot_id = p_slot and status in ('booked','attended');

  if v_id is not null then
    if v_status <> 'cancelled' then raise exception 'you already booked this slot'; end if;
    if v_count >= v_cap then raise exception 'slot is full'; end if;
    update public.office_hour_bookings set status = 'booked', question = coalesce(p_question, question), updated_at = now() where id = v_id;
  else
    if v_count >= v_cap then raise exception 'slot is full'; end if;
    insert into public.office_hour_bookings (slot_id, intern_id, question) values (p_slot, auth.uid(), p_question) returning id into v_id;
  end if;

  if v_mentor is not null then                                 -- notify the mentor (definer insert bypasses RLS)
    select display_name into a_name from public.profiles where id = auth.uid();
    insert into public.notifications (user_id, kind, title, body)
    values (v_mentor, 'booking', 'New office-hours booking', coalesce(a_name, 'An intern') || ' booked your slot.');
  end if;
  return v_id;
end; $$;
grant execute on function public.book_office_hour(bigint, text) to authenticated;

create or replace function public.cancel_office_hour_booking(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.office_hour_bookings set status = 'cancelled', updated_at = now()
   where id = p_id and intern_id = auth.uid() and status <> 'cancelled';
end; $$;
grant execute on function public.cancel_office_hour_booking(bigint) to authenticated;

-- Admin marks attendance. A no-show optionally opens a Phase-1 risk case (guarded — interventions optional).
create or replace function public.mark_office_hour_attendance(p_booking bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_intern uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('booked','attended','no_show') then raise exception 'bad status'; end if;
  update public.office_hour_bookings set status = p_status, updated_at = now()
   where id = p_booking returning intern_id into v_intern;
  if v_intern is null then raise exception 'no such booking'; end if;
  perform public.log_admin_action('office_hour_attendance', v_intern, p_status);
  if p_status = 'no_show' then
    begin
      perform public.open_risk_case(v_intern, 'inactivity', 'medium', 'Missed a booked office-hours session.');
    exception when others then null;  -- interventions (070) is optional; never block attendance marking
    end;
  end if;
end; $$;
grant execute on function public.mark_office_hour_attendance(bigint, text) to authenticated;
