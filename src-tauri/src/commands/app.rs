use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State, WebviewWindow};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use crate::state::AppState;

/// Lấy version từ `tauri.conf.json` (qua PackageInfo). Đây là single source of truth
/// — Cargo.toml / package.json không ảnh hưởng tới version mà launcher báo cáo.
fn app_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn app_get_version(app: AppHandle) -> String {
    app_version(&app)
}

/// So sánh 2 version dạng "a.b.c". Trả về Ordering của `a` so với `b`.
/// Phần thiếu coi như 0, phần không phải số bị bỏ qua.
fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |s: &str| -> Vec<u64> {
        s.trim()
            .trim_start_matches('v')
            .split('.')
            .map(|p| {
                p.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse::<u64>()
                    .unwrap_or(0)
            })
            .collect()
    };
    let va = parse(a);
    let vb = parse(b);
    let n = va.len().max(vb.len());
    for i in 0..n {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        match x.cmp(&y) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

/// Kiểm tra cập nhật: đọc app_settings (anon key) và so với version đang chạy.
/// Trả về current/latest/min version, link tải, và cờ update_available / update_required.
#[tauri::command]
pub async fn app_check_update(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    use std::cmp::Ordering;

    let svc = state.supabase.clone();
    let base = svc.config.url.trim_end_matches('/');
    if base.is_empty() {
        return Ok(json!({ "success": false, "reason": "no_config" }));
    }

    let url = format!("{base}/rest/v1/app_settings?select=key,value");
    let rows = svc.http_get_anon(&url).await.unwrap_or(json!([]));

    let mut download_url = String::new();
    let mut latest_version = String::new();
    let mut min_version = String::new();
    if let Some(arr) = rows.as_array() {
        for r in arr {
            let k = r.get("key").and_then(|v| v.as_str()).unwrap_or("");
            let v = r.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string();
            match k {
                "download_url" => download_url = v,
                "latest_version" => latest_version = v,
                "min_version" => min_version = v,
                _ => {}
            }
        }
    }

    let current = app_version(&app);

    // update_available: có bản mới hơn version đang chạy
    let update_available = !latest_version.is_empty()
        && compare_versions(&current, &latest_version) == Ordering::Less;

    // update_required: version đang chạy nhỏ hơn min_version -> bắt buộc cập nhật
    let update_required = !min_version.is_empty()
        && compare_versions(&current, &min_version) == Ordering::Less;

    Ok(json!({
        "success": true,
        "current_version": current,
        "latest_version": latest_version,
        "min_version": min_version,
        "download_url": download_url,
        "update_available": update_available,
        "update_required": update_required,
    }))
}

/// Tải installer từ direct link, chạy nó, rồi thoát launcher để bản cài mới
/// có thể ghi đè / gỡ cài đặt bản cũ. NSIS perMachine sẽ tự upgrade bản trước.
#[tauri::command]
pub async fn app_download_and_install_update(
    app: AppHandle,
    url: String,
) -> Result<Value, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Link tải không hợp lệ".into());
    }

    // Tải file về thư mục temp
    let resp = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Không tải được bản cập nhật: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Server trả về lỗi: {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Lỗi đọc dữ liệu tải về: {e}"))?;

    // Đặt tên file giữ lại đuôi .exe / .msi nếu có
    let lower = url.to_lowercase();
    let ext = if lower.contains(".msi") { "msi" } else { "exe" };
    let file_name = format!("nyvexa-launcher-update.{ext}");
    let tmp_path = std::env::temp_dir().join(file_name);

    std::fs::write(&tmp_path, &bytes)
        .map_err(|e| format!("Không ghi được file cài đặt: {e}"))?;

    // Khởi chạy installer.
    // Installer NSIS perMachine cần quyền admin (UAC). CreateProcess (spawn) trực tiếp
    // sẽ fail với os error 740 "requires elevation". Phải mở qua ShellExecute verb "runas"
    // (dùng PowerShell Start-Process -Verb RunAs) để Windows hiện prompt nâng quyền.
    #[cfg(target_os = "windows")]
    {
        let path_str = tmp_path.to_string_lossy().to_string();
        let ps_cmd = if ext == "msi" {
            // msiexec /i "<path>" — bản thân msiexec sẽ tự xin quyền nếu cần
            format!(
                "Start-Process -FilePath 'msiexec' -ArgumentList '/i','\"{}\"' -Verb RunAs",
                path_str.replace('\'', "''")
            )
        } else {
            format!(
                "Start-Process -FilePath '{}' -Verb RunAs",
                path_str.replace('\'', "''")
            )
        };

        std::process::Command::new("powershell")
            .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &ps_cmd])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Không chạy được installer: {e}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = &tmp_path;
        return Err("Chỉ hỗ trợ tự cập nhật trên Windows".into());
    }

    // Cho installer vài trăm ms khởi động rồi thoát launcher để giải phóng file exe
    let app_clone = app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        app_clone.exit(0);
    });

    Ok(json!({ "success": true, "launched": true }))
}

#[tauri::command]
pub async fn app_open_main_window(app: AppHandle) -> Value {
    let version = app_version(&app);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_size(tauri::LogicalSize::new(1280.0, 800.0));
        let _ = win.set_resizable(true);
        let _ = win.maximize();
        let _ = win.set_title(&format!("Nyvexa Launcher V{version}"));
        let _ = win.show();
        let _ = win.set_focus();
    }
    json!({ "success": true, "opened": true })
}

#[tauri::command]
pub async fn app_post_login_steam_prep() -> Value {
    json!({ "success": true, "skipped": true })
}

#[tauri::command]
pub async fn app_confirm_close(should_close: bool) -> Value {
    let _ = should_close;
    json!({ "success": true, "closed": false })
}

/// Ẩn cửa sổ xuống system tray (hide, không minimize)
#[tauri::command]
pub async fn app_minimize_to_tray(window: WebviewWindow) -> Value {
    let _ = window.hide();
    json!({ "success": true, "minimized": true })
}

#[tauri::command]
pub async fn app_cancel_close() -> Value {
    json!({ "success": true })
}

// ─── Registry key cho "Khởi động cùng Windows" ───────────────────────────────
const STARTUP_REG_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const STARTUP_APP_NAME: &str = "NyvexaLauncher";

/// Kiểm tra launcher có được đặt chạy cùng Windows không
/// Đọc HKCU\Software\Microsoft\Windows\CurrentVersion\Run
#[tauri::command]
pub async fn app_get_launch_at_startup(_state: State<'_, AppState>) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = match hkcu.open_subkey(STARTUP_REG_KEY) {
            Ok(k) => k,
            Err(_) => return Ok(json!({ "enabled": false })),
        };

        let enabled = run_key.get_value::<String, _>(STARTUP_APP_NAME).is_ok();
        Ok(json!({ "enabled": enabled }))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(json!({ "enabled": false }))
    }
}

/// Bật/tắt khởi động cùng Windows
/// Ghi/xóa HKCU\Software\Microsoft\Windows\CurrentVersion\Run\NyvexaLauncher
#[tauri::command]
pub async fn app_set_launch_at_startup(enabled: bool) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu
            .open_subkey_with_flags(STARTUP_REG_KEY, KEY_SET_VALUE)
            .map_err(|e| format!("Không mở được registry: {e}"))?;

        if enabled {
            // Lấy đường dẫn exe hiện tại
            let exe_path = std::env::current_exe()
                .map_err(|e| format!("Không lấy được exe path: {e}"))?;
            let exe_str = exe_path.to_string_lossy().to_string();

            run_key
                .set_value(STARTUP_APP_NAME, &exe_str)
                .map_err(|e| format!("Không ghi được registry: {e}"))?;
        } else {
            // Xóa entry — ignore error nếu không tồn tại
            let _ = run_key.delete_value(STARTUP_APP_NAME);
        }

        Ok(json!({ "success": true, "enabled": enabled }))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Ok(json!({ "success": true, "enabled": false }))
    }
}

/// Mở URL bằng trình duyệt mặc định của hệ thống
#[tauri::command]
pub async fn app_open_external(url: String) -> Result<Value, String> {
    if url.is_empty() {
        return Ok(json!({ "success": false, "reason": "empty_url" }));
    }

    // Chỉ cho phép http/https để tránh injection
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Ok(json!({ "success": false, "reason": "invalid_scheme" }));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Không mở được URL: {e}"))?;
        Ok(json!({ "success": true, "url": url }))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = url;
        Ok(json!({ "success": false, "reason": "unsupported_platform" }))
    }
}
