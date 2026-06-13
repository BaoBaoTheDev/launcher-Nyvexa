-- Tạo bảng lưu trữ cấu hình hệ thống
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bật RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Cho phép mọi người đọc cấu hình
CREATE POLICY "Allow public read access to app_settings" 
ON public.app_settings FOR SELECT USING (true);

-- Chỉ Admin mới có quyền sửa
CREATE POLICY "Allow admin to manage app_settings" 
ON public.app_settings FOR ALL TO authenticated 
USING (is_admin()) WITH CHECK (is_admin());

-- Chèn dữ liệu mẫu ban đầu
INSERT INTO public.app_settings (key, value) VALUES 
('min_version', '1.0.0'),
('latest_version', '1.0.0'),
('download_url', 'https://github.com/your-username/nestg-launcher/releases')
ON CONFLICT (key) DO NOTHING;