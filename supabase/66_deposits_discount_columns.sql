-- ─────────────────────────────────────────────────────────────────
-- Bổ sung cột cho deposits để hỗ trợ mã giảm giá khi nạp tiền
--   amount         = số tiền user nhận vào ví (giá trị "gói nạp")
--   pay_amount     = số tiền user thực sự phải trả (sau khi áp mã)
--   discount_code  = mã code (uppercase) đã áp dụng (NULL = không có)
--   discount_code_id = id của discount_code (để FK)
--   discount_amount  = số tiền được giảm (amount - pay_amount)
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE public.deposits
  ADD COLUMN IF NOT EXISTS pay_amount BIGINT,
  ADD COLUMN IF NOT EXISTS discount_code TEXT,
  ADD COLUMN IF NOT EXISTS discount_code_id UUID REFERENCES public.discount_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_amount BIGINT NOT NULL DEFAULT 0;

-- Backfill pay_amount = amount cho các record cũ
UPDATE public.deposits SET pay_amount = amount WHERE pay_amount IS NULL;

ALTER TABLE public.deposits ALTER COLUMN pay_amount SET NOT NULL;
ALTER TABLE public.deposits ALTER COLUMN pay_amount SET DEFAULT 0;

-- Constraint hợp lệ
ALTER TABLE public.deposits
  DROP CONSTRAINT IF EXISTS deposits_pay_amount_chk;
ALTER TABLE public.deposits
  ADD CONSTRAINT deposits_pay_amount_chk CHECK (pay_amount >= 0 AND pay_amount <= amount);

-- Index để webhook tra cứu nhanh theo order_code (đã có sẵn)
CREATE INDEX IF NOT EXISTS idx_deposits_discount_code_id
  ON public.deposits(discount_code_id) WHERE discount_code_id IS NOT NULL;

COMMENT ON COLUMN public.deposits.amount IS 'Số tiền user nhận vào ví (giá trị gói nạp)';
COMMENT ON COLUMN public.deposits.pay_amount IS 'Số tiền user thực sự cần chuyển khoản (sau giảm giá)';
COMMENT ON COLUMN public.deposits.discount_code IS 'Mã giảm giá đã áp dụng (uppercase)';
COMMENT ON COLUMN public.deposits.discount_code_id IS 'ID của discount_code đã dùng';
COMMENT ON COLUMN public.deposits.discount_amount IS 'Số tiền được giảm (amount - pay_amount)';
