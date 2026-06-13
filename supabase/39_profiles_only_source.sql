-- Profiles-only mode
-- Disable auth.users -> profiles sync trigger so profile table is the only source of truth.

begin;

drop trigger if exists trg_sync_profile_from_auth_user on auth.users;
drop function if exists public.sync_profile_from_auth_user();

commit;
