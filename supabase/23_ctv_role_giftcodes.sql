-- Hỗ trợ role CTV và giftcode giảm giá theo game cho CTV
-- Yêu cầu: game áp dụng giftcode CTV không được ở trạng thái sale (price < original_price)

-- 1) Mở rộng role profile
COMMENT ON COLUMN public.profiles.role IS 'user | admin | ctv';

-- 2) Mở rộng bảng giftcodes để hỗ trợ mã CTV
ALTER TABLE public.giftcodes
  ADD COLUMN IF NOT EXISTS gift_type TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS discount_percent INTEGER,
  ADD COLUMN IF NOT EXISTS created_by_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.giftcodes.gift_type IS 'legacy | money | game | ctv_discount';
COMMENT ON COLUMN public.giftcodes.owner_user_id IS 'User ID của CTV sở hữu mã giảm giá';
COMMENT ON COLUMN public.giftcodes.discount_percent IS 'Phần trăm giảm giá của mã CTV (1..99)';
COMMENT ON COLUMN public.giftcodes.created_by_admin_id IS 'Admin đã tạo/cập nhật mã';

-- 3) Ràng buộc dữ liệu cho gift_type mới
ALTER TABLE public.giftcodes
  DROP CONSTRAINT IF EXISTS giftcodes_discount_percent_chk;

ALTER TABLE public.giftcodes
  ADD CONSTRAINT giftcodes_discount_percent_chk CHECK (
    discount_percent IS NULL OR (discount_percent >= 1 AND discount_percent <= 99)
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
        AND amount = 0
      ELSE TRUE
    END
  );

-- 4) Chỉ cho phép 1 mã CTV / mỗi user CTV
CREATE UNIQUE INDEX IF NOT EXISTS uq_giftcodes_ctv_owner_active
  ON public.giftcodes(owner_user_id)
  WHERE gift_type = 'ctv_discount';

-- 5) Index hỗ trợ truy vấn và áp mã nhanh
CREATE INDEX IF NOT EXISTS idx_giftcodes_type_code
  ON public.giftcodes(gift_type, code);

CREATE INDEX IF NOT EXISTS idx_giftcodes_owner_type
  ON public.giftcodes(owner_user_id, gift_type);
