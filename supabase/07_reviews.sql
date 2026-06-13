-- Bảng reviews: đánh giá thật từ user đã mua game (Recommend / Not Recommend + nội dung)
-- Chạy sau 06_user_games.sql

CREATE TABLE IF NOT EXISTS public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  recommended BOOLEAN NOT NULL,
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_game ON public.reviews(game_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON public.reviews(user_id);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Mọi user đọc được đánh giá
CREATE POLICY "Anyone can read reviews"
  ON public.reviews FOR SELECT
  TO authenticated
  USING (true);

-- User chỉ được đăng 1 lần (không sửa/xóa)
CREATE POLICY "User can insert own review"
  ON public.reviews FOR INSERT
  WITH CHECK (auth.uid() = user_id);
