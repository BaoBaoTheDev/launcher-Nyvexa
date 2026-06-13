-- Thêm cột sort_order để admin sắp xếp thứ tự hiển thị game trên cửa hàng.
-- Giá trị nhỏ = hiển thị trước (đầu trang). NULL = cuối danh sách.

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_games_sort_order
  ON public.games(sort_order ASC NULLS LAST);

COMMENT ON COLUMN public.games.sort_order IS 'Thứ tự hiển thị trên cửa hàng (nhỏ = đầu, NULL = cuối)';

-- Backfill: gán sort_order dựa trên created_at (game cũ nhất = 1, mới nhất cuối)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM public.games
)
UPDATE public.games g SET sort_order = r.rn
FROM ranked r WHERE g.id = r.id AND g.sort_order IS NULL;
