-- Thêm các cột để lưu trữ thông tin fallback
ALTER TABLE public.games 
ADD COLUMN IF NOT EXISTS release_date TEXT,
ADD COLUMN IF NOT EXISTS developer TEXT,
ADD COLUMN IF NOT EXISTS publisher TEXT,
ADD COLUMN IF NOT EXISTS genres TEXT,
ADD COLUMN IF NOT EXISTS recommendations_count INTEGER DEFAULT 0;

-- Cập nhật chú thích
COMMENT ON COLUMN public.games.recommendations_count IS 'Số lượng người đề xuất từ Steam';