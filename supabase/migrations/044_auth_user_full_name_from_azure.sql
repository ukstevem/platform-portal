-- Azure/Entra sends the signed-in user's real name under raw_user_meta_data->>'full_name',
-- and sends no 'name', 'given_name' or 'family_name' at all. sync_auth_user_row() never
-- checked 'full_name', so every row fell through to split_part(email,'@',1) and the portal
-- rendered "firstname.surname". Add 'full_name' to the coalesce and backfill.
--
-- The function itself predates this file (it was applied out-of-band); it is reproduced in
-- full here so the definition is tracked in migrations from now on.

create or replace function public.sync_auth_user_row()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text;
  v_given text;
  v_family text;
  v_full_name text;
  v_display_name text;
  v_avatar_url text;
  v_ip text;
begin
  v_given  := new.raw_user_meta_data->>'given_name';
  v_family := new.raw_user_meta_data->>'family_name';

  v_email := coalesce(
    new.email,
    new.raw_user_meta_data->>'email',
    new.raw_user_meta_data->>'preferred_username',
    new.raw_user_meta_data->>'upn'
  );

  v_full_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(concat_ws(' ', v_given, v_family), ''),
    case when v_email is not null then split_part(v_email,'@',1) end
  );

  v_display_name := coalesce(
    new.raw_user_meta_data->>'preferred_username',
    v_full_name
  );

  v_avatar_url := coalesce(
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'picture'
  );

  v_ip := coalesce(new.raw_user_meta_data->>'ipaddr', new.raw_user_meta_data->>'ip_address');

  insert into public.auth_users (
    id, email, phone, display_name, full_name, avatar_url,
    auth_created_at, last_sign_in_at, user_metadata, app_metadata, last_ip, updated_at
  )
  values (
    new.id, v_email, new.phone, v_display_name, v_full_name, v_avatar_url,
    new.created_at, new.last_sign_in_at, new.raw_user_meta_data, new.raw_app_meta_data,
    nullif(v_ip,'')::inet,
    now()
  )
  on conflict (id) do update
  set email = excluded.email,
      phone = excluded.phone,
      display_name = excluded.display_name,
      full_name = excluded.full_name,
      avatar_url = excluded.avatar_url,
      auth_created_at = excluded.auth_created_at,
      last_sign_in_at = excluded.last_sign_in_at,
      user_metadata = excluded.user_metadata,
      app_metadata = excluded.app_metadata,
      last_ip = excluded.last_ip,
      updated_at = now();

  return new;
end;
$function$;

-- Backfill. Only touches rows whose full_name is missing or is the email local part,
-- so any name set by hand survives.
update public.auth_users au
set full_name = coalesce(
      nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(u.raw_user_meta_data->>'name'), ''),
      nullif(concat_ws(' ',
        u.raw_user_meta_data->>'given_name',
        u.raw_user_meta_data->>'family_name'), ''),
      au.full_name
    ),
    updated_at = now()
from auth.users u
where u.id = au.id
  and (
    au.full_name is null
    or au.full_name = split_part(coalesce(au.email, ''), '@', 1)
  );
