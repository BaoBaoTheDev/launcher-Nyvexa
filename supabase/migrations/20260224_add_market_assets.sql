-- Market assets for profile cosmetics (backgrounds, frames, avatars)

create table if not exists public.market_assets (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('background', 'frame', 'animated_avatar')),
  name text not null,
  description text,
  price bigint not null default 0,
  image_url text not null,
  fit_mode text not null default 'cover',
  anchor text not null default 'center',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists market_assets_type_idx on public.market_assets(type);
create index if not exists market_assets_active_idx on public.market_assets(is_active);

-- Keep updated_at fresh
create or replace function public.set_updated_at_market_assets()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_market_assets_updated_at on public.market_assets;
create trigger trg_market_assets_updated_at
before update on public.market_assets
for each row execute function public.set_updated_at_market_assets();

alter table public.market_assets enable row level security;

-- Public read for active items
drop policy if exists "market_assets_read" on public.market_assets;
create policy "market_assets_read"
  on public.market_assets
  for select
  using (is_active = true);

-- Admin write: relies on profiles.role = 'admin'
-- Note: if your auth schema differs, adjust this policy accordingly.

drop policy if exists "market_assets_admin_write" on public.market_assets;
create policy "market_assets_admin_write"
  on public.market_assets
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role, '')) = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role, '')) = 'admin'
    )
  );
