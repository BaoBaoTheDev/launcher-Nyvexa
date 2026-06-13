-- Fix: allow authenticated user to persist own profile fields (display_name, summary, avatar, etc.)
-- This migration is idempotent and safe to run multiple times.

alter table public.profiles enable row level security;

-- Ensure table privileges are present for authenticated users.
grant select, insert, update on table public.profiles to authenticated;

-- Remove legacy/ambiguous policies that may block updates.
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "User can read own profile" on public.profiles;
drop policy if exists "User can update own profile" on public.profiles;
drop policy if exists "User can insert own profile" on public.profiles;
drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

-- Recreate minimal self-service policies.
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Optional admin read policy (kept for compatibility if is_admin() exists).
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'is_admin'
      and n.nspname = 'public'
  ) then
    execute 'drop policy if exists "profiles_select_admin" on public.profiles';
    execute '
      create policy "profiles_select_admin"
      on public.profiles
      for select
      to authenticated
      using (public.is_admin())
    ';
  end if;
end $$;
