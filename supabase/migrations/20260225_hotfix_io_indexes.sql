-- Hotfix: reduce Disk IO by indexing frequent filters/order conditions
-- Safe to run multiple times.

-- OTP/Auth
CREATE INDEX IF NOT EXISTS idx_custom_otps_email_code_created
  ON public.custom_otps (lower(email), code, created_at DESC);

-- Profiles
CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON public.profiles (role);

CREATE INDEX IF NOT EXISTS idx_profiles_username_lower
  ON public.profiles (lower(username));

-- Device session checks
CREATE INDEX IF NOT EXISTS idx_device_sessions_user_device_status_login
  ON public.device_sessions (user_id, device_id, status, login_at DESC);

CREATE INDEX IF NOT EXISTS idx_device_sessions_user_status
  ON public.device_sessions (user_id, status);

-- Games / Store
CREATE INDEX IF NOT EXISTS idx_games_created_at_desc
  ON public.games (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_store_assets_position
  ON public.store_assets (position);

-- User ownership
CREATE INDEX IF NOT EXISTS idx_user_games_user_id
  ON public.user_games (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_games_user_game
  ON public.user_games (user_id, game_id);

-- DLC ownership
CREATE INDEX IF NOT EXISTS idx_owned_dlcs_user_base_dlc
  ON public.owned_dlcs (user_id, base_appid, dlc_appid);

-- Wallet / deposits
CREATE INDEX IF NOT EXISTS idx_deposits_user_status_created
  ON public.deposits (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deposits_user_created
  ON public.deposits (user_id, created_at DESC);

-- Giftcodes
CREATE UNIQUE INDEX IF NOT EXISTS uq_giftcodes_code
  ON public.giftcodes (code);

CREATE INDEX IF NOT EXISTS idx_giftcodes_created
  ON public.giftcodes (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_giftcode_redemptions_giftcode
  ON public.giftcode_redemptions (giftcode_id);

CREATE INDEX IF NOT EXISTS idx_giftcode_redemptions_user_giftcode
  ON public.giftcode_redemptions (user_id, giftcode_id);

-- Bundles
DO $$
BEGIN
  IF to_regclass('public.bundle_basegames') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bundle_basegames_base_sort ON public.bundle_basegames (base_appid, sort_order)';
  END IF;

  IF to_regclass('public.bundle_items') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle_sort ON public.bundle_items (bundle_id, sort_order)';
  END IF;

  IF to_regclass('public.bundles') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bundles_active_created ON public.bundles (is_active, created_at DESC)';
  END IF;
END $$;

-- Market
CREATE INDEX IF NOT EXISTS idx_market_assets_active_updated
  ON public.market_assets (is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_ownership_user_asset
  ON public.market_ownership (user_id, asset_id);

-- Friends
CREATE INDEX IF NOT EXISTS idx_user_friends_user_created
  ON public.user_friends (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_friends_friend
  ON public.user_friends (friend_user_id);

-- Blog (shared patterns used by web/admin)
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_pinned_created
  ON public.blog_posts (published, pinned DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_blog_posts_slug_published
  ON public.blog_posts (slug, published);
