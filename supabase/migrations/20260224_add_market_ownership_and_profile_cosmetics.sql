-- Ownership + profile cosmetics

-- Profile cosmetics fields
alter table public.profiles
  add column if not exists background_url text,
  add column if not exists background_fit_mode text,
  add column if not exists background_anchor text;

-- Owned market assets
create table if not exists public.market_ownership (
  user_id uuid not null references public.profiles(id) on delete cascade,
  asset_id uuid not null references public.market_assets(id) on delete cascade,
  purchased_at timestamptz not null default now(),
  primary key (user_id, asset_id)
);

create index if not exists market_ownership_user_idx on public.market_ownership(user_id);
create index if not exists market_ownership_asset_idx on public.market_ownership(asset_id);

alter table public.market_ownership enable row level security;

drop policy if exists "market_ownership_read_own" on public.market_ownership;
create policy "market_ownership_read_own"
  on public.market_ownership
  for select
  using (auth.uid() = user_id);

drop policy if exists "market_ownership_insert_own" on public.market_ownership;
create policy "market_ownership_insert_own"
  on public.market_ownership
  for insert
  with check (auth.uid() = user_id);
