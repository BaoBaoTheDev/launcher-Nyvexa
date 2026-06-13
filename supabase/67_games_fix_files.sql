-- ─────────────────────────────────────────────────────────────────
-- Bổ sung cột cho bảng games để hỗ trợ "Kích hoạt" (auto-apply bypass)
--   fix_folder_name : tên folder game (đặt trong Steam\steamapps\common\)
--   fix_exe_name    : tên file .exe của game (để verify folder)
--   fix_dll_name    : tên file dll Steam API (mặc định steam_api64.dll, game cũ
--                     dùng steam_api.dll)
--   fix_zip_url     : URL tải file zip bypass
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS fix_folder_name TEXT,
  ADD COLUMN IF NOT EXISTS fix_exe_name TEXT,
  ADD COLUMN IF NOT EXISTS fix_dll_name TEXT,
  ADD COLUMN IF NOT EXISTS fix_zip_url TEXT;

COMMENT ON COLUMN public.games.fix_folder_name IS 'Tên folder game trong Steam\steamapps\common\<...>';
COMMENT ON COLUMN public.games.fix_exe_name IS 'Tên file exe game (vd: GTA5.exe) — dùng để verify folder';
COMMENT ON COLUMN public.games.fix_dll_name IS 'Tên file Steam API DLL (mặc định steam_api64.dll, game cũ 32-bit dùng steam_api.dll)';
COMMENT ON COLUMN public.games.fix_zip_url IS 'URL tải file zip bypass (sẽ được tải, giải nén, ẩn rồi merge vào folder game)';
