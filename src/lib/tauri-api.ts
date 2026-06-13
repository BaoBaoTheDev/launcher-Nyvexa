import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

// ── Domain types ─────────────────────────────────────────────────────────────

export interface GameItem {
  id?: string | number;
  appid?: string | number;
  name?: string;
  price?: number | string;
  original_price?: number | string;
  genres?: string;
  steam_tags?: string;
  drm?: string;
  release_date?: string;
  header_image?: string;
  custom_image?: string | null;
  library_icon_url?: string | null;
  library_hero_url?: string | null;
  developer?: string;
  publisher?: string;
  purchase_count?: number;
  developers?: string[];
  publishers?: string[];
  short_description?: string;
  sale_end_at?: string;
  // Game-fix activation fields (admin-set)
  fix_folder_name?: string | null;
  fix_exe_name?: string | null;
  fix_dll_name?: string | null;
  fix_zip_url?: string | null;
  [key: string]: unknown;
}

export interface StoreAsset {
  id?: string | number;
  type: "carousel" | "banner";
  image_url: string;
  link_url?: string;
  [key: string]: unknown;
}

export interface SteamAppDetails {
  name?: string;
  header_image?: string;
  background?: string;
  short_description?: string;
  developers?: string[];
  publishers?: string[];
  release_date?: { date?: string; coming_soon?: boolean };
  dlc?: (string | number)[];
  [key: string]: unknown;
}

export interface DlcItem {
  id?: string | number;
  appid?: string | number;
  base_appid?: string | number;
  name?: string;
  price?: number | string;
  original_price?: number | string;
  header_image?: string | null;
  custom_image?: string | null;
  is_free?: boolean;
}

export interface HubcapKey {
  id: string;
  label: string;
  api_key_preview?: string;
  is_active: boolean;
  is_locked: boolean;
  locked_at?: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface HubcapKeyStats {
  alive: boolean;
  status?: number;
  expires_at?: string | null;
  daily_limit?: number | null;
  used_today?: number | null;
  remaining?: number | null;
  raw?: unknown;
  reason?: string;
}

export interface MovieHistoryItem {
  slug?: string;
  movie_name?: string;
  origin_name?: string;
  poster_url?: string;
  banner_url?: string;
  year?: string | number;
  current_episode_slug?: string;
  current_time_sec?: number;
  [key: string]: unknown;
}

export interface MovieProgress {
  episode_slug?: string;
  progress_sec?: number;
  is_completed?: boolean;
  [key: string]: unknown;
}

export interface UserProfile {
  id: string;
  email?: string;
  username?: string;
  display_name?: string;
  balance?: number;
  ctv_balance?: number;
  role?: string;
  is_banned?: boolean;
  steam_exception?: boolean;
  created_at?: string;
  [key: string]: unknown;
}

export interface AdminAnalytics {
  success: boolean;
  data?: {
    total_users: number;
    banned_users: number;
    total_games: number;
    recent_purchases: unknown[];
    top_games: { id: string; name: string; appid: string; purchase_count: number }[];
  };
}

// ── IPC ──────────────────────────────────────────────────────────────────────

export interface SignInResult {
  success: boolean;
  message?: string;
  banned?: boolean;
  user?: Record<string, unknown>;
  deviceId?: string;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/** Channel → Tauri command name mapping. Kept for reference and future use. */
export const invokeMap: Record<string, string> = {
  "get-supabase-config": "get_supabase_config",
  "supabase:signIn": "supabase_sign_in",
  "supabase:signUp": "supabase_sign_up",
  "supabase:signOut": "supabase_sign_out",
  "supabase:sendOTP": "supabase_send_otp",
  "supabase:verifyOTP": "supabase_verify_otp",
  "supabase:getSession": "supabase_get_session",
  "supabase:getProfile": "supabase_get_profile",
  "supabase:getProfileSlim": "supabase_get_profile_slim",
  "supabase:getSessionLite": "supabase_get_session_lite",
  "supabase:updateProfile": "supabase_update_profile",
  "supabase:updatePasswordAdmin": "supabase_update_password_admin",
  "supabase:verifyPassword": "supabase_verify_password",
  "supabase:verifyDeviceSession": "supabase_verify_device_session",
  "supabase:completeDeviceVerificationAndSignIn":
    "supabase_complete_device_verification_and_sign_in",
  "supabase:generateTotpSecret": "supabase_generate_totp_secret",
  "supabase:enableTotp2fa": "supabase_enable_totp2fa",
  "supabase:disableTotp2fa": "supabase_disable_totp2fa",
  "supabase:getLocalProfileSnapshot": "supabase_get_local_profile_snapshot",
  "supabase:setLocalProfileSnapshot": "supabase_set_local_profile_snapshot",
  "app:getVersion": "app_get_version",
  "app:openMainWindow": "app_open_main_window",
  "app:postLoginSteamPrep": "app_post_login_steam_prep",
  "app:confirmClose": "app_confirm_close",
  "app:minimizeToTray": "app_minimize_to_tray",
  "app:cancelClose": "app_cancel_close",
  "app:getLaunchAtStartup": "app_get_launch_at_startup",
  "app:setLaunchAtStartup": "app_set_launch_at_startup",
  "app:openExternal": "app_open_external",
  // Store & Library
  "games:list": "games_list",
  "games:listReviewSummaries": "games_list_review_summaries",
  "userGames:listOwned": "user_games_list_owned",
  "admin:listStoreAssets": "admin_list_store_assets",
  "steam:getAppDetails": "steam_get_app_details",
  "steam:play": "steam_play",
  "steam:preload": "steam_preload",
  "steam:getPreloadMetadata": "steam_get_preload_metadata",
  "dlc:listOwnedForBasegame": "dlc_list_owned_for_basegame",
  "dlc:purchase": "dlc_purchase",
  "community:listMovieHistory": "community_list_movie_history",
  "community:getMovieProgress": "community_get_movie_progress",
};

export const tauriAPI = {
  getSupabaseConfig: (): Promise<SupabaseConfig> =>
    invoke<SupabaseConfig>("get_supabase_config"),

  app: {
    getVersion: (): Promise<string> => invoke<string>("app_get_version"),
    openMainWindow: (): Promise<{ success: boolean; opened?: boolean }> =>
      invoke("app_open_main_window"),
    postLoginSteamPrep: (): Promise<{ success: boolean; skipped?: boolean }> =>
      invoke("app_post_login_steam_prep"),
    confirmClose: (shouldClose: boolean) =>
      invoke("app_confirm_close", { shouldClose }),
    minimizeToTray: () => invoke("app_minimize_to_tray"),
    cancelClose: () => invoke("app_cancel_close"),
    getLaunchAtStartup: () => invoke("app_get_launch_at_startup"),
    setLaunchAtStartup: (enabled: boolean) =>
      invoke("app_set_launch_at_startup", { enabled }),
    openExternal: (url: string) => invoke("app_open_external", { url }),
    checkUpdate: (): Promise<{
      success: boolean;
      reason?: string;
      current_version?: string;
      latest_version?: string;
      min_version?: string;
      download_url?: string;
      update_available?: boolean;
      update_required?: boolean;
    }> => invoke("app_check_update"),
    downloadAndInstallUpdate: (url: string): Promise<{ success: boolean; launched?: boolean }> =>
      invoke("app_download_and_install_update", { url }),
    onCloseRequested: (_callback: () => void) => () => {},
  },

  // ── Store / Library (calls forwarded to Supabase via Rust) ──────────────
  games: {
    list: (): Promise<{ data?: GameItem[]; error?: string }> =>
      invoke("games_list"),
    listReviewSummaries: (args: { gameIds: (string | number)[] }): Promise<{ success: boolean; data?: Record<string, { up: number; down: number; total: number }> }> =>
      invoke("games_list_review_summaries", args),
    debugInfo: (): Promise<{ has_token: boolean; user_id?: string; supabase_url?: string }> =>
      invoke("store_debug_info"),
    setLibraryAssets: (appid: string | number, iconUrl?: string, heroUrl?: string): Promise<{ success: boolean }> =>
      invoke("games_set_library_assets", { appid: String(appid), iconUrl, heroUrl }),
  },

  reviews: {
    submit: (args: { gameId: string; recommended: boolean; content?: string }): Promise<{ success: boolean }> =>
      invoke("review_submit", { gameId: args.gameId, recommended: args.recommended, content: args.content }),
    my: (gameId: string): Promise<{ success: boolean; data?: { id: string; recommended: boolean; content?: string; created_at?: string; updated_at?: string } | null }> =>
      invoke("review_my", { gameId }),
    list: (gameId: string): Promise<{ success: boolean; data?: Array<{ id: string; user_id: string; recommended: boolean; content?: string; created_at?: string; profiles?: { display_name?: string; username?: string; avatar_url?: string } }> }> =>
      invoke("review_list", { gameId }),
  },

  userGames: {
    listOwned: (): Promise<GameItem[]> => invoke("user_games_list_owned"),
    has: (gameId: string): Promise<boolean> => invoke("user_games_has", { gameId }),
    purchase: (gameId: string, discountCode?: string): Promise<{ success: boolean; game_name: string; price: number; original_price: number; discount?: { code: string; discount_amount: number; original_amount: number; final_amount: number } | null; new_balance: number }> =>
      invoke("purchase_game", { gameId, discountCode }),
  },

  referral: {
    getMyCode: (): Promise<{ code: string | null; id?: string; total_uses: number; total_earned: number; discount_percent: number; tier: number; username: string | null; referral_balance: number }> =>
      invoke("referral_get_my_code"),
    createCode: (): Promise<{ success: boolean; code: string }> =>
      invoke("referral_create_code"),
    validateCode: (code: string): Promise<{ valid: boolean; code: string; referral_code_id: string; owner_user_id: string; discount_percent: number }> =>
      invoke("referral_validate_code", { code }),
    recordUse: (args: { referralCodeId: string; gameId: string; gameName: string; orderAmount: number; finalAmount: number }): Promise<{ success: boolean; discount_amount?: number; discount_percent?: number; skipped?: boolean }> =>
      invoke("referral_record_use", { referralCodeId: args.referralCodeId, gameId: args.gameId, gameName: args.gameName, orderAmount: args.orderAmount, finalAmount: args.finalAmount }),
    adminList: (): Promise<{ success: boolean; data: Array<{ id: string; code: string; total_uses: number; total_earned: number; user_id: string; created_at: string; username?: string }> }> =>
      invoke("admin_referral_list"),
    adminUses: (referralCodeId: string): Promise<{ success: boolean; data: Array<{ id: string; buyer_user_id: string; game_name: string; order_amount: number; discount_percent: number; discount_amount: number; commission_amount: number; created_at: string; username?: string; display_name?: string }> }> =>
      invoke("admin_referral_uses", { referralCodeId }),
    adminResetEarned: (referralCodeId: string): Promise<{ success: boolean }> =>
      invoke("admin_referral_reset_earned", { referralCodeId }),
  },

  admin: {
    listStoreAssets: (): Promise<StoreAsset[]> =>
      invoke("admin_list_store_assets"),
  },

  steam: {
    getAppDetails: (appId: string | number): Promise<SteamAppDetails | null> =>
      invoke("steam_get_app_details", { appId: String(appId) }),
    play: (args: {
      appId: string | number;
      dlcAppIds?: string[];
    }): Promise<{ success: boolean; action?: string; code?: string; message?: string; dlc?: { requested: string[]; notOwned: string[]; missingOnManifest: string[] } }> =>
      invoke("steam_play", { appId: String(args.appId), dlcAppIds: args.dlcAppIds ?? [] }),
    preload: (args: { appId: string | number }): Promise<{ success: boolean; message?: string }> =>
      invoke("steam_preload", { appId: String(args.appId) }),
    getPreloadMetadata: (appId: string | number): Promise<{ success: boolean; isPreloadOnly?: boolean; depotId?: string; message?: string } | null> =>
      invoke("steam_get_preload_metadata", { appId: String(appId) }),
    getAppIcon: (appId: string | number): Promise<{ appid: string; icon_hash: string; icon_url: string }> =>
      invoke("steam_get_app_icon", { appid: String(appId) }),
    getAppsBatch: (appIds: string[]): Promise<{ success: boolean; apps: Array<{ appid: string; name: string; icon_url: string; header_image: string }> }> =>
      invoke("steam_get_apps_batch", { appids: appIds }),
  },

  steamIntegration: {
    getPath: (): Promise<{ success: boolean; steam_path?: string }> =>
      invoke("steam_get_path"),
    installDll: (steamPath: string): Promise<{ success: boolean; dll_folder?: string; installed?: string[]; missing?: string[] }> =>
      invoke("steam_install_dll", { steamPath }),
    markDllHidden: (steamPath: string): Promise<{ success: boolean }> =>
      invoke("steam_mark_dll_hidden", { steamPath }),
    removeDll: (steamPath: string): Promise<{ success: boolean }> =>
      invoke("steam_remove_dll", { steamPath }),
    checkFiles: (steamPath: string, appId: string): Promise<{ ready: boolean; static_files_ready: boolean; lua_ready: boolean; present: string[]; missing: string[] }> =>
      invoke("steam_check_files", { steamPath, appId }),
    checkFilesWithDlc: (steamPath: string, appId: string, dlcAppids: string[]): Promise<{ ready: boolean; static_files_ready: boolean; lua_ready: boolean; dlc_lua_ready: boolean; present: string[]; missing: string[] }> =>
      invoke("steam_check_files_with_dlc", { steamPath, appId, dlcAppids }),
    ensureStpluginFolder: (steamPath: string): Promise<{ success: boolean; existed: boolean; stplugin_path?: string }> =>
      invoke("steam_ensure_stplugin_folder", { steamPath }),
    listLuaFiles: (steamPath: string): Promise<{ success: boolean; appids: string[] }> =>
      invoke("steam_list_lua_files", { steamPath }),
    removeLuaFile: (steamPath: string, appid: string): Promise<{ success: boolean }> =>
      invoke("steam_remove_lua_file", { steamPath, appid }),
    downloadLua: (steamPath: string, appid: string): Promise<{ success: boolean; reason?: string; status?: number }> =>
      invoke("steam_download_lua", { steamPath, appid }),
    downloadDlcLua: (steamPath: string, appId: string, dlcAppid: string): Promise<{ success: boolean; reason?: string; status?: number; dlc_appid?: string }> =>
      invoke("steam_download_dlc_lua", { steamPath, appId, dlcAppid }),
    forceKill: (): Promise<{ success: boolean; killed?: string[] }> =>
      invoke("steam_force_kill"),
    launch: (steamPath: string): Promise<{ success: boolean }> =>
      invoke("steam_launch", { steamPath }),
    restart: (steamPath: string): Promise<{ success: boolean }> =>
      invoke("steam_restart", { steamPath }),
    runGame: (appId: string): Promise<{ success: boolean; url?: string }> =>
      invoke("steam_run_game", { appId }),
    playWorkflow: (args: {
      appId: string;
      dlcAppIds?: string[];
      ownedAppids: string[];
    }): Promise<{ success: boolean; step?: string; detail?: unknown; missing_files?: string[] }> =>
      invoke("steam_play_workflow", {
        appId: args.appId,
        dlcAppIds: args.dlcAppIds ?? [],
        ownedAppids: args.ownedAppids,
      }),
    manifestFix: (): Promise<{ success: boolean; updated?: boolean; reason?: string; message?: string; steam_path?: string }> =>
      invoke("steam_manifest_fix"),
  },

  dlc: {
    listForBasegame: (appId: string | number): Promise<{ success: boolean; data: DlcItem[]; error?: string }> =>
      invoke("dlc_list_for_basegame", { appId: String(appId) }),
    listOwnedForBasegame: (appId: string | number): Promise<{ data?: string[] }> =>
      invoke("dlc_list_owned_for_basegame", { appId: String(appId) }),
    batchUpsert: (args: {
      baseAppid: string;
      dlcs: Array<{ appid: string; name: string; header_image: string }>;
    }): Promise<{ success: boolean; processed: number }> =>
      invoke("dlc_batch_upsert", { baseAppid: args.baseAppid, dlcs: args.dlcs }),
    getOrFetch: (args: {
      baseAppid: string;
      dlcAppid: string;
    }): Promise<{ success: boolean; source: "db" | "steam"; data: DlcItem }> =>
      invoke("dlc_get_or_fetch", { baseAppid: args.baseAppid, dlcAppid: args.dlcAppid }),
    purchase: (args: {
      baseAppId: string;
      dlcAppId: string;
      giftCode?: string;
      discountCode?: string;
    }): Promise<{ success: boolean; message?: string; price?: number; original_price?: number; discount?: { code: string; discount_amount: number; original_amount: number; final_amount: number } | null; new_balance?: number; dlc_name?: string }> =>
      invoke("dlc_purchase", args),
  },

  community: {
    listMovieHistory: (): Promise<{ data?: MovieHistoryItem[] }> =>
      invoke("community_list_movie_history"),
    getMovieProgress: (args: { slug: string }): Promise<{ data?: MovieProgress[] }> =>
      invoke("community_get_movie_progress", args),
  },

  // ── Admin ─────────────────────────────────────────────────────────────────
  adminApi: {
    debugMyRole: (): Promise<{ user_id: string; db_result: unknown[] }> => invoke("admin_debug_my_role"),
    fetchSteamGame: (appid: string): Promise<{ name: string; header_image: string; drm: string; drm_all?: string; drm_list?: string[]; price: number; steam_price_vnd?: number; is_free: boolean; genres?: string }> =>
      invoke("admin_fetch_steam_game", { appid }),
    fetchSteamFull: (appid: string): Promise<Record<string, unknown>> =>
      invoke("fetch_steam_app_full", { appid }),
    listUsers: (): Promise<UserProfile[]> => invoke("admin_list_users"),
    listUserGames: (userId: string): Promise<GameItem[]> => invoke("admin_list_user_games", { userId }),
    revokeGame: (userId: string, gameId: string): Promise<{ success: boolean }> => invoke("admin_revoke_game", { userId, gameId }),
    grantGame: (userId: string, gameId: string): Promise<{ success: boolean }> => invoke("admin_grant_game", { userId, gameId }),
    giftBalance: (userId: string, amount: number): Promise<{ success: boolean; new_balance?: number }> => invoke("admin_gift_balance", { userId, amount }),
    setBalance: (userId: string, balance: number): Promise<{ success: boolean }> => invoke("admin_set_balance", { userId, balance }),
    toggleBan: (userId: string, isBanned: boolean, reason?: string, durationHours?: number): Promise<{ success: boolean }> =>
      invoke("admin_toggle_ban", { userId, isBanned, reason, durationHours }),
    gamesList: (): Promise<GameItem[]> => invoke("admin_games_list"),
    gamesAdd: (game: Partial<GameItem>): Promise<{ success: boolean }> => invoke("admin_games_add", { game }),
    gamesUpdate: (id: string, patch: Partial<GameItem>): Promise<{ success: boolean }> => invoke("admin_games_update", { id, patch }),
    gamesDelete: (id: string): Promise<{ success: boolean }> => invoke("admin_games_delete", { id }),
    gamesReorder: (items: Array<{ id: string; sort_order: number }>): Promise<{ success: boolean; updated: number }> =>
      invoke("admin_games_reorder", { items }),
    balanceLogs: (args?: { limit?: number; offset?: number }): Promise<Array<Record<string, unknown>>> =>
      invoke("admin_balance_logs", { limit: args?.limit, offset: args?.offset }),
    dlcsList: (): Promise<DlcItem[]> => invoke("admin_dlcs_list"),
    dlcsUpdate: (id: string, patch: Partial<DlcItem>): Promise<{ success: boolean }> => invoke("admin_dlcs_update", { id, patch }),
    dlcsDelete: (id: string): Promise<{ success: boolean }> => invoke("admin_dlcs_delete", { id }),
    applySaleDlc: (dlcIds: string[], saleType: string, saleValue: number, saleStart?: string, saleEnd?: string): Promise<{ success: boolean; updated: number; errors: string[] }> =>
      invoke("admin_apply_sale_dlc", { dlcIds, saleType, saleValue, saleStart, saleEnd }),
    removeSaleDlc: (dlcIds: string[]): Promise<{ success: boolean; updated: number }> =>
      invoke("admin_remove_sale_dlc", { dlcIds }),
    rescanGenres: (onlyMissing?: boolean): Promise<{ success: boolean; updated: number; failed: number; skipped: number }> =>
      invoke("admin_rescan_genres", { onlyMissing }),
    storeAssetsList: (): Promise<StoreAsset[]> => invoke("admin_store_assets_list"),
    storeAssetsAdd: (asset: Partial<StoreAsset>): Promise<{ success: boolean }> => invoke("admin_store_assets_add", { asset }),
    storeAssetsDelete: (id: string): Promise<{ success: boolean }> => invoke("admin_store_assets_delete", { id }),
    getAnalytics: (): Promise<AdminAnalytics> => invoke("admin_get_analytics"),
    getAnalyticsV2: (): Promise<{ success: boolean; revenue_this_month: number; revenue_total: number; total_referral_earned: number; deposit_count_this_month: number }> =>
      invoke("admin_get_analytics_v2"),
    getAppSettings: (): Promise<{ success: boolean; settings: Record<string, string> }> => invoke("admin_get_app_settings"),
    saveAppSettings: (settings: Record<string, string>): Promise<{ success: boolean }> => invoke("admin_save_app_settings", { settings }),
    balanceLogsV2: (args?: { limit?: number; offset?: number; direction?: string; source?: string; username?: string }): Promise<{ success: boolean; data: Array<Record<string, unknown>> }> =>
      invoke("admin_balance_logs_v2", { limit: args?.limit, offset: args?.offset, direction: args?.direction ?? null, source: args?.source ?? null, username: args?.username ?? null }),
    balanceLogDetail: (logId: string): Promise<Record<string, unknown>> =>
      invoke("admin_balance_log_detail", { logId }),
    discountRedemptions: (codeId: string): Promise<{ success: boolean; data: Array<Record<string, unknown>> }> =>
      invoke("admin_discount_redemptions", { codeId }),
    grantGameToUser: (userId: string, gameId: string): Promise<{ success: boolean; skipped?: boolean }> =>
      invoke("admin_grant_game_to_user", { userId, gameId }),
    discordNotifyNewGame: (args: { gameName: string; appid: string; price: number; headerImage?: string }): Promise<{ success: boolean }> =>
      invoke("discord_notify_new_game", { gameName: args.gameName, appid: args.appid, price: args.price, headerImage: args.headerImage ?? null }),
    discordNotifySale: (args: { title: string; description: string; color?: number }): Promise<{ success: boolean }> =>
      invoke("discord_notify_sale", { title: args.title, description: args.description, color: args.color ?? null }),
    applySale: (gameIds: string[], saleType: string, saleValue: number, saleStart?: string, saleEnd?: string): Promise<{ success: boolean; updated: number; errors: string[] }> =>
      invoke("admin_apply_sale", { gameIds, saleType, saleValue, saleStart, saleEnd }),
    removeSale: (gameIds: string[]): Promise<{ success: boolean; updated: number }> =>
      invoke("admin_remove_sale", { gameIds }),
  },

  hubcap: {
    listKeys: (): Promise<{ success: boolean; data: HubcapKey[] }> =>
      invoke("hubcap_list_keys"),
    addKey: (args: { apiKey: string; label: string; sortOrder?: number }): Promise<{ success: boolean }> =>
      invoke("hubcap_add_key", { apiKey: args.apiKey, label: args.label, sortOrder: args.sortOrder ?? 0 }),
    deleteKey: (keyId: string): Promise<{ success: boolean }> =>
      invoke("hubcap_delete_key", { keyId }),
    toggleKey: (keyId: string, isActive: boolean): Promise<{ success: boolean }> =>
      invoke("hubcap_toggle_key", { keyId, isActive }),
    checkKey: (apiKey: string): Promise<HubcapKeyStats & { status?: number }> =>
      invoke("hubcap_check_key", { apiKey }),
    checkActiveKeyStats: (): Promise<{ exhausted: boolean; reason?: string; key_id?: string; locked_key_id?: string; stats: HubcapKeyStats }> =>
      invoke("hubcap_check_active_key_stats"),
    lockKey: (keyId: string): Promise<{ success: boolean }> =>
      invoke("hubcap_lock_key", { keyId }),
  },

  wallet: {
    createPayment: (amount: number, discountCode?: string): Promise<{
      success: boolean;
      message?: string;
      depositId?: string;
      orderCode?: string;
      amount?: number;
      payAmount?: number;
      discountAmount?: number;
      instantPaid?: boolean;
      qrUrl?: string;
      content?: string;
      bankId?: string;
      accountNo?: string;
      accountName?: string;
    }> => invoke("wallet_create_payment", { amount, discountCode }),
    checkStatus: (depositId: string): Promise<{
      success: boolean;
      status?: string;
      amount?: number;
      pay_amount?: number;
      order_code?: number;
      created_at?: string;
      balance?: number;
      message?: string;
    }> => invoke("wallet_check_status", { depositId }),
    listDeposits: (args: { limit: number }): Promise<{
      success: boolean;
      data: Array<{ id: string; amount: number; order_code: string; status: string; created_at: string }>;
      message?: string;
    }> => invoke("wallet_list_deposits", { limit: args.limit }),
    cancelDeposit: (depositId: string): Promise<{
      success: boolean;
      cancelled: boolean;
    }> => invoke("wallet_cancel_deposit", { depositId }),
  },

  discount: {
    validate: (args: {
      code: string;
      orderType: "game" | "dlc";
      orderAmount: number;
      gameId?: string;
      isOnSale: boolean;
    }): Promise<{
      success: boolean;
      message?: string;
      code_id?: string;
      code?: string;
      name?: string;
      type?: string;
      value?: number;
      discount_amount?: number;
      final_amount?: number;
      original_amount?: number;
    }> => invoke("discount_validate", {
      code: args.code,
      orderType: args.orderType,
      orderAmount: args.orderAmount,
      gameId: args.gameId,
      isOnSale: args.isOnSale,
    }),
    validateDeposit: (args: { code: string; depositAmount: number }): Promise<{
      success: boolean;
      message?: string;
      code_id?: string;
      code?: string;
      type?: string;
      value?: number;
      discount_amount?: number;
      deposit_amount?: number;
      pay_amount?: number;
    }> => invoke("discount_validate_deposit", {
      code: args.code,
      depositAmount: args.depositAmount,
    }),
    listAvailable: (): Promise<{
      success: boolean;
      data: Array<{
        id: string;
        code: string;
        name?: string;
        description?: string;
        type: string;
        value: number;
        expires_at?: string | null;
        applies_to_sale: boolean;
        applies_to_all: boolean;
        min_price?: number | null;
        max_price?: number | null;
        max_uses?: number | null;
        current_uses: number;
      }>;
    }> => invoke("discount_list_available"),

    // Admin
    adminList: (): Promise<Array<Record<string, unknown>>> => invoke("admin_discount_list"),
    adminCreate: (payload: Record<string, unknown>): Promise<{ success: boolean }> =>
      invoke("admin_discount_create", { payload }),
    adminUpdate: (id: string, patch: Record<string, unknown>): Promise<{ success: boolean }> =>
      invoke("admin_discount_update", { id, patch }),
    adminDelete: (id: string): Promise<{ success: boolean }> =>
      invoke("admin_discount_delete", { id }),
  },

  avatar: {
    listPresets: (): Promise<{ success: boolean; data?: Array<{ id: string; name: string; image_url: string; sort_order?: number }> }> =>
      invoke("avatar_list_presets"),
    adminList: (): Promise<Array<{ id: string; name: string; image_url: string; sort_order: number; is_active: boolean; created_at: string }>> =>
      invoke("admin_avatar_list"),
    adminUpload: (args: { name: string; imageData: string; mimeType: string; sortOrder?: number }): Promise<{ success: boolean; image_url?: string }> =>
      invoke("admin_avatar_upload", { name: args.name, imageData: args.imageData, mimeType: args.mimeType, sortOrder: args.sortOrder }),
    adminDelete: (id: string, name: string): Promise<{ success: boolean }> =>
      invoke("admin_avatar_delete", { id, name }),
    adminReorder: (items: Array<{ id: string; sort_order: number }>): Promise<{ success: boolean; updated: number }> =>
      invoke("admin_avatar_reorder", { items }),
  },

  gameFix: {
    precheck: (args: { appid: string; fixFolderName: string; fixExeName: string; fixDllName?: string }): Promise<{
      success: boolean;
      ready: boolean;
      reason?: string;
      message?: string;
      steam_path?: string;
      game_path?: string;
      auto_path_tried?: string;
      manifest_path?: string;
      manifest_ok?: boolean;
      missing?: string[];
    }> => invoke("game_fix_precheck", {
      appid: args.appid,
      fixFolderName: args.fixFolderName,
      fixExeName: args.fixExeName,
      fixDllName: args.fixDllName,
    }),
    verifyPath: (args: { appid: string; fixExeName: string; fixDllName?: string; chosenPath: string }): Promise<{
      success: boolean;
      message?: string;
      missing?: string[];
      manifest_ok?: boolean;
      game_path?: string;
      steam_path?: string;
    }> => invoke("game_fix_verify_path", {
      appid: args.appid,
      fixExeName: args.fixExeName,
      fixDllName: args.fixDllName,
      chosenPath: args.chosenPath,
    }),
    activate: (args: { appid: string; fixZipUrl: string; fixExeName: string; fixDllName?: string; gamePath: string }): Promise<{
      success: boolean;
      game_path?: string;
      message?: string;
    }> => invoke("game_fix_activate", {
      appid: args.appid,
      fixZipUrl: args.fixZipUrl,
      fixExeName: args.fixExeName,
      fixDllName: args.fixDllName,
      gamePath: args.gamePath,
    }),
  },

  steamLink: {
    getActiveUser: (): Promise<{
      active: boolean;
      active_user: number | null;
      steam_id: number | null;
    }> => invoke("steam_get_active_user"),

    fetchProfile: (activeUser: number): Promise<{
      steam_id: number;
      persona_name: string | null;
      avatar_url: string | null;
      is_logged_in: boolean;
    }> => invoke("steam_fetch_profile", { activeUser }),

    getLinkedAccount: (): Promise<{
      linked: boolean;
      link?: {
        id: string;
        registry_id: string;
        steam_id?: string;
        persona_name: string | null;
        avatar_url: string | null;
        linked_at: string;
      };
      error?: string;
    }> => invoke("steam_get_linked_account"),

    linkAccount: (args: {
      registryId: string;
      personaName?: string;
      avatarUrl?: string;
    }): Promise<{
      success: boolean;
      message?: string;
      link_info?: {
        id: string;
        user_id: string;
        registry_id: string;
        persona_name: string | null;
        avatar_url: string | null;
        linked_at: string;
      };
    }> => invoke("steam_link_account", args),

    unlinkAccount: (): Promise<{
      success: boolean;
      message?: string;
    }> => invoke("steam_unlink_account"),

    verifyLinkedAccount: (): Promise<{
      verified: boolean;
      is_mismatch: boolean;
      registry_id: number | null;
      linked_registry_id: string | null;
      reason: string;
    }> => invoke("steam_verify_linked_account"),

    guardianStart: (): Promise<{
      success: boolean;
      already_running?: boolean;
      pid?: number;
      message?: string;
    }> => invoke("steam_guardian_start"),

    guardianStop: (): Promise<{
      success: boolean;
      message?: string;
    }> => invoke("steam_guardian_stop"),

    forceRestartAndClear: (): Promise<{
      success: boolean;
      message?: string;
    }> => invoke("steam_force_restart_and_clear"),

    // Admin functions
    adminUnlinkSteam: (targetUserId: string): Promise<{
      success: boolean;
      message?: string;
    }> => invoke("admin_unlink_steam_account", { targetUserId }),

    adminGetUserSteamLink: (targetUserId: string): Promise<{
      linked: boolean;
      link?: {
        id: string;
        registry_id: string;
        steam_id: string;
        persona_name: string;
        avatar_url: string;
        linked_at: string;
      };
    }> => invoke("admin_get_user_steam_link", { targetUserId }),
  },

  supabase: {
    signIn: (data: { email: string; password: string; deviceId?: string }) =>
      invoke<SignInResult>("supabase_sign_in", { data }),
    signUp: (data: {
      email: string;
      password: string;
      displayName?: string;
      username?: string;
    }) => invoke("supabase_sign_up", { data }),
    signOut: () => invoke("supabase_sign_out"),
    sendOTP: (payload: string | { email: string; purpose?: string }) =>
      invoke("supabase_send_otp", { payload }),
    verifyOTP: (data: { email: string; code: string }) =>
      invoke("supabase_verify_otp", { data }),
    getSession: () => invoke("supabase_get_session"),
    getProfile: () => invoke("supabase_get_profile"),
    getProfileSlim: () => invoke("supabase_get_profile_slim"),
    getSessionLite: () => invoke("supabase_get_session_lite"),
    updateProfile: (updates: Record<string, unknown>) =>
      invoke("supabase_update_profile", { updates }),
    updatePasswordAdmin: (data: { email: string; password: string }) =>
      invoke("supabase_update_password_admin", { data }),
    verifyPassword: (data: { email: string; password: string }): Promise<{ success: boolean; message?: string }> =>
      invoke("supabase_verify_password", { data }),
    checkUsername: (data: { username: string }): Promise<{ available: boolean; message?: string }> =>
      invoke("supabase_check_username", { data }),
    verifyDeviceSession: (data: { userId: string; deviceId: string }) =>
      invoke("supabase_verify_device_session", { data }),
    completeDeviceVerificationAndSignIn: (payload: Record<string, unknown>) =>
      invoke("supabase_complete_device_verification_and_sign_in", { payload }),
    generateTotpSecret: (data?: Record<string, unknown>) =>
      invoke("supabase_generate_totp_secret", { payload: data ?? {} }),
    enableTotp2fa: (data: Record<string, unknown>) =>
      invoke("supabase_enable_totp2fa", { payload: data }),
    disableTotp2fa: (data: Record<string, unknown>) =>
      invoke("supabase_disable_totp2fa", { payload: data }),
    getLocalProfileSnapshot: () =>
      invoke("supabase_get_local_profile_snapshot"),
    setLocalProfileSnapshot: (payload: Record<string, unknown>) =>
      invoke("supabase_set_local_profile_snapshot", { payload }),
    onAuthStateChange: (callback: (payload: { event: string }) => void) => {
      let unlisten: UnlistenFn | null = null;
      listen<{ event: string }>("auth:stateChange", (event) => {
        callback(event.payload);
      }).then((fn) => {
        unlisten = fn;
      });
      return () => {
        unlisten?.();
      };
    },
  },
};

declare global {
  interface Window {
    electronAPI: typeof tauriAPI;
  }
}

export function installElectronAPIBridge() {
  window.electronAPI = tauriAPI;
}

export const api = new Proxy({} as typeof tauriAPI, {
  get(_target, prop: string) {
    return (tauriAPI as Record<string, unknown>)[prop];
  },
});
