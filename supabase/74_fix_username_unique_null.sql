-- ====================================================================
-- FIX: Cho phép nhiều user có username NULL (partial unique index)
--
-- Vấn đề: trigger handle_new_user() insert username = '' (empty string)
-- khi send_otp create_user=true không truyền metadata.
-- Unique constraint "profiles_username_key" không phân biệt empty string,
-- dẫn đến "duplicate key" khi nhiều user đăng ký cùng lúc.
--
-- Cách sửa:
-- 1. Sửa trigger: dùng NULL thay vì '' khi không có username
-- 2. Drop unique constraint cũ
-- 3. Tạo partial unique index: chỉ enforce unique khi username IS NOT NULL AND username != ''
-- ====================================================================

-- 1. Sửa trigger: insert NULL thay vì '' khi không có username/display_name
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, username)
  VALUES (
    NEW.id,
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'display_name', '')), ''),
    NULLIF(TRIM(LOWER(COALESCE(NEW.raw_user_meta_data->>'username', ''))), '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Drop unique constraint cũ (nếu tồn tại)
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_key;

-- 3. Tạo partial unique index: chỉ enforce unique khi username có giá trị thực
-- NULL và '' đều được phép có nhiều rows
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_nonempty
  ON public.profiles (username)
  WHERE username IS NOT NULL AND username != '';

-- Kiểm tra: đếm số username trùng (không tính NULL và '')
-- Kết quả phải = 0
SELECT username, COUNT(*)
FROM public.profiles
WHERE username IS NOT NULL AND username != ''
GROUP BY username
HAVING COUNT(*) > 1;
