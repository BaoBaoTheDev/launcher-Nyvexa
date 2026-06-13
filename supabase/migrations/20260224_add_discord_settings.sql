-- Admin-only Discord webhook settings
-- Stores webhook URLs server-side (not in Renderer) and protects with RLS.

create table if not exists public.discord_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at_discord_settings()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_discord_settings_updated_at on public.discord_settings;
create trigger trg_discord_settings_updated_at
before update on public.discord_settings
for each row execute function public.set_updated_at_discord_settings();

alter table public.discord_settings enable row level security;

-- Only admins (profiles.role = 'admin') can read/write.
-- Note: service_role bypasses RLS automatically.

drop policy if exists discord_settings_admin_select on public.discord_settings;
create policy discord_settings_admin_select
on public.discord_settings
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, '')) = 'admin'
  )
);

drop policy if exists discord_settings_admin_write on public.discord_settings;
create policy discord_settings_admin_write
on public.discord_settings
for all
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, '')) = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, '')) = 'admin'
  )
);
