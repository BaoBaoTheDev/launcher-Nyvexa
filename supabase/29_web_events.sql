-- Website telemetry events for admin Website dashboard

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.web_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  path TEXT NOT NULL,
  source TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  session_id TEXT,
  visitor_id TEXT,
  page_title TEXT,
  user_agent TEXT,
  ip_address TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_events_created_at ON public.web_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_events_event_type ON public.web_events(event_type);
CREATE INDEX IF NOT EXISTS idx_web_events_source ON public.web_events(source);
CREATE INDEX IF NOT EXISTS idx_web_events_path ON public.web_events(path);
CREATE INDEX IF NOT EXISTS idx_web_events_session_id ON public.web_events(session_id);
CREATE INDEX IF NOT EXISTS idx_web_events_visitor_id ON public.web_events(visitor_id);

ALTER TABLE public.web_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access web_events" ON public.web_events;
CREATE POLICY "Service role full access web_events"
  ON public.web_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admins read web_events" ON public.web_events;
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE $sql$
      CREATE POLICY "Admins read web_events"
        ON public.web_events
        FOR SELECT
        USING (
          EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'admin'
          )
        );
    $sql$;
  END IF;
END $$;
