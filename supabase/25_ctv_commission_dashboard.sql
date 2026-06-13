-- Tách % giảm cho user và % hoa hồng cho CTV
-- Thêm bảng log hoa hồng và lịch sử chi trả để phục vụ dashboard CTV

ALTER TABLE public.giftcodes
  ADD COLUMN IF NOT EXISTS commission_percent INTEGER;

COMMENT ON COLUMN public.giftcodes.commission_percent IS 'Phần trăm hoa hồng CTV cho mỗi đơn mua dùng mã (0..99)';

ALTER TABLE public.giftcodes
  DROP CONSTRAINT IF EXISTS giftcodes_commission_percent_chk;

ALTER TABLE public.giftcodes
  ADD CONSTRAINT giftcodes_commission_percent_chk CHECK (
    commission_percent IS NULL OR (commission_percent >= 0 AND commission_percent <= 99)
  );

ALTER TABLE public.giftcodes
  DROP CONSTRAINT IF EXISTS giftcodes_ctv_fields_chk;

ALTER TABLE public.giftcodes
  ADD CONSTRAINT giftcodes_ctv_fields_chk CHECK (
    CASE
      WHEN gift_type = 'ctv_discount' THEN
        owner_user_id IS NOT NULL
        AND game_id IS NOT NULL
        AND discount_percent IS NOT NULL
        AND commission_percent IS NOT NULL
        AND amount = 0
      ELSE TRUE
    END
  );

UPDATE public.giftcodes
SET commission_percent = COALESCE(commission_percent, discount_percent, 0)
WHERE gift_type = 'ctv_discount';

CREATE TABLE IF NOT EXISTS public.ctv_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ctv_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  buyer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  giftcode_id UUID REFERENCES public.giftcodes(id) ON DELETE SET NULL,
  game_id UUID REFERENCES public.games(id) ON DELETE SET NULL,
  order_amount INTEGER NOT NULL DEFAULT 0 CHECK (order_amount >= 0),
  discount_percent INTEGER NOT NULL CHECK (discount_percent >= 0 AND discount_percent <= 99),
  commission_percent INTEGER NOT NULL CHECK (commission_percent >= 0 AND commission_percent <= 99),
  discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  commission_amount INTEGER NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ctv_commissions_ctv_created
  ON public.ctv_commissions(ctv_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ctv_commissions_giftcode
  ON public.ctv_commissions(giftcode_id);

CREATE TABLE IF NOT EXISTS public.ctv_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ctv_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  paid_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ctv_payouts_ctv_created
  ON public.ctv_payouts(ctv_user_id, created_at DESC);

ALTER TABLE public.ctv_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ctv_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ctv_commissions_select_own ON public.ctv_commissions;
CREATE POLICY ctv_commissions_select_own ON public.ctv_commissions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = ctv_user_id OR is_admin());

DROP POLICY IF EXISTS ctv_commissions_insert_admin ON public.ctv_commissions;
CREATE POLICY ctv_commissions_insert_admin ON public.ctv_commissions
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS ctv_payouts_select_own ON public.ctv_payouts;
CREATE POLICY ctv_payouts_select_own ON public.ctv_payouts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = ctv_user_id OR is_admin());

DROP POLICY IF EXISTS ctv_payouts_insert_admin ON public.ctv_payouts;
CREATE POLICY ctv_payouts_insert_admin ON public.ctv_payouts
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());
