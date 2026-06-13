-- ============================================================
-- NestG Launcher – Setup Script cho Database Mới
-- Chạy toàn bộ file này 1 lần trong Supabase SQL Editor
-- ============================================================

-- ── 01: Bảng profiles ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  username TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user',
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  ctv_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  avatar_url TEXT,
  frame_url TEXT,
  background_url TEXT,
  banner_url TEXT,
  summary TEXT,
  background_fit_mode TEXT,
  background_anchor TEXT,
  banner_fit_mode TEXT,
  banner_anchor TEXT,
  is_banned BOOLEAN DEFAULT FALSE,
  steam_exception BOOLEAN DEFAULT FALSE,
  privacy_show_summary BOOLEAN DEFAULT TRUE,
  privacy_show_status BOOLEAN DEFAULT TRUE,
  privacy_show_owned_games BOOLEAN DEFAULT TRUE,
  current_game_appid TEXT,
  current_game_name TEXT,
  current_game_started_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User can read own profile" ON public.profiles;
CREATE POLICY "User can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "User can update own profile" ON public.profiles;
CREATE POLICY "User can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "User can insert own profile" ON public.profiles;
CREATE POLICY "User can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Cho phép user đọc profile người khác (để hiển thị tên, avatar...)
DROP POLICY IF EXISTS "Authenticated can read all profiles" ON public.profiles;
CREATE POLICY "Authenticated can read all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- ── 02: Trigger tạo profile khi đăng ký ─────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'username', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 03: Hàm tiện ích ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    SELECT role = 'admin'
    FROM public.profiles
    WHERE id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 04: Bảng games ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appid TEXT NOT NULL UNIQUE,
  name TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  original_price NUMERIC(12,2),
  short_description TEXT,
  header_image TEXT,
  release_date TEXT,
  developer TEXT,
  publisher TEXT,
  genres TEXT,
  drm TEXT DEFAULT 'Steam',
  purchase_count INTEGER DEFAULT 0,
  recommendations_count INTEGER DEFAULT 0,
  sale_end_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read games" ON public.games;
CREATE POLICY "Anyone can read games"
  ON public.games FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin can insert games" ON public.games;
CREATE POLICY "Admin can insert games"
  ON public.games FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin can update games" ON public.games;
CREATE POLICY "Admin can update games"
  ON public.games FOR UPDATE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can delete games" ON public.games;
CREATE POLICY "Admin can delete games"
  ON public.games FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ── 05: Bảng user_games (thư viện game đã mua) ───────────────
CREATE TABLE IF NOT EXISTS public.user_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  purchased_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_user_games_user ON public.user_games(user_id);
CREATE INDEX IF NOT EXISTS idx_user_games_game ON public.user_games(game_id);

ALTER TABLE public.user_games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User can read own user_games" ON public.user_games;
CREATE POLICY "User can read own user_games"
  ON public.user_games FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "User can insert own user_games" ON public.user_games;
CREATE POLICY "User can insert own user_games"
  ON public.user_games FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admin can manage user_games" ON public.user_games;
CREATE POLICY "Admin can manage user_games"
  ON public.user_games FOR ALL
  TO authenticated
  USING (public.is_admin());

-- Trigger cập nhật purchase_count
CREATE OR REPLACE FUNCTION public.update_game_purchase_count()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.games SET purchase_count = purchase_count + 1 WHERE id = NEW.game_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.games SET purchase_count = GREATEST(0, purchase_count - 1) WHERE id = OLD.game_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_user_game_purchased ON public.user_games;
CREATE TRIGGER on_user_game_purchased
  AFTER INSERT OR DELETE ON public.user_games
  FOR EACH ROW EXECUTE FUNCTION public.update_game_purchase_count();

-- ── 06: Bảng store_assets (carousel & banner) ────────────────
CREATE TABLE IF NOT EXISTS public.store_assets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL,       -- 'carousel' | 'banner'
  image_url TEXT NOT NULL,
  link_url TEXT,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.store_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view store assets" ON public.store_assets;
CREATE POLICY "Anyone can view store assets"
  ON public.store_assets FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin can manage store assets" ON public.store_assets;
CREATE POLICY "Admin can manage store assets"
  ON public.store_assets FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── Xong! ─────────────────────────────────────────────────────
-- Bảng đã tạo: profiles, games, user_games, store_assets
-- Hàm: handle_new_user(), is_admin(), update_game_purchase_count()

-- ── Bổ sung cột nếu chưa có (chạy an toàn nhiều lần) ────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS balance NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ctv_balance NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS frame_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS background_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS original_price NUMERIC(12,2);
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS drm TEXT DEFAULT 'Steam';
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS release_date TEXT;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS developer TEXT;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS publisher TEXT;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS genres TEXT;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS purchase_count INTEGER DEFAULT 0;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS sale_end_at TIMESTAMPTZ;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS sale_start_at TIMESTAMPTZ;
-- Ảnh thay thế (custom) + icon/banner thư viện lưu vào DB
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS custom_image TEXT;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS library_icon_url TEXT;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS library_hero_url TEXT;

-- Sync email từ auth.users sang profiles (một lần)
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND (p.email IS NULL OR p.email = '');
