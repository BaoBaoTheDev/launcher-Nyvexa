-- Sync display_name from auth.users metadata to public.profiles
-- Ensures profile table stays in sync when auth metadata is updated.
-- Idempotent migration.

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
as $$
declare
  meta_display_name text;
  meta_username text;
  fallback_name text;
begin
  meta_display_name := nullif(btrim(coalesce(new.raw_user_meta_data->>'display_name', '')), '');
  meta_username := nullif(lower(btrim(coalesce(new.raw_user_meta_data->>'username', ''))), '');
  fallback_name := nullif(split_part(coalesce(new.email, ''), '@', 1), '');

  insert into public.profiles (id, display_name, username, updated_at)
  values (
    new.id,
    coalesce(meta_display_name, fallback_name, ''),
    coalesce(meta_username, fallback_name, ''),
    now()
  )
  on conflict (id) do update
  set
    display_name = coalesce(meta_display_name, public.profiles.display_name, fallback_name, ''),
    username = coalesce(meta_username, public.profiles.username),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_profile_from_auth_user on auth.users;
create trigger trg_sync_profile_from_auth_user
after insert or update of raw_user_meta_data, email
on auth.users
for each row
execute function public.sync_profile_from_auth_user();

-- Backfill current users once so profiles is consistent immediately.
insert into public.profiles (id, display_name, username, updated_at)
select
  u.id,
  coalesce(nullif(btrim(coalesce(u.raw_user_meta_data->>'display_name', '')), ''), nullif(split_part(coalesce(u.email, ''), '@', 1), ''), ''),
  coalesce(nullif(lower(btrim(coalesce(u.raw_user_meta_data->>'username', ''))), ''), nullif(split_part(coalesce(u.email, ''), '@', 1), ''), ''),
  now()
from auth.users u
on conflict (id) do update
set
  display_name = excluded.display_name,
  username = coalesce(excluded.username, public.profiles.username),
  updated_at = now();
