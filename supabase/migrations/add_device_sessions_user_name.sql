-- Add user_name column for easier tracking in device_sessions
-- Safe to run multiple times

ALTER TABLE public.device_sessions
ADD COLUMN IF NOT EXISTS user_name TEXT;

CREATE INDEX IF NOT EXISTS idx_device_sessions_user_name
ON public.device_sessions(user_name);
