-- 079_posts.sql — Public case studies & knowledge publishing (Phase 7, #10). Run after 078. Idempotent.
-- Admin-authored posts (case studies / research / advisories / success stories) with SEO metadata,
-- rendered on the public site at /insights. Published posts are readable by ANON; drafts by admins
-- only. Admins write via admin-write RLS. Flag: case_studies.

create table if not exists public.posts (
  id           bigint generated always as identity primary key,
  type         text not null default 'case_study' check (type in ('case_study','research','advisory','success_story')),
  slug         text not null unique,
  title        text not null check (char_length(title) between 1 and 200),
  excerpt      text check (excerpt is null or char_length(excerpt) <= 500),
  body         text,                                   -- markdown
  cover_key    text,                                   -- optional R2 key
  seo_meta     jsonb not null default '{}'::jsonb,
  status       text not null default 'draft' check (status in ('draft','published')),
  author_id    uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists posts_pub on public.posts (status, published_at desc);

alter table public.posts enable row level security;

-- Published posts are public (anon + authenticated); drafts are admin-only. No `to` clause = all roles.
drop policy if exists "posts_read" on public.posts;
create policy "posts_read" on public.posts
  for select using (status = 'published' or public.is_admin());

-- Admins create/update/delete (anon can't — not authenticated).
drop policy if exists "posts_admin_write" on public.posts;
create policy "posts_admin_write" on public.posts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Ensure the public API role can read (RLS still gates rows to published).
grant select on public.posts to anon, authenticated;

create or replace function public.touch_post()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  if new.status = 'published' and new.published_at is null then new.published_at := now(); end if;
  return new;
end $$;
drop trigger if exists touch_post_trg on public.posts;
create trigger touch_post_trg before insert or update on public.posts
  for each row execute function public.touch_post();
