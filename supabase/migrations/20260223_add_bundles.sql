-- Bundles (game + DLC combos)
-- Creates public.bundles and public.bundle_items.

create table if not exists public.bundles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price_vnd bigint not null default 0,
  original_total_vnd bigint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists bundles_active_created_idx
  on public.bundles (is_active, created_at desc);

create table if not exists public.bundle_items (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.bundles(id) on delete cascade,
  item_type text not null,
  base_appid bigint not null,
  game_id uuid references public.games(id) on delete set null,
  dlc_appid bigint,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint bundle_item_type_chk check (item_type in ('game', 'dlc')),
  constraint bundle_item_shape_chk check (
    (item_type = 'game' and game_id is not null and dlc_appid is null)
    or
    (item_type = 'dlc' and dlc_appid is not null)
  )
);

create index if not exists bundle_items_base_appid_idx
  on public.bundle_items (base_appid, bundle_id);

create index if not exists bundle_items_bundle_sort_idx
  on public.bundle_items (bundle_id, sort_order);

alter table public.bundles enable row level security;
alter table public.bundle_items enable row level security;

-- Allow anyone who can use the launcher to read active bundles.
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'bundles' and policyname = 'Read active bundles'
  ) then
    create policy "Read active bundles" on public.bundles
      for select
      using (is_active = true);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'bundle_items' and policyname = 'Read items for active bundles'
  ) then
    create policy "Read items for active bundles" on public.bundle_items
      for select
      using (exists (
        select 1 from public.bundles b
        where b.id = bundle_id and b.is_active = true
      ));
  end if;
end $$;

-- No direct client writes (admin IPC via service role / supabaseAdmin)
