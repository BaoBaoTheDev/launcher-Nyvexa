-- Adjust market_assets schema for latest launcher expectations

alter table public.market_assets
  add column if not exists fit_mode text not null default 'cover',
  add column if not exists anchor text not null default 'center';

-- Remove deprecated type 'avatar' (static avatar) from the allowed set.
-- Default inline CHECK constraint name is typically market_assets_type_check.
alter table public.market_assets drop constraint if exists market_assets_type_check;
alter table public.market_assets
  add constraint market_assets_type_check
  check (type in ('background', 'frame', 'animated_avatar'));
