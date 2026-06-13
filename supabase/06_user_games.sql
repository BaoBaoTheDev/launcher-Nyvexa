-- Bảng user_games: game user đã mua/sở hữu (để được quyền chơi + viết đánh giá)
-- Chạy sau 05_games_table.sql

CREATE TABLE IF NOT EXISTS public.user_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  purchased_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_user_games_user ON public.user_games(user_id);
CREATE INDEX IF NOT EXISTS idx_user_games_game ON public.user_games(game_id);

ALTER TABLE public.user_games ENABLE ROW LEVEL SECURITY;

-- User chỉ đọc được danh sách game của chính mình
CREATE POLICY "User can read own user_games"
  ON public.user_games FOR SELECT
  USING (auth.uid() = user_id);

-- User có thể thêm game cho mình (khi "Mua" / "Chơi" - app xử lý logic giá)
CREATE POLICY "User can insert own user_games"
  ON public.user_games FOR INSERT
  WITH CHECK (auth.uid() = user_id);
