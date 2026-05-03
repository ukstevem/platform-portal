-- App registry for the document service generic upload endpoint (POST /api/file).
-- Each calling app (orderbook, scanner, matl-cert, future apps) is identified by
-- an app_code and authenticates with one or more API keys.
--
-- Keys are hashed at rest (argon2/bcrypt) — plaintext shown exactly once at creation.
-- Multi-key support from day one enables zero-downtime rotation: issue replacement,
-- swap consumer's env var, revoke the old key.
--
-- Tracked in pss-document-service-9mc.

create table if not exists document_app (
  app_code   text        primary key,                 -- 'orderbook', 'scanner', 'matl-cert'
  app_name   text        not null,                    -- human-readable label
  active     boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists document_app_key (
  id           uuid        primary key default gen_random_uuid(),
  app_code     text        not null references document_app(app_code) on delete cascade,
  api_key_hash text        not null,                  -- argon2/bcrypt hash of plaintext key
  label        text,                                  -- admin's note, e.g. 'production', 'rotated 2026-05'
  active       boolean     not null default true,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  last_used_at timestamptz,                           -- bumped by auth middleware on every successful auth

  -- Once revoked, can't be reactivated; once active is set false, revoked_at must be set.
  check (active = true or revoked_at is not null)
);

create index if not exists idx_document_app_key_app
  on document_app_key (app_code);

-- Partial index for the auth fast-path: lookup over active keys only.
create index if not exists idx_document_app_key_active
  on document_app_key (app_code) where active = true;

-- RLS: service-role only.
-- Doc service backend uses SUPABASE_SECRET_KEY (service role) for all access.
-- A future admin UI goes through doc service admin endpoints, not direct Supabase.
-- No policies = no access for anon/authenticated roles.
alter table document_app     enable row level security;
alter table document_app_key enable row level security;
