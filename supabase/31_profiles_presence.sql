-- Presence support (online/offline)

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

update public.profiles
set last_seen_at = now()
where last_seen_at is null;

create index if not exists idx_profiles_last_seen_at
  on public.profiles(last_seen_at desc);
