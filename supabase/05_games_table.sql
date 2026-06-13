-- Bảng games: admin chỉ nhập appid (Steam); ảnh, trailer, mô tả... lấy từ Steam API
-- Chạy sau 04_profiles_role.sql

CREATE TABLE IF NOT EXISTS public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appid TEXT NOT NULL UNIQUE,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  short_description TEXT,
  name TEXT,
  header_image TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

-- Mọi user đăng nhập đều đọc được danh sách game
CREATE POLICY "Anyone can read games"
  ON public.games FOR SELECT
  TO authenticated
  USING (true);

-- Chỉ admin được thêm/sửa/xóa game
CREATE POLICY "Admin can insert games"
  ON public.games FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admin can update games"
  ON public.games FOR UPDATE
  TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admin can delete games"
  ON public.games FOR DELETE
  TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
