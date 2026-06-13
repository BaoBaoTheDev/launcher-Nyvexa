-- Thêm cột role vào profiles (user | admin)
-- Admin: vào Dashboard thêm game lên Store.
-- Chạy sau 03_trigger_new_user.sql

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

COMMENT ON COLUMN public.profiles.role IS 'user | admin';
