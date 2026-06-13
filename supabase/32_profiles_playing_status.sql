-- Playing game status for NestG profile

alter table public.profiles
  add column if not exists current_game_appid text,
  add column if not exists current_game_name text,
  add column if not exists current_game_started_at timestamptz;

create index if not exists idx_profiles_current_game_appid
  on public.profiles(current_game_appid);

create index if not exists idx_profiles_current_game_started_at
  on public.profiles(current_game_started_at desc);
