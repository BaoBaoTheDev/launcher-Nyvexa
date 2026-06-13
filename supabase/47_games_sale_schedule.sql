-- Sale schedule support for admin planning and automatic sale ending
-- Adds metadata columns used by launcher/admin to auto-expire sales

alter table if exists public.games
  add column if not exists sale_start_at timestamptz,
  add column if not exists sale_end_at timestamptz;

create index if not exists idx_games_sale_end_at
  on public.games (sale_end_at desc)
  where sale_end_at is not null and coalesce(original_price, 0) > 0;

comment on column public.games.sale_start_at is 'Sale start timestamp configured by admin (UTC).';
comment on column public.games.sale_end_at is 'Sale end timestamp configured by admin (UTC). Launcher auto-ends sale when passed.';
