-- Mirror migration for environments applying numbered SQL files from /supabase.

alter table public.profiles
  add column if not exists banner_url text,
  add column if not exists banner_fit_mode text not null default 'cover',
  add column if not exists banner_anchor text not null default 'center';

alter table public.market_assets drop constraint if exists market_assets_type_check;
alter table public.market_assets
  add constraint market_assets_type_check
  check (type in ('background', 'banner', 'frame', 'animated_avatar'));
