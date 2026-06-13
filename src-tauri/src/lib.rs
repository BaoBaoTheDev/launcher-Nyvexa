mod commands;
mod services;
mod state;

use std::sync::Arc;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use directories::ProjectDirs;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tokio::sync::Mutex;

use services::env::{load_env_config, supabase_config_from_env};
use services::supabase::{parse_admin_emails, SupabaseConfig, SupabaseService};
use state::AppState;

fn apply_window_icon(app: &tauri::App) {
    let icon_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("icons")
        .join("icon.ico");
    if !icon_path.exists() {
        return;
    }
    if let Ok(icon) = tauri::image::Image::from_path(&icon_path) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_icon(icon);
        }
    }
}

/// Gắn version (lấy từ tauri.conf.json) vào tiêu đề cửa sổ ngay lúc khởi động
/// để màn login cũng hiện đúng version, không cần đợi `app_open_main_window`.
fn apply_window_title(app: &tauri::App) {
    let version = app.package_info().version.to_string();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(&format!("Nyvexa Launcher V{version}"));
    }
}

/// Xóa DLL và restart Steam khi user quit khỏi tray
fn cleanup_on_quit(app_handle: &tauri::AppHandle) {
    let state = app_handle.state::<AppState>();
    let steam_path = {
        if let Ok(guard) = state.steam_path.try_lock() {
            guard.clone()
        } else {
            None
        }
    };

    if let Some(path) = steam_path {
        let path_clone = path.clone();
        std::thread::spawn(move || {
            // Xóa 3 file tĩnh từ SteamPath root (DLL + steam.cfg)
            let static_files = ["xinput1_4.dll", "dwmapi.dll", "steam.cfg"];
            for file_name in &static_files {
                let file_path = std::path::PathBuf::from(&path_clone).join(file_name);
                if file_path.exists() {
                    commands::steam_integration::clear_hidden_system_attr(&file_path);
                    let _ = std::fs::remove_file(&file_path);
                }
            }

            // Restart Steam
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/IM", "steam.exe"])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output();
            std::thread::sleep(std::time::Duration::from_secs(2));

            let steam_exe = std::path::PathBuf::from(&path_clone).join("Steam.exe");
            if steam_exe.exists() {
                let _ = std::process::Command::new(&steam_exe).spawn();
            }
        });

        std::thread::sleep(std::time::Duration::from_millis(800));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let resource_dir = app.path().resource_dir().ok();
            let data_dir = app
                .path()
                .app_data_dir()
                .or_else(|_| {
                    ProjectDirs::from("com", "Nyvexa", "launcher")
                        .map(|d| d.data_dir().to_path_buf())
                        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "No project dir"))
                })
                .unwrap_or_else(|_| std::env::temp_dir().join("nyvexa-launcher"));

            let env = load_env_config(Some(&data_dir), resource_dir.as_deref());
            let (url, anon, service) = supabase_config_from_env(&env);
            let admin_emails = parse_admin_emails(&env.vars);

            let smtp = {
                use crate::services::supabase::SmtpConfig;
                let host = env.get("SMTP_HOST").unwrap_or_default();
                let user = env.get("SMTP_USER").unwrap_or_default();
                let pass = env.get("SMTP_PASS").unwrap_or_default();
                if !host.is_empty() && !user.is_empty() && !pass.is_empty() {
                    Some(SmtpConfig {
                        host,
                        port: env.get("SMTP_PORT").and_then(|p| p.parse().ok()).unwrap_or(587),
                        user: user.clone(),
                        pass,
                        from: env.get("SMTP_FROM").unwrap_or_else(|| format!("Nyvexa Launcher <{}>", user)),
                    })
                } else {
                    None
                }
            };

            let supabase = Arc::new(SupabaseService::new(
                SupabaseConfig {
                    url,
                    anon_key: anon,
                    service_key: service,
                    admin_emails,
                    smtp,
                    discord_webhook_new_game: env.get("DISCORD_WEBHOOK_NEW_GAME").unwrap_or_default(),
                    discord_webhook_sale: env.get("DISCORD_WEBHOOK_SALE").unwrap_or_default(),
                },
                data_dir,
            ));

            let handle = app.handle().clone();
            app.manage(AppState {
                supabase,
                app_handle: Arc::new(Mutex::new(Some(handle))),
                steam_path: Arc::new(Mutex::new(None)),
            });

            apply_window_icon(app);
            apply_window_title(app);

            // ── System Tray ──────────────────────────────────────────────────
            let open_i = MenuItem::with_id(app, "open", "Mở Nyvexa Launcher", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Thoát", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quit_i])?;

            // Load icon từ file hoặc dùng default
            let icon_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("icons")
                .join("icon.ico");

            let tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Nyvexa Launcher")
                .show_menu_on_left_click(false);

            let tray_builder = if icon_path.exists() {
                if let Ok(icon) = tauri::image::Image::from_path(&icon_path) {
                    tray_builder.icon(icon)
                } else {
                    tray_builder
                }
            } else {
                tray_builder
            };

            let _tray = tray_builder.build(app)?;

            // ── Handle window close → minimize to tray ───────────────────────
            if let Some(window) = app.get_webview_window("main") {
                let win_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Ngăn đóng, ẩn window xuống tray
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }

            Ok(())
        })
        // ── Tray icon click & menu ──────────────────────────────────────────
        .on_tray_icon_event(|tray, event| {
            match event {
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    // Double-click hoặc left-click → mở lại cửa sổ
                    let app = tray.app_handle();
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
                _ => {}
            }
        })
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "open" => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
                "quit" => {
                    // Cleanup: xóa DLL + restart Steam trước khi thoát
                    cleanup_on_quit(app);
                    app.exit(0);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::get_supabase_config,
            commands::auth::supabase_sign_in,
            commands::auth::supabase_sign_up,
            commands::auth::supabase_sign_out,
            commands::auth::supabase_send_otp,
            commands::auth::supabase_verify_otp,
            commands::auth::supabase_get_session,
            commands::auth::supabase_get_profile,
            commands::auth::supabase_get_profile_slim,
            commands::auth::supabase_get_session_lite,
            commands::auth::supabase_update_profile,
            commands::auth::supabase_update_password_admin,
            commands::auth::supabase_verify_password,
            commands::auth::supabase_check_username,
            commands::auth::supabase_verify_device_session,
            commands::auth::supabase_complete_device_verification_and_sign_in,
            commands::auth::supabase_generate_totp_secret,
            commands::auth::supabase_enable_totp2fa,
            commands::auth::supabase_disable_totp2fa,
            commands::auth::supabase_get_local_profile_snapshot,
            commands::auth::supabase_set_local_profile_snapshot,
            commands::app::app_get_version,
            commands::app::app_open_main_window,
            commands::app::app_post_login_steam_prep,
            commands::app::app_confirm_close,
            commands::app::app_minimize_to_tray,
            commands::app::app_cancel_close,
            commands::app::app_get_launch_at_startup,
            commands::app::app_set_launch_at_startup,
            commands::app::app_open_external,
            commands::app::app_check_update,
            commands::app::app_download_and_install_update,
            // Store & Library
            commands::store::store_debug_info,
            commands::store::games_list,
            commands::store::games_list_review_summaries,
            commands::store::review_submit,
            commands::store::review_my,
            commands::store::review_list,
            commands::store::user_games_list_owned,
            commands::store::admin_list_store_assets,
            commands::store::steam_get_app_details,
            commands::store::steam_play,
            commands::store::steam_preload,
            commands::store::steam_get_preload_metadata,
            commands::store::dlc_list_owned_for_basegame,
            commands::store::dlc_list_for_basegame,
            commands::store::dlc_batch_upsert,
            commands::store::dlc_get_or_fetch,
            commands::store::dlc_purchase,
            commands::store::community_list_movie_history,
            commands::store::community_get_movie_progress,
            commands::store::user_games_has,
            commands::store::purchase_game,
            commands::store::games_set_library_assets,
            // Referral system
            commands::store::referral_get_my_code,
            commands::store::referral_create_code,
            commands::store::referral_validate_code,
            commands::store::referral_record_use,
            commands::store::admin_referral_list,
            commands::store::admin_referral_uses,
            commands::store::admin_referral_reset_earned,
            // Admin
            commands::admin::admin_debug_my_role,
            commands::admin::admin_list_users,
            commands::admin::admin_list_user_games,
            commands::admin::admin_revoke_game,
            commands::admin::admin_grant_game,
            commands::admin::admin_gift_balance,
            commands::admin::admin_set_balance,
            commands::admin::admin_toggle_ban,
            commands::admin::admin_games_list,
            commands::admin::admin_games_add,
            commands::admin::admin_games_update,
            commands::admin::admin_games_delete,
            commands::admin::admin_games_reorder,
            commands::admin::admin_balance_logs,
            commands::admin::admin_dlcs_list,
            commands::admin::admin_dlcs_update,
            commands::admin::admin_dlcs_delete,
            commands::admin::admin_apply_sale_dlc,
            commands::admin::admin_remove_sale_dlc,
            commands::admin::admin_store_assets_list,
            commands::admin::admin_store_assets_add,
            commands::admin::admin_store_assets_delete,
            commands::admin::admin_get_analytics,
            commands::admin::admin_get_analytics_v2,
            commands::admin::admin_get_app_settings,
            commands::admin::admin_save_app_settings,
            commands::admin::admin_apply_sale,
            commands::admin::admin_remove_sale,
            commands::admin::admin_rescan_genres,
            commands::admin::admin_discount_redemptions,
            commands::admin::admin_grant_game_to_user,
            commands::admin::discord_notify_new_game,
            commands::admin::discord_notify_sale,
            commands::admin::admin_balance_logs_v2,
            commands::admin::admin_balance_log_detail,
            commands::steam_fetch::admin_fetch_steam_game,
            commands::steam_fetch::fetch_steam_app_full,
            commands::steam_fetch::steam_get_app_icon,
            commands::steam_fetch::steam_get_apps_batch,
            // Steam Integration
            commands::steam_integration::steam_get_path,
            commands::steam_integration::steam_install_dll,
            commands::steam_integration::steam_mark_dll_hidden,
            commands::steam_integration::steam_remove_dll,
            commands::steam_integration::steam_check_files,
            commands::steam_integration::steam_check_files_with_dlc,
            commands::steam_integration::steam_ensure_stplugin_folder,
            commands::steam_integration::steam_list_lua_files,
            commands::steam_integration::steam_remove_lua_file,
            commands::steam_integration::steam_download_lua,
            commands::steam_integration::steam_download_dlc_lua,
            commands::steam_integration::steam_force_kill,
            commands::steam_integration::steam_launch,
            commands::steam_integration::steam_restart,
            commands::steam_integration::steam_run_game,
            commands::steam_integration::steam_play_workflow,
            commands::stfixer::steam_manifest_fix,
            // Hubcap API key management
            commands::hubcap::hubcap_check_key,
            commands::hubcap::hubcap_list_keys,
            commands::hubcap::hubcap_add_key,
            commands::hubcap::hubcap_delete_key,
            commands::hubcap::hubcap_toggle_key,
            commands::hubcap::hubcap_get_active_key,
            commands::hubcap::hubcap_lock_key,
            commands::hubcap::hubcap_check_active_key_stats,
            // Wallet (SePay deposits)
            commands::wallet::wallet_create_payment,
            commands::wallet::wallet_check_status,
            commands::wallet::wallet_list_deposits,
            commands::wallet::wallet_cancel_deposit,
            // Discount codes
            commands::discount::discount_validate,
            commands::discount::discount_validate_deposit,
            commands::discount::discount_list_available,
            commands::discount::admin_discount_list,
            commands::discount::admin_discount_create,
            commands::discount::admin_discount_update,
            commands::discount::admin_discount_delete,
            // Game fix activation
            commands::game_fix::game_fix_precheck,
            commands::game_fix::game_fix_verify_path,
            commands::game_fix::game_fix_activate,
            // Avatar
            commands::avatar::avatar_list_presets,
            commands::avatar::admin_avatar_list,
            commands::avatar::admin_avatar_upload,
            commands::avatar::admin_avatar_reorder,
            commands::avatar::admin_avatar_delete,
            // Steam Account Linking
            commands::steam_link::steam_get_active_user,
            commands::steam_link::steam_fetch_profile,
            commands::steam_link::steam_get_linked_account,
            commands::steam_link::steam_link_account,
            commands::steam_link::steam_unlink_account,
            commands::steam_link::steam_verify_linked_account,
            commands::steam_link::steam_guardian_start,
            commands::steam_link::steam_guardian_stop,
            commands::steam_link::steam_force_restart_and_clear,
            commands::steam_link::admin_unlink_steam_account,
            commands::steam_link::admin_get_user_steam_link,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
