-- 1. Xóa các policy gây lỗi đệ quy
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

-- 2. Tạo hàm kiểm tra Admin (Security Definer giúp bỏ qua RLS để tránh đệ quy)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    SELECT role = 'admin'
    FROM profiles
    WHERE id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Thiết lập lại các Policy chuẩn cho bảng profiles
-- Cho phép mọi người xem profile của chính mình (Bắt buộc để app hoạt động)
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

-- Cho phép Admin xem tất cả các profile khác
CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (is_admin());

-- Cho phép người dùng cập nhật profile của chính mình
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- 4. Cập nhật lại Policy cho bảng giftcodes để dùng hàm is_admin()
DROP POLICY IF EXISTS "Admin can manage giftcodes" ON giftcodes;
CREATE POLICY "Admin can manage giftcodes" ON giftcodes
    FOR ALL USING (is_admin());

-- 5. Đồng bộ lại Email từ bảng Auth sang Profiles (Sửa lỗi N/A)
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND (p.email IS NULL OR p.email = '');

-- 6. ĐẢM BẢO TÀI KHOẢN CỦA BẠN LÀ ADMIN
-- Thay 'email-cua-ban@gmail.com' bằng email admin của bạn
UPDATE profiles SET role = 'admin' WHERE email = 'email-cua-ban@gmail.com';