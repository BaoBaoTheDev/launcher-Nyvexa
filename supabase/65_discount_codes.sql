-- ─────────────────────────────────────────────────────────────────
-- Bảng discount_codes: mã giảm giá
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.discount_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,                    -- mã code (uppercase)
  name TEXT,                                    -- tên hiển thị
  description TEXT,
  -- type: 'fixed' (giảm số tiền cố định cho game/dlc),
  --       'percent' (giảm % cho game/dlc),
  --       'deposit_fixed' (giảm số tiền chi trả khi nạp tiền),
  --       'deposit_percent' (giảm % chi trả khi nạp tiền)
  type TEXT NOT NULL CHECK (type IN ('fixed', 'percent', 'deposit_fixed', 'deposit_percent')),
  value NUMERIC(12,2) NOT NULL DEFAULT 0,       -- giá trị (tiền hoặc %)
  expires_at TIMESTAMPTZ,                       -- hết hạn (NULL = không giới hạn)
  applies_to_sale BOOLEAN NOT NULL DEFAULT true, -- áp dụng cho game đang sale?
  applies_to_all BOOLEAN NOT NULL DEFAULT true,  -- áp dụng cho mọi game/dlc?
  applicable_game_ids UUID[],                   -- nếu applies_to_all=false → list game IDs
  min_price NUMERIC(12,2),                      -- giá tối thiểu của game (NULL = không giới hạn)
  max_price NUMERIC(12,2),                      -- giá tối đa
  max_uses INTEGER,                             -- số lần dùng tối đa (NULL = vô hạn)
  current_uses INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON public.discount_codes(code);
CREATE INDEX IF NOT EXISTS idx_discount_codes_active ON public.discount_codes(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_discount_codes_type ON public.discount_codes(type);

-- Trigger update updated_at
CREATE OR REPLACE FUNCTION public.update_discount_codes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS discount_codes_updated_at ON public.discount_codes;
CREATE TRIGGER discount_codes_updated_at
  BEFORE UPDATE ON public.discount_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_discount_codes_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────

ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;

-- User đọc được mã đang active (không phải deposit-only)
DROP POLICY IF EXISTS "Users read active discount codes" ON public.discount_codes;
CREATE POLICY "Users read active discount codes"
  ON public.discount_codes FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Insert/update/delete chỉ qua service_key (admin)

-- ─────────────────────────────────────────────────────────────────
-- Bảng discount_code_redemptions: lịch sử dùng mã
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.discount_code_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id UUID NOT NULL REFERENCES public.discount_codes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- order_type: 'game', 'dlc', 'deposit'
  order_type TEXT NOT NULL CHECK (order_type IN ('game', 'dlc', 'deposit')),
  order_id TEXT,                                -- game_id / dlc_appid / deposit_id
  order_amount NUMERIC(12,2) NOT NULL,
  discount_amount NUMERIC(12,2) NOT NULL,
  used_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dcr_code_id ON public.discount_code_redemptions(code_id);
CREATE INDEX IF NOT EXISTS idx_dcr_user_id ON public.discount_code_redemptions(user_id);

ALTER TABLE public.discount_code_redemptions ENABLE ROW LEVEL SECURITY;

-- User đọc được redemption của chính mình
DROP POLICY IF EXISTS "Users read own redemptions" ON public.discount_code_redemptions;
CREATE POLICY "Users read own redemptions"
  ON public.discount_code_redemptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
