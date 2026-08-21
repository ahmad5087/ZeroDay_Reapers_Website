-- 076_webauthn.sql — Real WebAuthn passkeys (Phase 5). Run after 075. Idempotent. Flag: passkeys.
-- Credentials + short-lived challenges + hashed recovery codes, verified server-side in
-- app/api/webauthn/* with @simplewebauthn/server (service role). ADDITIVE: password login and
-- recovery codes always remain, so a user can never be locked out. Login step-up is per-user
-- opt-in via profiles.passkey_required (default false) — passwordless session-minting is deferred.

alter table public.profiles add column if not exists passkey_required boolean not null default false;

create table if not exists public.webauthn_credentials (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  credential_id text not null unique,          -- base64url credential id
  public_key    text not null,                 -- base64url of the COSE public key
  counter       bigint not null default 0,
  transports    text[],
  device_type   text,
  backed_up     boolean,
  nickname      text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists webauthn_credentials_user on public.webauthn_credentials (user_id);

create table if not exists public.webauthn_challenges (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles(id) on delete cascade,
  challenge  text not null,
  kind       text not null check (kind in ('register','auth')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists webauthn_challenges_user on public.webauthn_challenges (user_id, kind, created_at desc);

create table if not exists public.recovery_codes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  code_hash  text not null,                    -- sha256 hex of the plaintext code
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists recovery_codes_user on public.recovery_codes (user_id) where used_at is null;

alter table public.webauthn_credentials enable row level security;
alter table public.webauthn_challenges  enable row level security;
alter table public.recovery_codes       enable row level security;

-- Credentials: read your own (or admin), delete your own. Inserts/updates only via service-role routes.
drop policy if exists "webauthn_cred_read" on public.webauthn_credentials;
create policy "webauthn_cred_read" on public.webauthn_credentials
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "webauthn_cred_del" on public.webauthn_credentials;
create policy "webauthn_cred_del" on public.webauthn_credentials
  for delete to authenticated using (user_id = auth.uid());

-- Challenges + recovery codes: NO client policy (service-role routes only). RLS on with no policy
-- means authenticated clients cannot read/write; the service role bypasses RLS. This keeps the
-- recovery code_hash values unreadable by clients.

-- How many unused recovery codes the caller has (for the settings UI — never exposes the hashes).
create or replace function public.recovery_codes_remaining()
returns int language sql security definer set search_path = public stable as $$
  select count(*)::int from public.recovery_codes where user_id = auth.uid() and used_at is null;
$$;
grant execute on function public.recovery_codes_remaining() to authenticated;
