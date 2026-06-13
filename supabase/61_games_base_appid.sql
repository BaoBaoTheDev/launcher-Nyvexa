-- Migration: thêm cột base_appid vào bảng games
-- Dùng để đánh dấu một game là DLC của basegame nào.
-- Admin vào trang chi tiết game và set base_appid = appid của basegame.
-- DLC sẽ tự động hiện trong trang detail của basegame đó.
-- DLC KHÔNG hiện ở trang Cửa hàng (lọc ở frontend bằng cách bỏ các game có base_appid).

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS base_appid TEXT;

CREATE INDEX IF NOT EXISTS idx_games_base_appid
  ON public.games (base_appid)
  WHERE base_appid IS NOT NULL;

COMMENT ON COLUMN public.games.base_appid IS
  'appid của basegame nếu đây là DLC; NULL nếu đây là game gốc';
