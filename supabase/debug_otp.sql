-- ====================================================================
-- DEBUG: Kiểm tra tại sao OTP bị lỗi "Database error finding user"
-- Thay 'email_can_test@gmail.com' bằng email thực muốn test
-- ====================================================================

-- 1) Kiểm tra user tồn tại trong auth.users
SELECT 
  id,
  email,
  email_confirmed_at,
  created_at,
  raw_app_meta_data,
  encrypted_password IS NOT NULL AS has_password
FROM auth.users
WHERE email ILIKE 'lehuuphat1806@gmail.com';

-- 2) Kiểm tra identity của user đó
SELECT
  i.id,
  i.user_id,
  i.provider,
  i.provider_id,
  i.identity_data,
  i.created_at
FROM auth.identities i
JOIN auth.users u ON u.id = i.user_id
WHERE u.email ILIKE 'lehuuphat1806@gmail.com';

-- 3) Kiểm tra toàn bộ users không có identity
SELECT 
  u.id,
  u.email,
  u.email_confirmed_at
FROM auth.users u
LEFT JOIN auth.identities i ON i.user_id = u.id AND i.provider = 'email'
WHERE i.id IS NULL
ORDER BY u.email;

-- 4) Kiểm tra identities có email trong identity_data khớp với auth.users.email không
SELECT
  u.email AS user_email,
  i.identity_data->>'email' AS identity_email,
  u.email = (i.identity_data->>'email') AS email_match
FROM auth.identities i
JOIN auth.users u ON u.id = i.user_id
WHERE i.provider = 'email'
  AND u.email != (i.identity_data->>'email')
LIMIT 20;
