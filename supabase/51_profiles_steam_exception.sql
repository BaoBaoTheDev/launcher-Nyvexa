-- Add steam_exception flag to bypass SteamID enforcement for specific users.
-- This migration is idempotent and safe to run multiple times.

alter table if exists public.profiles
  add column if not exists steam_exception boolean not null default false;

update public.profiles
set steam_exception = false
where steam_exception is null;

comment on column public.profiles.steam_exception is
  'When true, launcher skips SteamID validation, Steam mismatch enforcement, and Lua encrypt/decrypt account checks for this user.';