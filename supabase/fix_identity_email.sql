-- ====================================================================
-- FIX: Cập nhật identity_data cho tất cả email identities
-- Thêm "email" và "email_verified": true vào identity_data
-- từ auth.users.email (nguồn đúng)
-- ====================================================================

UPDATE auth.identities i
SET identity_data = jsonb_build_object(
    'sub',            i.user_id::text,
    'email',          u.email,
    'email_verified', true
)
FROM auth.users u
WHERE i.user_id = u.id
  AND i.provider = 'email';

-- Kiểm tra kết quả
SELECT
  i.identity_data,
  u.email
FROM auth.identities i
JOIN auth.users u ON u.id = i.user_id
WHERE i.provider = 'email'
LIMIT 5;
