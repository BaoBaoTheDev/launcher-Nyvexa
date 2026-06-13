-- Bảng lưu API keys của hubcapmanifest.com
-- Chỉ admin mới có quyền đọc/ghi

create table if not exists public.hubcap_api_keys (
  id          uuid primary key default gen_random_uuid(),
  label       text not null default '',           -- Nhãn ghi nhớ (ví dụ: "Key chính", "Key dự phòng 1")
  api_key     text not null,                       -- Bearer token
  is_active   boolean not null default true,       -- Admin có thể tắt thủ công
  is_locked   boolean not null default false,      -- Khoá tự động khi hết limit, tự mở sau 24h
  locked_at   timestamptz,                         -- Thời điểm bị khoá
  sort_order  int not null default 0,              -- Thứ tự ưu tiên (thấp = dùng trước)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Tự cập nhật updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hubcap_api_keys_updated_at on public.hubcap_api_keys;
create trigger hubcap_api_keys_updated_at
  before update on public.hubcap_api_keys
  for each row execute procedure public.set_updated_at();

-- RLS: chỉ service_role (dùng trong Rust với service_key) được thao tác
alter table public.hubcap_api_keys enable row level security;

-- Admin đọc qua service_key (bypass RLS) — không cần policy thêm.
-- Nếu muốn admin JWT đọc được, thêm policy:
create policy "admin_all" on public.hubcap_api_keys
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
