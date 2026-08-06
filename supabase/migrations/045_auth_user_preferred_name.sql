-- A friendly name for the portal to greet people by. Nothing can derive "Steve" from
-- "Stephen", and Entra does not supply a nickname, so this is set by hand and is null
-- until someone chooses one — the UI falls back to the first word of full_name.
--
-- sync_auth_user_row() (see 044) does not list preferred_name in its ON CONFLICT DO UPDATE,
-- so the value survives the re-sync that runs on every sign-in.

alter table public.auth_users
  add column if not exists preferred_name text;

comment on column public.auth_users.preferred_name is
  'Optional friendly/known-as name (e.g. "Steve" for "Stephen"). Set by hand; null means fall back to the first word of full_name.';
