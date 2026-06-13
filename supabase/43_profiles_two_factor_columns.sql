-- Add TOTP 2FA columns for launcher auth flow
-- Safe to run multiple times.

alter table if exists public.profiles
  add column if not exists two_factor_enabled boolean not null default false;

alter table if exists public.profiles
  add column if not exists two_factor_secret text;

comment on column public.profiles.two_factor_enabled is 'Enable Google Authenticator (TOTP) for login verification.';
comment on column public.profiles.two_factor_secret is 'Base32 secret for Google Authenticator (TOTP).';
