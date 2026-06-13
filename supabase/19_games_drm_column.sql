-- Thêm cột drm vào bảng games
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS drm TEXT;

-- Cập nhật dữ liệu mẫu cho các game hiện tại (nếu có)
UPDATE public.games SET drm = 'Steam' WHERE drm IS NULL;