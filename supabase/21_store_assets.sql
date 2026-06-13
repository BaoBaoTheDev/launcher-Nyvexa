-- Bảng lưu trữ ảnh Carousel và Banner
CREATE TABLE public.store_assets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL, -- 'carousel' | 'banner'
  image_url TEXT NOT NULL,
  link_url TEXT, -- Link khi click vào ảnh (tùy chọn)
  position INTEGER DEFAULT 0, -- Thứ tự hiển thị
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bật RLS
ALTER TABLE public.store_assets ENABLE ROW LEVEL SECURITY;

-- Policy cho mọi người xem
CREATE POLICY "Anyone can view store assets" ON store_assets
FOR SELECT USING (true);

-- Policy cho Admin quản lý
CREATE POLICY "Admin can manage store assets" ON store_assets
FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());