CREATE TABLE IF NOT EXISTS public.friend_chat_messages (
  id BIGSERIAL PRIMARY KEY,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_friend_chat_not_self CHECK (sender_id <> recipient_id),
  CONSTRAINT chk_friend_chat_content_len CHECK (char_length(trim(content)) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_friend_chat_sender_created
  ON public.friend_chat_messages(sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_friend_chat_recipient_created
  ON public.friend_chat_messages(recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_friend_chat_pair_created
  ON public.friend_chat_messages(sender_id, recipient_id, created_at DESC);

ALTER TABLE public.friend_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own friend chat" ON public.friend_chat_messages;
DROP POLICY IF EXISTS "Users can send to own friends" ON public.friend_chat_messages;
DROP POLICY IF EXISTS "Users can update own received chat" ON public.friend_chat_messages;

CREATE POLICY "Users can read own friend chat"
  ON public.friend_chat_messages
  FOR SELECT
  USING (
    auth.uid() = sender_id
    OR auth.uid() = recipient_id
  );

CREATE POLICY "Users can send to own friends"
  ON public.friend_chat_messages
  FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1
      FROM public.user_friends uf
      WHERE uf.user_id = auth.uid()
        AND uf.friend_user_id = recipient_id
    )
  );

CREATE POLICY "Users can update own received chat"
  ON public.friend_chat_messages
  FOR UPDATE
  USING (auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = recipient_id);

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_chat_messages;
  EXCEPTION
    WHEN duplicate_object THEN
      NULL;
    WHEN undefined_object THEN
      NULL;
  END;
END
$$;
