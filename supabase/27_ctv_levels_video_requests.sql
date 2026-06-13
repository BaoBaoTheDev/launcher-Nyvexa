-- CTV level system + video promotion requests

CREATE TABLE IF NOT EXISTS public.ctv_creator_stats (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  exp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  commission_bonus_percent INTEGER NOT NULL DEFAULT 0,
  total_code_usages INTEGER NOT NULL DEFAULT 0,
  total_approved_views INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ctv_creator_stats
  ADD CONSTRAINT ctv_creator_stats_level_chk CHECK (level >= 1 AND level <= 10);

ALTER TABLE public.ctv_creator_stats
  ADD CONSTRAINT ctv_creator_stats_nonneg_chk CHECK (
    exp >= 0 AND commission_bonus_percent >= 0 AND total_code_usages >= 0 AND total_approved_views >= 0
  );

CREATE TABLE IF NOT EXISTS public.ctv_video_requests (
  id BIGSERIAL PRIMARY KEY,
  ctv_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  video_url TEXT NOT NULL,
  platform TEXT,
  title TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  views_count INTEGER NOT NULL DEFAULT 0,
  approved_views_count INTEGER NOT NULL DEFAULT 0,
  review_note TEXT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ctv_video_requests
  ADD CONSTRAINT ctv_video_requests_status_chk CHECK (status IN ('pending', 'approved', 'rejected'));

ALTER TABLE public.ctv_video_requests
  ADD CONSTRAINT ctv_video_requests_views_chk CHECK (views_count >= 0 AND approved_views_count >= 0);

CREATE INDEX IF NOT EXISTS idx_ctv_video_requests_user_created
  ON public.ctv_video_requests(ctv_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ctv_video_requests_status
  ON public.ctv_video_requests(status, created_at DESC);

ALTER TABLE public.ctv_creator_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ctv_video_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "CTV can read own stats" ON public.ctv_creator_stats;
CREATE POLICY "CTV can read own stats"
  ON public.ctv_creator_stats FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "CTV can read own video requests" ON public.ctv_video_requests;
CREATE POLICY "CTV can read own video requests"
  ON public.ctv_video_requests FOR SELECT
  USING (auth.uid() = ctv_user_id);

DROP POLICY IF EXISTS "CTV can insert own video requests" ON public.ctv_video_requests;
CREATE POLICY "CTV can insert own video requests"
  ON public.ctv_video_requests FOR INSERT
  WITH CHECK (auth.uid() = ctv_user_id);

DROP POLICY IF EXISTS "CTV can update own pending requests" ON public.ctv_video_requests;
CREATE POLICY "CTV can update own pending requests"
  ON public.ctv_video_requests FOR UPDATE
  USING (auth.uid() = ctv_user_id AND status = 'pending')
  WITH CHECK (auth.uid() = ctv_user_id AND status = 'pending');
