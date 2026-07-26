-- ========================= IMMUTABLE GENDER AFTER CREATION =========================
-- Ensure gender cannot be modified by students or admins once set at account creation.

create or replace function public.prevent_gender_update()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.gender is distinct from old.gender and old.gender is not null then
    new.gender := old.gender;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_gender_update on public.profiles;
create trigger trg_prevent_gender_update
  before update on public.profiles
  for each row
  execute function public.prevent_gender_update();
