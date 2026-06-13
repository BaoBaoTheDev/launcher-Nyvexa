-- Thêm cột ảnh custom + icon/banner thư viện cho bảng games
-- Chạy trong Supabase SQL Editor

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS custom_image TEXT;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS library_icon_url TEXT;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS library_hero_url TEXT;

-- Bắt PostgREST nạp lại schema cache (nếu vẫn báo "could not find column")
NOTIFY pgrst, 'reload schema';
