-- ============================================================
-- MIGRATION 48: Ensure Steam link tables exist
-- Run this once in Supabase SQL Editor if you see the error:
--   "Bảng profile_steam_links chưa được migrate trên Supabase."
-- This script is idempotent (safe to run multiple times).
-- ============================================================

-- ── 1. profile_steam_links ───────────────────────────────────
create table if not exists public.profile_steam_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  steam_account_id text not null unique,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_steam_links_steam_account_id_digits
    check (steam_account_id ~ '^[0-9]{5,20}$')
);

create index if not exists idx_profile_steam_links_steam_account_id
  on public.profile_steam_links(steam_account_id);

alter table public.profile_steam_links enable row level security;

drop policy if exists "profile_steam_links_select_own" on public.profile_steam_links;
create policy "profile_steam_links_select_own"
  on public.profile_steam_links for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "profile_steam_links_insert_own" on public.profile_steam_links;
create policy "profile_steam_links_insert_own"
  on public.profile_steam_links for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "profile_steam_links_update_own" on public.profile_steam_links;
create policy "profile_steam_links_update_own"
  on public.profile_steam_links for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.trg_profile_steam_links_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profile_steam_links_touch_updated_at
  on public.profile_steam_links;
create trigger trg_profile_steam_links_touch_updated_at
  before update on public.profile_steam_links
  for each row execute function public.trg_profile_steam_links_touch_updated_at();

-- ── 2. steam_link_change_requests ───────────────────────────
create table if not exists public.steam_link_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_steam_account_id text not null,
  current_linked_steam_account_id text not null,
  status text not null default 'pending',
  admin_note text null,
  reviewed_by uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint steam_link_change_requests_status_chk
    check (status in ('pending', 'approved', 'rejected')),
  constraint steam_link_change_requests_requested_digits
    check (requested_steam_account_id ~ '^[0-9]{5,20}$'),
  constraint steam_link_change_requests_current_digits
    check (current_linked_steam_account_id ~ '^[0-9]{5,20}$')
);

create index if not exists idx_steam_link_change_requests_user_created
  on public.steam_link_change_requests(user_id, created_at desc);

create index if not exists idx_steam_link_change_requests_status_created
  on public.steam_link_change_requests(status, created_at desc);

-- 1 pending request at a time per user
create unique index if not exists uq_steam_link_change_requests_user_pending
  on public.steam_link_change_requests(user_id)
  where status = 'pending';

alter table public.steam_link_change_requests enable row level security;

drop policy if exists "steam_link_change_requests_select_own" on public.steam_link_change_requests;
create policy "steam_link_change_requests_select_own"
  on public.steam_link_change_requests for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "steam_link_change_requests_insert_own" on public.steam_link_change_requests;
create policy "steam_link_change_requests_insert_own"
  on public.steam_link_change_requests for insert to authenticated
  with check (auth.uid() = user_id);

create or replace function public.trg_steam_link_change_requests_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_steam_link_change_requests_touch_updated_at
  on public.steam_link_change_requests;
create trigger trg_steam_link_change_requests_touch_updated_at
  before update on public.steam_link_change_requests
  for each row execute function public.trg_steam_link_change_requests_touch_updated_at();
