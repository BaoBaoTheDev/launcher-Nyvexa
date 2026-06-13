-- Thêm cột is_free cho DLC: manager tích chọn để đánh dấu DLC miễn phí
ALTER TABLE public.dlcs
  ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.dlcs.is_free IS 'true = DLC miễn phí (manager set). false + price=0 = chưa có giá';
