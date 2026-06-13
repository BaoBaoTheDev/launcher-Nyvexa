-- Mở rộng giftcode cho checkout: sale code + CTV code áp dụng rộng hơn

ALTER TABLE public.giftcodes
  ADD COLUMN IF NOT EXISTS min_product_price INTEGER,
  ADD COLUMN IF NOT EXISTS max_discount_amount INTEGER;

COMMENT ON COLUMN public.giftcodes.min_product_price IS 'Giá sản phẩm tối thiểu để áp dụng mã sale';
COMMENT ON COLUMN public.giftcodes.max_discount_amount IS 'Số tiền giảm tối đa cho mỗi sản phẩm khi áp mã sale';

ALTER TABLE public.giftcodes
  DROP CONSTRAINT IF EXISTS giftcodes_min_product_price_chk;
ALTER TABLE public.giftcodes
  ADD CONSTRAINT giftcodes_min_product_price_chk CHECK (
    min_product_price IS NULL OR min_product_price >= 0
  );

ALTER TABLE public.giftcodes
  DROP CONSTRAINT IF EXISTS giftcodes_max_discount_amount_chk;
ALTER TABLE public.giftcodes
  ADD CONSTRAINT giftcodes_max_discount_amount_chk CHECK (
    max_discount_amount IS NULL OR max_discount_amount >= 0
  );

COMMENT ON COLUMN public.giftcodes.gift_type IS 'legacy | money | game | ctv_discount | sale_discount';

ALTER TABLE public.giftcodes
  DROP CONSTRAINT IF EXISTS giftcodes_ctv_fields_chk;

ALTER TABLE public.giftcodes
  ADD CONSTRAINT giftcodes_ctv_fields_chk CHECK (
    CASE
      WHEN gift_type = 'ctv_discount' THEN
        owner_user_id IS NOT NULL
        AND discount_percent IS NOT NULL
        AND commission_percent IS NOT NULL
        AND amount = 0
      WHEN gift_type = 'sale_discount' THEN
        discount_percent IS NOT NULL
        AND amount = 0
      ELSE TRUE
    END
  );

CREATE INDEX IF NOT EXISTS idx_giftcodes_type_expiry
  ON public.giftcodes(gift_type, expires_at);
