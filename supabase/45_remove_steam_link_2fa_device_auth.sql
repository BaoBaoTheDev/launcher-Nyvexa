-- Remove Steam-link, device-session, and 2FA/new-device authentication artifacts.
-- This migration is idempotent and safe to run multiple times.

-- Drop link-change request workflow objects.
drop trigger if exists trg_steam_link_change_requests_touch_updated_at on public.steam_link_change_requests;
drop function if exists public.trg_steam_link_change_requests_touch_updated_at();
drop table if exists public.steam_link_change_requests cascade;

-- Drop Steam link table.
drop trigger if exists trg_profile_steam_links_touch_updated_at on public.profile_steam_links;
drop function if exists public.trg_profile_steam_links_touch_updated_at();
drop table if exists public.profile_steam_links cascade;

-- Drop device session table if present.
drop table if exists public.device_sessions cascade;

-- Remove profile columns used only by 2FA/new-device verification.
alter table if exists public.profiles
  drop column if exists two_factor_enabled,
  drop column if exists two_factor_secret,
  drop column if exists current_device_id;
