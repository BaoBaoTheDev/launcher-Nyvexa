-- ====================================================================
-- Referral System (Mã Giới Thiệu)
-- Cấp độ:  Cấp 1 (mặc định): 15%  | Cấp 2 (20 người): 20% | Cấp 3 (50 người): 25%
-- Người mua nhập mã → được giảm cùng % đó khi thanh toán.
-- Người tạo mã → nhận vào referral_balance (tách khỏi balance launcher).
-- ====================================================================

-- ── 1. Thêm cột referral_balance vào profiles ──────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_balance BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_referral_balance_nn;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_referral_balance_nn CHECK (referral_balance >= 0);

-- ── 2. Bảng referral_codes ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code         TEXT NOT NULL UNIQUE,
  -- Cấp độ tự tính từ total_uses: 1→<20, 2→20–49, 3→≥50
  total_uses   INTEGER NOT NULL DEFAULT 0 CHECK (total_uses >= 0),
  total_earned BIGINT  NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code   ON public.referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_user   ON public.referral_codes(user_id);

-- ── 3. Bảng referral_uses ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_uses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code_id UUID NOT NULL REFERENCES public.referral_codes(id) ON DELETE CASCADE,
  buyer_user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id          UUID REFERENCES public.games(id) ON DELETE SET NULL,
  game_name        TEXT,
  order_amount     BIGINT NOT NULL CHECK (order_amount >= 0),
  discount_percent INTEGER NOT NULL CHECK (discount_percent BETWEEN 1 AND 99),
  discount_amount  BIGINT NOT NULL CHECK (discount_amount >= 0),
  commission_amount BIGINT NOT NULL CHECK (commission_amount >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_uses_code    ON public.referral_uses(referral_code_id);
CREATE INDEX IF NOT EXISTS idx_referral_uses_buyer   ON public.referral_uses(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_uses_created ON public.referral_uses(created_at DESC);

-- ── 4. RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_uses  ENABLE ROW LEVEL SECURITY;

-- Mọi authenticated user có thể đọc CODE (để validate khi mua)
DROP POLICY IF EXISTS referral_codes_read ON public.referral_codes;
CREATE POLICY referral_codes_read ON public.referral_codes
  FOR SELECT TO authenticated USING (true);

-- User chỉ đọc uses của mình; admin đọc tất cả
DROP POLICY IF EXISTS referral_uses_read_own ON public.referral_uses;
CREATE POLICY referral_uses_read_own ON public.referral_uses
  FOR SELECT TO authenticated
  USING (
    buyer_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.referral_codes rc
      WHERE rc.id = referral_code_id AND rc.user_id = auth.uid()
    )
    OR is_admin()
  );

-- Service role được ghi (backend bypass RLS)
DROP POLICY IF EXISTS referral_codes_service ON public.referral_codes;
CREATE POLICY referral_codes_service ON public.referral_codes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS referral_uses_service ON public.referral_uses;
CREATE POLICY referral_uses_service ON public.referral_uses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 5. Helper: tính % giảm theo số lượng uses ──────────────────────────
CREATE OR REPLACE FUNCTION public.referral_discount_percent(total_uses INTEGER)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN total_uses >= 50 THEN 25
    WHEN total_uses >= 20 THEN 20
    ELSE 15
  END;
$$;
