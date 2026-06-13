-- Ensure every auth user has a matching profiles row and sync core identity fields.
-- This migration is idempotent and safe to run multiple times.

alter table if exists public.profiles
  add column if not exists email text;

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

  insert into public.profiles (id, email, display_name, username, updated_at)
  values (
    new.id,
    coalesce(nullif(btrim(coalesce(new.email, '')), ''), null),
    coalesce(meta_display_name, fallback_name, ''),
    coalesce(meta_username, fallback_name, ''),
    now()
  )
  on conflict (id) do update
  set
    email = coalesce(excluded.email, public.profiles.email),
    display_name = coalesce(meta_display_name, public.profiles.display_name, fallback_name, ''),
    username = coalesce(meta_username, public.profiles.username, fallback_name, ''),
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

insert into public.profiles (id, email, display_name, username, updated_at)
select
  u.id,
  nullif(btrim(coalesce(u.email, '')), ''),
  coalesce(nullif(btrim(coalesce(u.raw_user_meta_data->>'display_name', '')), ''), nullif(split_part(coalesce(u.email, ''), '@', 1), ''), ''),
  coalesce(nullif(lower(btrim(coalesce(u.raw_user_meta_data->>'username', ''))), ''), nullif(split_part(coalesce(u.email, ''), '@', 1), ''), ''),
  now()
from auth.users u
on conflict (id) do update
set
  email = coalesce(excluded.email, public.profiles.email),
  display_name = coalesce(excluded.display_name, public.profiles.display_name),
  username = coalesce(excluded.username, public.profiles.username),
  updated_at = now();