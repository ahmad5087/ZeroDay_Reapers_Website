-- 073_resource_library.sql — Department/week resource & knowledge library with full-text search,
-- bookmarks, and completion tracking. Run after 072. Idempotent. Gated in-app by `resource_library`.
--
-- Admins publish resources (is_published); everyone authenticated reads published rows, admins also
-- see drafts. Bookmarks/progress are per-user (own rows via RLS). Resource writes go through admin
-- RPCs (audit-logged). "Versioning" is a version counter bumped on edit (full history is a later add).

create table if not exists public.resources (
  id           bigint generated always as identity primary key,
  title        text not null check (char_length(title) between 1 and 200),
  description  text check (description is null or char_length(description) <= 2000),
  kind         text not null default 'link' check (kind in ('guide','recording','template','tool','link')),
  url          text,                          -- external link, or null when the file lives in R2
  r2_key       text,                          -- uploaded file key in R2, or null
  domain_id    int references public.domains(id) on delete set null,   -- null = all departments
  week         int check (week is null or (week between 0 and 52)),
  version      int not null default 1,
  is_published boolean not null default false,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  search       tsvector generated always as (
                 to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))
               ) stored
);
create index if not exists resources_pub    on public.resources (is_published, domain_id, week);
create index if not exists resources_search on public.resources using gin (search);

create table if not exists public.resource_bookmarks (
  user_id     uuid   not null references public.profiles(id) on delete cascade,
  resource_id bigint not null references public.resources(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, resource_id)
);

create table if not exists public.resource_progress (
  user_id      uuid   not null references public.profiles(id) on delete cascade,
  resource_id  bigint not null references public.resources(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, resource_id)
);

alter table public.resources          enable row level security;
alter table public.resource_bookmarks enable row level security;
alter table public.resource_progress  enable row level security;

-- Read: published rows to everyone; drafts to admins. No client writes (admins use the RPCs below).
drop policy if exists "resources_read" on public.resources;
create policy "resources_read" on public.resources
  for select to authenticated using (is_published or public.is_admin());

-- Bookmarks / progress: users manage their own rows.
drop policy if exists "bookmarks_rw" on public.resource_bookmarks;
create policy "bookmarks_rw" on public.resource_bookmarks
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "progress_rw" on public.resource_progress;
create policy "progress_rw" on public.resource_progress
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Admin: create (p_id null) or update a resource. Bumps version + updated_at on edit.
create or replace function public.upsert_resource(
  p_id bigint, p_title text, p_description text, p_kind text, p_url text, p_r2_key text,
  p_domain_id int, p_week int, p_publish boolean)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_kind not in ('guide','recording','template','tool','link') then raise exception 'bad kind'; end if;
  if char_length(coalesce(p_title,'')) < 1 then raise exception 'title required'; end if;

  if p_id is null then
    insert into public.resources (title, description, kind, url, r2_key, domain_id, week,
                                  is_published, published_by, published_at, created_by)
    values (p_title, p_description, p_kind, p_url, p_r2_key, p_domain_id, p_week,
            coalesce(p_publish, false),
            case when coalesce(p_publish, false) then auth.uid() end,
            case when coalesce(p_publish, false) then now() end,
            auth.uid())
    returning id into v_id;
    perform public.log_admin_action('create_resource', null, p_title);
  else
    update public.resources set
      title = p_title, description = p_description, kind = p_kind, url = p_url, r2_key = p_r2_key,
      domain_id = p_domain_id, week = p_week, version = version + 1, updated_at = now(),
      is_published = coalesce(p_publish, is_published),
      published_by = case when coalesce(p_publish, false) and not is_published then auth.uid() else published_by end,
      published_at = case when coalesce(p_publish, false) and published_at is null then now() else published_at end
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'no such resource'; end if;
    perform public.log_admin_action('update_resource', null, p_title);
  end if;
  return v_id;
end; $$;
grant execute on function public.upsert_resource(bigint, text, text, text, text, text, int, int, boolean) to authenticated;

create or replace function public.set_resource_published(p_id bigint, p_published boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.resources set
    is_published = coalesce(p_published, false),
    published_by = case when coalesce(p_published, false) then auth.uid() else published_by end,
    published_at = case when coalesce(p_published, false) and published_at is null then now() else published_at end,
    updated_at = now()
  where id = p_id;
  perform public.log_admin_action(case when coalesce(p_published, false) then 'publish_resource' else 'unpublish_resource' end, null, p_id::text);
end; $$;
grant execute on function public.set_resource_published(bigint, boolean) to authenticated;

create or replace function public.delete_resource(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  delete from public.resources where id = p_id;
  perform public.log_admin_action('delete_resource', null, p_id::text);
end; $$;
grant execute on function public.delete_resource(bigint) to authenticated;
