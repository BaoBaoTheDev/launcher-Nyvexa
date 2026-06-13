ALTER TABLE public.friend_chat_messages
ADD COLUMN IF NOT EXISTS room_key TEXT
GENERATED ALWAYS AS (
  least(sender_id::text, recipient_id::text) || ':' || greatest(sender_id::text, recipient_id::text)
) STORED;

CREATE INDEX IF NOT EXISTS idx_friend_chat_room_created_id
  ON public.friend_chat_messages(room_key, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_friend_chat_recipient_sender_created_id
  ON public.friend_chat_messages(recipient_id, sender_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_friend_chat_sender_recipient_created_id
  ON public.friend_chat_messages(sender_id, recipient_id, created_at DESC, id DESC);
