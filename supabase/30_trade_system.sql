-- Trade system (VIP-only) + notifications

create table if not exists public.user_notifications (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'system',
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_notifications_user_created
  on public.user_notifications(user_id, created_at desc);
create index if not exists idx_user_notifications_unread
  on public.user_notifications(user_id, is_read);

create table if not exists public.trade_offers (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'direct', -- direct | community
  status text not null default 'pending', -- pending|accepted|rejected|countered|cancelled|community_open|community_closed
  initiator_user_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid references auth.users(id) on delete set null,
  give_game_ids uuid[] not null default '{}',
  want_game_ids uuid[] not null default '{}',
  want_text text,
  message text,
  parent_offer_id uuid references public.trade_offers(id) on delete set null,
  fee_each_vnd bigint not null default 0,
  accepted_at timestamptz,
  last_action_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_trade_offers_initiator_created
  on public.trade_offers(initiator_user_id, created_at desc);
create index if not exists idx_trade_offers_target_created
  on public.trade_offers(target_user_id, created_at desc);
create index if not exists idx_trade_offers_mode_status_created
  on public.trade_offers(mode, status, created_at desc);

create or replace function public.set_trade_offer_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_trade_offer_updated_at on public.trade_offers;
create trigger trg_trade_offer_updated_at
before update on public.trade_offers
for each row execute procedure public.set_trade_offer_updated_at();

alter table public.user_notifications enable row level security;
alter table public.trade_offers enable row level security;

drop policy if exists "service role full access notifications" on public.user_notifications;
create policy "service role full access notifications"
  on public.user_notifications
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service role full access trade offers" on public.trade_offers;
create policy "service role full access trade offers"
  on public.trade_offers
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

insert into public.app_settings(key, value)
values
  ('trade_enabled', '1'),
  ('trade_fee_vnd', '10000'),
  ('trade_limit_daily', '5'),
  ('trade_limit_weekly', '20'),
  ('trade_limit_monthly', '60')
on conflict (key) do nothing;
