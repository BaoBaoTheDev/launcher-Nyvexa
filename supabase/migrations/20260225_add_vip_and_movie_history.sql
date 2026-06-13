-- VIP fields on profiles
alter table if exists public.profiles
  add column if not exists is_vip boolean not null default false,
  add column if not exists vip_purchased_at timestamptz,
  add column if not exists vip_expires_at timestamptz;

-- Configurable VIP price in app_settings
insert into public.app_settings (key, value)
values ('community_vip_price', '99000')
on conflict (key) do update set value = excluded.value;

-- Configurable VIP duration in days (default: 30)
insert into public.app_settings (key, value)
values ('community_vip_duration_days', '30')
on conflict (key) do update set value = excluded.value;

-- Movie history (one row per movie per user)
create table if not exists public.user_movie_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  movie_name text,
  origin_name text,
  poster_url text,
  banner_url text,
  year text,
  current_episode_slug text,
  current_episode_name text,
  current_time_sec integer not null default 0,
  duration_sec integer not null default 0,
  last_watch_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, slug)
);

create index if not exists idx_user_movie_history_user_last_watch
  on public.user_movie_history (user_id, last_watch_at desc);

-- Movie progress (one row per episode per user)
create table if not exists public.user_movie_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  episode_slug text not null,
  episode_name text,
  episode_index integer not null default 0,
  progress_sec integer not null default 0,
  duration_sec integer not null default 0,
  is_completed boolean not null default false,
  language_label text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, slug, episode_slug)
);

create index if not exists idx_user_movie_progress_user_slug
  on public.user_movie_progress (user_id, slug, episode_index);

-- Optional RLS (safe if already enabled)
alter table if exists public.user_movie_history enable row level security;
alter table if exists public.user_movie_progress enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_movie_history' and policyname = 'Users can select own movie history'
  ) then
    create policy "Users can select own movie history"
      on public.user_movie_history
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_movie_history' and policyname = 'Users can upsert own movie history'
  ) then
    create policy "Users can upsert own movie history"
      on public.user_movie_history
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_movie_progress' and policyname = 'Users can select own movie progress'
  ) then
    create policy "Users can select own movie progress"
      on public.user_movie_progress
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_movie_progress' and policyname = 'Users can upsert own movie progress'
  ) then
    create policy "Users can upsert own movie progress"
      on public.user_movie_progress
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;
