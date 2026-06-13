CREATE TABLE IF NOT EXISTS public.user_friends (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_user_friends_not_self CHECK (user_id <> friend_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_friends_pair
  ON public.user_friends(user_id, friend_user_id);

CREATE INDEX IF NOT EXISTS idx_user_friends_user
  ON public.user_friends(user_id, created_at DESC);

ALTER TABLE public.user_friends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own friends" ON public.user_friends;
DROP POLICY IF EXISTS "Users can add own friends" ON public.user_friends;
DROP POLICY IF EXISTS "Users can delete own friends" ON public.user_friends;

CREATE POLICY "Users can read own friends"
  ON public.user_friends
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can add own friends"
  ON public.user_friends
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own friends"
  ON public.user_friends
  FOR DELETE
  USING (auth.uid() = user_id);
