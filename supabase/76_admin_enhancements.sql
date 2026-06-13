-- ====================================================================
-- Admin Enhancements
-- 1. Thêm is_hidden vào discount_codes
-- 2. Discord webhook settings
-- ====================================================================

-- 1. is_hidden: mã vẫn dùng được nhưng không hiện trong "Xem mã hiện có"
ALTER TABLE public.discount_codes
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.discount_codes.is_hidden IS
  'Khi true: user vẫn dùng được nhưng không hiện trong danh sách mã có sẵn';

-- 2. Discord webhook keys vào app_settings
-- Chạy sau khi đã có bảng app_settings (migration 16_app_versioning.sql)
INSERT INTO public.app_settings (key, value)
VALUES
  ('discord_webhook_new_game',  ''),
  ('discord_webhook_sale',      '')
ON CONFLICT (key) DO NOTHING;
