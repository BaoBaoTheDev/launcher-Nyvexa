-- Hotfix for restored projects under load:
-- 1) compatibility for legacy routines still reading profiles.current_device_id
-- 2) lightweight indexes for common hot paths seen in launcher logs

alter table if exists public.profiles
  add column if not exists current_device_id text;

create index if not exists idx_review_gifts_is_active_price_created_at
  on public.review_gifts (is_active, price, created_at desc);

create index if not exists idx_web_events_created_at
  on public.web_events (created_at desc);
