-- ─────────────────────────────────────────────────────────────────
-- Bảng avatar_presets: admin quản lý danh sách avatar cho user chọn
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.avatar_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,         -- tên avatar (lưu vào profiles.avatar_url)
  image_url TEXT NOT NULL,           -- public URL của ảnh trong Supabase Storage bucket "avatars"
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_avatar_presets_active ON public.avatar_presets(is_active, sort_order);

ALTER TABLE public.avatar_presets ENABLE ROW LEVEL SECURITY;

-- Mọi user đọc được
DROP POLICY IF EXISTS "Anyone can read avatar_presets" ON public.avatar_presets;
CREATE POLICY "Anyone can read avatar_presets"
  ON public.avatar_presets FOR SELECT TO authenticated USING (true);

-- Admin CRUD qua service_key

COMMENT ON TABLE public.avatar_presets IS 'Danh sách avatar cố định do admin quản lý. User chọn 1, DB lưu tên (name) vào profiles.avatar_url.';
COMMENT ON COLUMN public.avatar_presets.name IS 'Tên duy nhất — được lưu vào profiles.avatar_url khi user chọn';
COMMENT ON COLUMN public.avatar_presets.image_url IS 'Public URL trong Supabase Storage bucket "avatars"';

-- ─────────────────────────────────────────────────────────────────
-- Bucket "avatars" cho admin upload ảnh
-- ─────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read
DROP POLICY IF EXISTS "Public read avatars" ON storage.objects;
CREATE POLICY "Public read avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Admin/Manager upload (qua service_role)
-- (service_role bypass RLS nên không cần policy)

