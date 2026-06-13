-- Review comments/votes/replies + review gifts catalog/transactions
-- Chạy sau 33_profiles_updated_at.sql

CREATE TABLE IF NOT EXISTS public.review_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  parent_reply_id UUID NULL REFERENCES public.review_replies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_replies_review ON public.review_replies(review_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_replies_user ON public.review_replies(user_id);

ALTER TABLE public.review_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read review replies" ON public.review_replies;
CREATE POLICY "Anyone can read review replies"
  ON public.review_replies FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "User can insert own review reply" ON public.review_replies;
CREATE POLICY "User can insert own review reply"
  ON public.review_replies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.review_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vote_value SMALLINT NOT NULL CHECK (vote_value IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(review_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_review_votes_review ON public.review_votes(review_id);
CREATE INDEX IF NOT EXISTS idx_review_votes_user ON public.review_votes(user_id);

ALTER TABLE public.review_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read review votes" ON public.review_votes;
CREATE POLICY "Anyone can read review votes"
  ON public.review_votes FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "User can insert own review vote" ON public.review_votes;
CREATE POLICY "User can insert own review vote"
  ON public.review_votes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "User can update own review vote" ON public.review_votes;
CREATE POLICY "User can update own review vote"
  ON public.review_votes FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "User can delete own review vote" ON public.review_votes;
CREATE POLICY "User can delete own review vote"
  ON public.review_votes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.review_gifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🎁',
  price BIGINT NOT NULL CHECK (price > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_gifts_active ON public.review_gifts(is_active, price);

ALTER TABLE public.review_gifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read active review gifts" ON public.review_gifts;
CREATE POLICY "Anyone can read active review gifts"
  ON public.review_gifts FOR SELECT
  TO authenticated
  USING (true);

CREATE TABLE IF NOT EXISTS public.review_gift_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  gift_id UUID NOT NULL REFERENCES public.review_gifts(id) ON DELETE RESTRICT,
  sender_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_gift_tx_review ON public.review_gift_transactions(review_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_gift_tx_sender ON public.review_gift_transactions(sender_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_gift_tx_receiver ON public.review_gift_transactions(receiver_user_id, created_at DESC);

ALTER TABLE public.review_gift_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read review gift transactions" ON public.review_gift_transactions;
CREATE POLICY "Anyone can read review gift transactions"
  ON public.review_gift_transactions FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "User can insert own review gift tx" ON public.review_gift_transactions;
CREATE POLICY "User can insert own review gift tx"
  ON public.review_gift_transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = sender_user_id);
