-- Chính sách RLS cho bảng profiles
-- Chạy sau 01_profiles_table.sql

-- User đọc được chính profile của mình
CREATE POLICY "User can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- User sửa được chính profile của mình
CREATE POLICY "User can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- User chỉ insert được 1 dòng profile với id = chính mình (khi đăng ký)
CREATE POLICY "User can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);
