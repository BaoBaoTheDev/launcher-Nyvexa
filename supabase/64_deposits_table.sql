-- ─────────────────────────────────────────────────────────────────
-- Bảng deposits: lưu giao dịch nạp tiền (SePay)
-- (Idempotent — chạy lại không bị lỗi)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL,
  order_code BIGINT UNIQUE NOT NULL,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'CANCELLED', 'FAILED')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deposits_user_status_created
  ON public.deposits (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deposits_user_created
  ON public.deposits (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deposits_order_code
  ON public.deposits (order_code);

-- ─── RLS Policies ────────────────────────────────────────────────

ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;

-- User chỉ thấy giao dịch của chính mình
DROP POLICY IF EXISTS "Users can view own deposits" ON public.deposits;
CREATE POLICY "Users can view own deposits"
  ON public.deposits FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Insert/update qua service_role (Rust + edge function)
-- Không cần policy cho user thường
