-- Add visibility flag for store listing
ALTER TABLE public.games
ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_games_is_hidden_created_at
  ON public.games (is_hidden, created_at DESC);
