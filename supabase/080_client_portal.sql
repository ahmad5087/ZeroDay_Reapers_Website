-- 080_client_portal.sql — Website lead & client portal (Phase 8, #9). Run after 079. Idempotent.
-- Structured service requests (scope questionnaire) replacing plain contact inquiries, an admin
-- pipeline (status + proposal), and a TOKEN-GATED client engagement view — no separate auth system:
-- each request carries a secret access_token and the client opens /engagement/<token>. Flag: client_portal.
--
-- SECURITY NOTES: the token is a bearer secret in the URL (anyone with the link can view). Binary
-- document exchange over R2 is a DEFERRED follow-up that warrants its own security review; this MVP
-- shares documents as links via engagement updates. All public access goes through the two RPCs below.

create table if not exists public.service_requests (
  id              bigint generated always as identity primary key,
  access_token    text not null unique,
  name            text,
  email           text,
  org             text,
  title           text not null,
  scope           jsonb not null default '{}'::jsonb,   -- questionnaire answers
  status          text not null default 'new'  check (status in ('new','triage','scoping','proposal','active','closed')),
  proposal_status text not null default 'none' check (proposal_status in ('none','draft','sent','accepted','declined')),
  proposal_amount numeric,
  proposal_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists service_requests_status on public.service_requests (status, created_at desc);

create table if not exists public.engagement_updates (
  id                bigint generated always as identity primary key,
  request_id        bigint not null references public.service_requests(id) on delete cascade,
  body              text,
  kind              text not null default 'update' check (kind in ('update','proposal','document','status')),
  link              text,                                -- shared link for kind='document'
  visible_to_client boolean not null default true,
  author_id         uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists engagement_updates_req on public.engagement_updates (request_id, created_at desc);

alter table public.service_requests   enable row level security;
alter table public.engagement_updates enable row level security;

-- Admin-only direct access. The public interacts ONLY through the SECURITY DEFINER RPCs below.
drop policy if exists "service_requests_admin" on public.service_requests;
create policy "service_requests_admin" on public.service_requests
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "engagement_updates_admin" on public.engagement_updates;
create policy "engagement_updates_admin" on public.engagement_updates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.touch_service_request()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists touch_service_request_trg on public.service_requests;
create trigger touch_service_request_trg before update on public.service_requests
  for each row execute function public.touch_service_request();

-- Public intake: create a request from the website, return the secret engagement token.
create or replace function public.submit_service_request(p_name text, p_email text, p_org text, p_title text, p_scope jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if char_length(coalesce(p_title, '')) < 1 or char_length(coalesce(p_email, '')) < 3 then
    raise exception 'title and email are required';
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.service_requests (access_token, name, email, org, title, scope)
  values (v_token, left(p_name, 120), left(p_email, 180), left(p_org, 180), left(p_title, 200), coalesce(p_scope, '{}'::jsonb));
  return v_token;
end; $$;
grant execute on function public.submit_service_request(text, text, text, text, jsonb) to anon, authenticated;

-- Token-gated read for the client engagement page (no login). Returns null for an unknown token.
create or replace function public.get_engagement(p_token text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare r public.service_requests;
begin
  select * into r from public.service_requests where access_token = p_token;
  if r.id is null then return null; end if;
  return jsonb_build_object(
    'title', r.title, 'name', r.name, 'org', r.org, 'status', r.status,
    'proposal_status', r.proposal_status, 'proposal_amount', r.proposal_amount, 'proposal_note', r.proposal_note,
    'created_at', r.created_at,
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('body', u.body, 'kind', u.kind, 'link', u.link, 'created_at', u.created_at) order by u.created_at desc)
      from public.engagement_updates u where u.request_id = r.id and u.visible_to_client), '[]'::jsonb)
  );
end; $$;
grant execute on function public.get_engagement(text) to anon, authenticated;
