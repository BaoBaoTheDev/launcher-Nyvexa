-- Owned DLCs per user/basegame
-- Run this in Supabase SQL editor (or via migrations pipeline) before using DLC features.

create table if not exists public.owned_dlcs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  base_appid bigint not null,
  dlc_appid bigint not null,
  purchase_price_vnd bigint,
  created_at timestamptz not null default now()
);

create unique index if not exists owned_dlcs_user_base_dlc_uniq
  on public.owned_dlcs (user_id, base_appid, dlc_appid);

create index if not exists owned_dlcs_user_base_idx
  on public.owned_dlcs (user_id, base_appid);

alter table public.owned_dlcs enable row level security;

-- Users can read their own DLC ownership
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'owned_dlcs' and policyname = 'Users read own owned_dlcs'
  ) then
    create policy "Users read own owned_dlcs" on public.owned_dlcs
      for select
      using (auth.uid() = user_id);
  end if;
end $$;

-- Prevent direct client inserts/updates/deletes (handled by server-side IPC via service role)
