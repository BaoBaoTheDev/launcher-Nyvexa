-- Bổ sung chi tiết ban cho profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ban_reason TEXT,
  ADD COLUMN IF NOT EXISTS ban_until TIMESTAMPTZ,      -- NULL + is_banned=true = ban vĩnh viễn
  ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.ban_reason IS 'Lý do bị ban';
COMMENT ON COLUMN public.profiles.ban_until IS 'Thời điểm hết hạn ban (NULL = vĩnh viễn khi is_banned=true)';
COMMENT ON COLUMN public.profiles.banned_at IS 'Thời điểm bị ban';
