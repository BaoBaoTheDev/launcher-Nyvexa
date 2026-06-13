-- ====================================================================
-- FIX: "Database error finding user" khi đăng ký / gửi OTP / quên mật khẩu
--
-- Nguyên nhân: import_customers.sql chèn vào auth.users nhưng KHÔNG set
-- các cột token. Postgres để chúng = NULL. GoTrue (Supabase Auth, viết
-- bằng Go) đọc các cột này thành kiểu string KHÔNG nullable, gặp NULL sẽ
-- báo "converting NULL to string is unsupported" -> "Database error finding user".
-- Chỉ cần 1 user import bị NULL là HỎNG toàn bộ flow auth của mọi email.
--
-- Cách sửa: đổi mọi token NULL thành chuỗi rỗng ''. Chạy trong Supabase SQL Editor.
-- ====================================================================

UPDATE auth.users
SET
  confirmation_token         = COALESCE(confirmation_token, ''),
  recovery_token             = COALESCE(recovery_token, ''),
  email_change_token_new     = COALESCE(email_change_token_new, ''),
  email_change               = COALESCE(email_change, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  phone_change               = COALESCE(phone_change, ''),
  phone_change_token         = COALESCE(phone_change_token, ''),
  reauthentication_token     = COALESCE(reauthentication_token, '')
WHERE
  confirmation_token         IS NULL
  OR recovery_token          IS NULL
  OR email_change_token_new  IS NULL
  OR email_change            IS NULL
  OR email_change_token_current IS NULL
  OR phone_change            IS NULL
  OR phone_change_token      IS NULL
  OR reauthentication_token  IS NULL;

-- Kiểm tra: sau khi chạy, kết quả phải = 0 dòng
SELECT COUNT(*) AS rows_still_null
FROM auth.users
WHERE confirmation_token IS NULL
   OR recovery_token IS NULL
   OR email_change_token_new IS NULL
   OR email_change IS NULL
   OR email_change_token_current IS NULL
   OR phone_change IS NULL
   OR phone_change_token IS NULL
   OR reauthentication_token IS NULL;
