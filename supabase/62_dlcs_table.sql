-- ─────────────────────────────────────────────────────────────────
-- Bảng dlcs: lưu thông tin DLC riêng để giảm thời gian load
-- (tránh filter base_appid trên bảng games có hàng nghìn rows)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dlcs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appid TEXT NOT NULL UNIQUE,
  base_appid TEXT NOT NULL,
  name TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  original_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  header_image TEXT,
  custom_image TEXT,
  short_description TEXT,
  sale_end_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index trên base_appid để query nhanh "tất cả DLC của 1 game"
CREATE INDEX IF NOT EXISTS idx_dlcs_base_appid ON public.dlcs(base_appid);

-- Trigger tự động update updated_at
CREATE OR REPLACE FUNCTION public.update_dlcs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dlcs_updated_at ON public.dlcs;
CREATE TRIGGER dlcs_updated_at
  BEFORE UPDATE ON public.dlcs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_dlcs_updated_at();

-- ─── RLS Policies ────────────────────────────────────────────────

ALTER TABLE public.dlcs ENABLE ROW LEVEL SECURITY;

-- Mọi user đăng nhập đều đọc được DLC
DROP POLICY IF EXISTS "Anyone can read dlcs" ON public.dlcs;
CREATE POLICY "Anyone can read dlcs"
  ON public.dlcs FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated user có thể INSERT (để launcher tự động lưu DLC từ Steam)
DROP POLICY IF EXISTS "Authenticated can insert dlcs" ON public.dlcs;
CREATE POLICY "Authenticated can insert dlcs"
  ON public.dlcs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated user có thể UPDATE (để launcher tự động update name/image,
-- và để upsert hoạt động). Nhưng giá chỉ admin được sửa - sẽ enforce ở app layer.
DROP POLICY IF EXISTS "Authenticated can update dlcs" ON public.dlcs;
CREATE POLICY "Authenticated can update dlcs"
  ON public.dlcs FOR UPDATE
  TO authenticated
  USING (true);

-- Chỉ admin được xóa
DROP POLICY IF EXISTS "Admin can delete dlcs" ON public.dlcs;
CREATE POLICY "Admin can delete dlcs"
  ON public.dlcs FOR DELETE
  TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- ─── Migration: chuyển DLC hiện có từ bảng games sang bảng dlcs ─────
-- (chạy một lần — nếu đã chạy rồi thì sẽ no-op vì games đã không còn DLC)

-- Copy tất cả game có base_appid (tức là DLC) sang bảng dlcs
INSERT INTO public.dlcs (appid, base_appid, name, price, original_price, header_image, custom_image, short_description, sale_end_at)
SELECT
  appid,
  base_appid,
  name,
  price,
  COALESCE(original_price, 0),
  header_image,
  custom_image,
  short_description,
  sale_end_at
FROM public.games
WHERE base_appid IS NOT NULL AND base_appid != ''
ON CONFLICT (appid) DO NOTHING;

-- Xóa DLC khỏi bảng games sau khi copy (chỉ giữ basegame trong games)
DELETE FROM public.games WHERE base_appid IS NOT NULL AND base_appid != '';

-- ─────────────────────────────────────────────────────────────────
-- Bảng owned_dlcs: lưu DLC mà user đã sở hữu
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.owned_dlcs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  base_appid TEXT NOT NULL,
  dlc_appid TEXT NOT NULL,
  manifest_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS owned_dlcs_user_base_dlc_uniq
  ON public.owned_dlcs (user_id, base_appid, dlc_appid);

CREATE INDEX IF NOT EXISTS owned_dlcs_user_base_idx
  ON public.owned_dlcs (user_id, base_appid);

CREATE INDEX IF NOT EXISTS owned_dlcs_user_base_manifest_idx
  ON public.owned_dlcs (user_id, base_appid, manifest_id);

ALTER TABLE public.owned_dlcs ENABLE ROW LEVEL SECURITY;

-- Users chỉ đọc được DLC của chính mình
DROP POLICY IF EXISTS "Users read own owned_dlcs" ON public.owned_dlcs;
CREATE POLICY "Users read own owned_dlcs"
  ON public.owned_dlcs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users không trực tiếp insert/update — chỉ qua service_key (admin)
-- nên không tạo policy insert/update cho user thường
