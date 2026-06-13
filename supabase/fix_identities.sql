-- ====================================================================
-- FIX: Cập nhật identity_data cho tất cả imported users
-- Supabase GoTrue mới yêu cầu identity_data có "email_verified": true
-- Chạy trong Supabase SQL Editor
-- ====================================================================

-- Bước 1: Cập nhật identity_data của tất cả identities bị thiếu email_verified
UPDATE auth.identities
SET identity_data = identity_data || '{"email_verified": true}'::jsonb
WHERE provider = 'email'
  AND (identity_data->>'email_verified') IS NULL;

-- Bước 2: Đảm bảo tất cả user được import có email_confirmed_at (GoTrue cần để gửi OTP)
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
    updated_at = now()
WHERE email_confirmed_at IS NULL;

-- Bước 3: Kiểm tra kết quả
SELECT
  COUNT(*) FILTER (WHERE (identity_data->>'email_verified') = 'true') AS identities_with_verified,
  COUNT(*) FILTER (WHERE (identity_data->>'email_verified') IS NULL) AS identities_missing_verified,
  COUNT(*) AS total_identities
FROM auth.identities
WHERE provider = 'email';
