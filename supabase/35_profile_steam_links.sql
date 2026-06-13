-- Link 1 launcher account <-> 1 Steam account
create table if not exists public.profile_steam_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  steam_account_id text not null unique,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_steam_links_steam_account_id_digits check (steam_account_id ~ '^[0-9]{5,20}$')
);

create index if not exists idx_profile_steam_links_steam_account_id
  on public.profile_steam_links(steam_account_id);

alter table public.profile_steam_links enable row level security;

-- user can read their own linked Steam account
drop policy if exists "profile_steam_links_select_own" on public.profile_steam_links;
create policy "profile_steam_links_select_own"
  on public.profile_steam_links
  for select
  to authenticated
  using (auth.uid() = user_id);

-- user can insert only their own row (1 row/account due to PK)
drop policy if exists "profile_steam_links_insert_own" on public.profile_steam_links;
create policy "profile_steam_links_insert_own"
  on public.profile_steam_links
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- allow user to update their own row (admin upsert uses service role, bypasses RLS)
drop policy if exists "profile_steam_links_update_own" on public.profile_steam_links;
create policy "profile_steam_links_update_own"
  on public.profile_steam_links
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.trg_profile_steam_links_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profile_steam_links_touch_updated_at
  on public.profile_steam_links;

create trigger trg_profile_steam_links_touch_updated_at
before update on public.profile_steam_links
for each row execute function public.trg_profile_steam_links_touch_updated_at();
