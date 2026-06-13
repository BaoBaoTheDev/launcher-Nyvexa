-- Migration: Remove friend chat feature completely
-- Drops the friend_chat_messages table and all associated indexes/policies.

-- Remove from realtime publication first (ignore errors if not in publication)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.friend_chat_messages;
  EXCEPTION
    WHEN undefined_object THEN NULL;
    WHEN undefined_table THEN NULL;
    WHEN sqlstate '42704' THEN NULL;
  END;
END
$$;

DROP TABLE IF EXISTS public.friend_chat_messages CASCADE;
