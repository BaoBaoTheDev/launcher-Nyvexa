-- Bổ sung updated_at cho bảng profiles (khắc phục lỗi schema cache thiếu cột updated_at)
-- Chạy sau 32_profiles_playing_status.sql

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
