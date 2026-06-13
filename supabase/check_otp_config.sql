-- Kiểm tra flow thực tế: thử tìm user bằng email trực tiếp
-- để xác nhận vấn đề là OTP endpoint hay user lookup

-- 1) Kiểm tra user lehuuphat1806@gmail.com có đầy đủ data không
SELECT 
  u.id,
  u.email,
  u.email_confirmed_at,
  u.encrypted_password IS NOT NULL AS has_password,
  u.raw_app_meta_data,
  i.provider,
  i.identity_data
FROM auth.users u
LEFT JOIN auth.identities i ON i.user_id = u.id AND i.provider = 'email'
WHERE u.email = 'lehuuphat1806@gmail.com';

-- 2) Kiểm tra xem có flow nào bị conflict không
-- (user tồn tại trong cả auth.users lẫn identities với đúng email)
SELECT 
  COUNT(*) AS total_users,
  COUNT(i.id) AS users_with_identity,
  COUNT(*) - COUNT(i.id) AS users_missing_identity
FROM auth.users u
LEFT JOIN auth.identities i ON i.user_id = u.id AND i.provider = 'email';
