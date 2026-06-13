-- Role obfuscation / honeypot labels
-- Mục tiêu: giữ nguyên quyền thật bằng profiles.role,
-- nhưng tạo nhãn role giả để hiển thị/giám sát.

create table if not exists public.role_aliases (
  alias_name text primary key,
  canonical_role text not null,
  is_trap boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint role_aliases_canonical_role_chk
    check (canonical_role in ('admin', 'user', 'ctv', 'trap'))
);

insert into public.role_aliases(alias_name, canonical_role, is_trap)
values
  ('err_503_fallback', 'admin', false),
  ('node_99_legacy', 'admin', false),
  ('deprecated_api_v2', 'admin', false),
  ('client_socket_01', 'user', false),
  ('buffer_cache_hdl', 'user', false),
  ('master_key_access', 'trap', true),
  ('auth_bypass_bypass', 'trap', true)
on conflict (alias_name) do update
set canonical_role = excluded.canonical_role,
    is_trap = excluded.is_trap,
    is_active = true;

alter table public.profiles
  add column if not exists role_masked text;

create or replace function public.pick_role_alias_for(canonical text)
returns text
language sql
stable
as $$
  with candidate as (
    select ra.alias_name
    from public.role_aliases ra
    where ra.is_active = true
      and ra.canonical_role = lower(trim(coalesce(canonical, '')))
    order by random()
    limit 1
  )
  select coalesce((select alias_name from candidate), lower(trim(coalesce(canonical, 'user'))));
$$;

create or replace function public.resolve_canonical_role(raw_role text)
returns text
language sql
stable
as $$
  select coalesce(
    (
      select ra.canonical_role
      from public.role_aliases ra
      where ra.is_active = true
        and lower(ra.alias_name) = lower(trim(coalesce(raw_role, '')))
      limit 1
    ),
    lower(trim(coalesce(raw_role, 'user')))
  );
$$;

create or replace function public.trg_profiles_set_role_masked()
returns trigger
language plpgsql
as $$
begin
  if new.role is null or btrim(new.role) = '' then
    new.role := 'user';
  end if;

  if tg_op = 'INSERT' or new.role is distinct from old.role or new.role_masked is null or btrim(new.role_masked) = '' then
    new.role_masked := public.pick_role_alias_for(new.role);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_set_role_masked on public.profiles;
create trigger trg_profiles_set_role_masked
before insert or update of role, role_masked
on public.profiles
for each row
execute function public.trg_profiles_set_role_masked();

update public.profiles
set role_masked = public.pick_role_alias_for(role)
where role_masked is null or btrim(role_masked) = '';
