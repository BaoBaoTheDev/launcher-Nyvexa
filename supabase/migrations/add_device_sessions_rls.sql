-- Idempotent RLS setup for device_sessions
-- Safe to run multiple times

ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_sessions_user_device
ON public.device_sessions(user_id, device_id);

DROP POLICY IF EXISTS device_sessions_select_own ON public.device_sessions;
DROP POLICY IF EXISTS device_sessions_insert_own ON public.device_sessions;
DROP POLICY IF EXISTS device_sessions_update_own ON public.device_sessions;

CREATE POLICY device_sessions_select_own
ON public.device_sessions
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY device_sessions_insert_own
ON public.device_sessions
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY device_sessions_update_own
ON public.device_sessions
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
