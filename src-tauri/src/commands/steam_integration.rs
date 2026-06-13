/// Steam integration: DLL injection, stplug-in management, Steam restart
/// Windows-only module (registry, hidden file attributes, process management)
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use crate::state::AppState;

// ─── Helpers: Windows hidden+system attributes ────────────────────────────────

#[cfg(target_os = "windows")]
pub fn set_hidden_system_attr(path: &std::path::Path) -> std::io::Result<()> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::fileapi::SetFileAttributesW;
    use winapi::um::winnt::{FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM};

    let wide: Vec<u16> = OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let attr = FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM;
    let ok = unsafe { SetFileAttributesW(wide.as_ptr(), attr) };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(target_os = "windows")]
pub fn clear_hidden_system_attr(path: &std::path::Path) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::fileapi::SetFileAttributesW;
    use winapi::um::winnt::FILE_ATTRIBUTE_NORMAL;

    let wide: Vec<u16> = OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let _ = unsafe { SetFileAttributesW(wide.as_ptr(), FILE_ATTRIBUTE_NORMAL) };
}

#[cfg(not(target_os = "windows"))]
pub fn set_hidden_system_attr(_path: &std::path::Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn clear_hidden_system_attr(_path: &std::path::Path) {}

// ─── DLL names được cài vào SteamPath ────────────────────────────────────────
/// Ba file cần có trong SteamPath để Goldberg Emulator hoạt động.
/// Tất cả đều embedded trực tiếp trong binary (include_bytes!) — không cần folder dll/ riêng.
///   - xinput1_4.dll  (xinput redirect)
///   - dwmapi.dll     (dwm hook)
///   - steam.cfg      (Goldberg config)
const REQUIRED_STATIC_FILES: &[&str] = &["xinput1_4.dll", "dwmapi.dll", "steam.cfg"];

// Embed file content vào binary tại compile time
static EMBEDDED_XINPUT: &[u8] = include_bytes!("../../dll/xinput1_4.dll");
static EMBEDDED_DWMAPI: &[u8] = include_bytes!("../../dll/dwmapi.dll");
static EMBEDDED_STEAM_CFG: &[u8] = include_bytes!("../../dll/steam.cfg");

fn get_embedded_file(name: &str) -> Option<&'static [u8]> {
    match name {
        "xinput1_4.dll" => Some(EMBEDDED_XINPUT),
        "dwmapi.dll" => Some(EMBEDDED_DWMAPI),
        "steam.cfg" => Some(EMBEDDED_STEAM_CFG),
        _ => None,
    }
}

// ─── Read SteamPath from registry ─────────────────────────────────────────────

/// Đọc SteamPath từ HKCU\SOFTWARE\Valve\Steam
#[tauri::command]
pub async fn steam_get_path(state: State<'_, AppState>) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let steam_key = hkcu
            .open_subkey("SOFTWARE\\Valve\\Steam")
            .map_err(|e| format!("Không tìm thấy Steam registry: {e}"))?;

        let steam_path: String = steam_key
            .get_value("SteamPath")
            .map_err(|e| format!("Không đọc được SteamPath: {e}"))?;

        // Cache vào state để dùng khi quit từ tray
        let mut cached = state.steam_path.lock().await;
        *cached = Some(steam_path.clone());

        Ok(json!({ "success": true, "steam_path": steam_path }))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        Err("Chỉ hỗ trợ Windows".into())
    }
}

// ─── Install DLLs vào SteamPath ──────────────────────────────────────────────

/// Ghi file tĩnh (DLL + steam.cfg) vào SteamPath root (ẩn).
/// Nguồn: embedded bytes trong binary (include_bytes!).
/// Nếu file đã có sẵn ở Steam root → chỉ đảm bảo ẩn, không ghi lại.
#[tauri::command]
pub async fn steam_install_dll(_app: tauri::AppHandle, steam_path: String) -> Result<Value, String> {
    let mut installed: Vec<String> = Vec::new();
    let mut missing: Vec<String> = Vec::new();

    for file_name in REQUIRED_STATIC_FILES {
        let dst = std::path::PathBuf::from(&steam_path).join(file_name);

        if dst.exists() {
            // Đã có ở Steam root → chỉ đảm bảo ẩn
            let _ = set_hidden_system_attr(&dst);
            installed.push(file_name.to_string());
        } else if let Some(data) = get_embedded_file(file_name) {
            // Ghi embedded bytes ra file
            std::fs::write(&dst, data)
                .map_err(|e| format!("Không ghi được {file_name}: {e}"))?;
            set_hidden_system_attr(&dst)
                .map_err(|e| format!("Không ẩn {file_name}: {e}"))?;
            installed.push(file_name.to_string());
        } else {
            missing.push(file_name.to_string());
        }
    }

    Ok(json!({
        "success": missing.is_empty(),
        "installed": installed,
        "missing": missing,
    }))
}

/// Đặt thuộc tính ẩn cho tất cả file đã có trong SteamPath
#[tauri::command]
pub async fn steam_mark_dll_hidden(steam_path: String) -> Result<Value, String> {
    let mut hidden: Vec<String> = Vec::new();

    for file_name in REQUIRED_STATIC_FILES {
        let file_path = PathBuf::from(&steam_path).join(file_name);
        if file_path.exists() {
            let _ = set_hidden_system_attr(&file_path);
            hidden.push(file_name.to_string());
        }
    }

    Ok(json!({ "success": true, "hidden": hidden }))
}

/// Xóa DLL đã cài trong SteamPath (dùng khi quit launcher)
/// CHỈ xóa xinput1_4.dll và dwmapi.dll — giữ lại steam.cfg
#[tauri::command]
pub async fn steam_remove_dll(steam_path: String) -> Result<Value, String> {
    let mut removed: Vec<String> = Vec::new();
    let files_to_remove = ["xinput1_4.dll", "dwmapi.dll"];

    for file_name in &files_to_remove {
        let file_path = PathBuf::from(&steam_path).join(file_name);
        if file_path.exists() {
            clear_hidden_system_attr(&file_path);
            if std::fs::remove_file(&file_path).is_ok() {
                removed.push(file_name.to_string());
            }
        }
    }

    Ok(json!({ "success": true, "removed": removed }))
}

// ─── Check required files ─────────────────────────────────────────────────────

/// Kiểm tra xem tất cả file cần thiết đã đủ chưa.
/// Trả về:
///   - ready:              tất cả file có đủ (3 file tĩnh + lua)
///   - static_files_ready: 3 file tĩnh (xinput1_4.dll, dwmapi.dll, steam.cfg) đã có đủ
///   - lua_ready:          file lua của game đã có
///   - present / missing:  danh sách file có/thiếu
#[tauri::command]
pub async fn steam_check_files(
    steam_path: String,
    app_id: String,
) -> Result<Value, String> {
    let mut missing: Vec<String> = Vec::new();
    let mut present: Vec<String> = Vec::new();

    // Kiểm tra 4 file tĩnh (DLL + steam.cfg) trong SteamPath root
    for file_name in REQUIRED_STATIC_FILES {
        let path = PathBuf::from(&steam_path).join(file_name);
        if path.exists() {
            present.push(file_name.to_string());
        } else {
            missing.push(file_name.to_string());
        }
    }
    let static_files_ready = missing.is_empty();

    // Kiểm tra file lua của game
    let lua_name = format!("{app_id}.lua");
    let lua_path = PathBuf::from(&steam_path)
        .join("config")
        .join("stplug-in")
        .join(&lua_name);
    let lua_ready = lua_path.exists();

    if lua_ready {
        present.push(lua_name);
    } else {
        missing.push(lua_name);
    }

    Ok(json!({
        "ready": static_files_ready && lua_ready,
        "static_files_ready": static_files_ready,
        "lua_ready": lua_ready,
        "present": present,
        "missing": missing,
    }))
}

// ─── stplug-in folder ─────────────────────────────────────────────────────────

/// Kiểm tra và đảm bảo thư mục stplug-in tồn tại trong SteamPath\config
#[tauri::command]
pub async fn steam_ensure_stplugin_folder(steam_path: String) -> Result<Value, String> {
    let config_dir = PathBuf::from(&steam_path).join("config");
    let stplugin_dir = config_dir.join("stplug-in");

    let existed = stplugin_dir.exists();

    if !existed {
        std::fs::create_dir_all(&stplugin_dir)
            .map_err(|e| format!("Không tạo được thư mục stplug-in: {e}"))?;

        set_hidden_system_attr(&stplugin_dir)
            .map_err(|e| format!("Không đặt thuộc tính ẩn cho stplug-in: {e}"))?;
    }

    Ok(json!({
        "success": true,
        "existed": existed,
        "stplugin_path": stplugin_dir.to_string_lossy(),
    }))
}

// ─── Lua file management ──────────────────────────────────────────────────────

/// Lấy danh sách file lua hiện có trong stplug-in
#[tauri::command]
pub async fn steam_list_lua_files(steam_path: String) -> Result<Value, String> {
    let stplugin_dir = PathBuf::from(&steam_path).join("config").join("stplug-in");

    if !stplugin_dir.exists() {
        return Ok(json!({ "success": true, "appids": [] }));
    }

    let entries = std::fs::read_dir(&stplugin_dir)
        .map_err(|e| format!("Không đọc được thư mục stplug-in: {e}"))?;

    let mut appids: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("lua") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                appids.push(stem.to_string());
            }
        }
    }

    Ok(json!({ "success": true, "appids": appids }))
}

/// Xóa file lua cho một appid cụ thể
#[tauri::command]
pub async fn steam_remove_lua_file(steam_path: String, appid: String) -> Result<Value, String> {
    let lua_path = PathBuf::from(&steam_path)
        .join("config")
        .join("stplug-in")
        .join(format!("{}.lua", appid));

    if !lua_path.exists() {
        return Ok(json!({ "success": true, "skipped": true }));
    }

    clear_hidden_system_attr(&lua_path);

    std::fs::remove_file(&lua_path)
        .map_err(|e| format!("Không xóa được file lua {appid}: {e}"))?;

    Ok(json!({ "success": true, "removed": appid }))
}

/// Tải file lua cho một appid từ API:
///   1. Tải về bộ nhớ
///   2. Strip toàn bộ comment Lua (-- và --[[ ]])
///   3. Lưu file vào thư mục temp tạm thời
///   4. Copy vào stplug-in với thuộc tính ẩn
#[tauri::command]
pub async fn steam_download_lua(
    state: State<'_, AppState>,
    steam_path: String,
    appid: String,
) -> Result<Value, String> {
    let stplugin_dir = PathBuf::from(&steam_path).join("config").join("stplug-in");
    std::fs::create_dir_all(&stplugin_dir)
        .map_err(|e| format!("Không tạo được thư mục stplug-in: {e}"))?;

    let api_key = get_lua_api_key(state.clone()).await?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Lỗi tạo HTTP client: {e}"))?;

    let url = format!("https://hubcapmanifest.com/api/v1/lua/basegame/{appid}");

    // Hàm fetch với retry khi 429
    let bytes = {
        let response = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key.key))
            .send()
            .await
            .map_err(|e| format!("Lỗi tải lua cho appid {appid}: {e}"))?;

        let status = response.status().as_u16();

        if status == 429 {
            if !api_key.key_id.is_empty() {
                let _ = crate::commands::hubcap::hubcap_lock_key(state.clone(), api_key.key_id.clone()).await;
            }
            let api_key2 = get_lua_api_key(state.clone()).await?;
            let response2 = client
                .get(&url)
                .header("Authorization", format!("Bearer {}", api_key2.key))
                .send()
                .await
                .map_err(|e| format!("Lỗi tải lua (retry): {e}"))?;

            if !response2.status().is_success() {
                return Ok(json!({ "success": false, "reason": "http_error", "status": response2.status().as_u16(), "appid": appid }));
            }
            response2.bytes().await.map_err(|e| format!("Lỗi đọc response lua (retry): {e}"))?
        } else if !response.status().is_success() {
            return Ok(json!({ "success": false, "reason": "http_error", "status": status, "appid": appid }));
        } else {
            response.bytes().await.map_err(|e| format!("Lỗi đọc response lua: {e}"))?
        }
    };

    // Bước 2: Strip comment Lua khỏi nội dung
    let raw_str = String::from_utf8_lossy(&bytes);
    let stripped = strip_lua_comments(&raw_str);

    // Bước 3: Lưu tạm vào temp dir
    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join(format!("nyvexa_lua_{appid}.lua"));
    std::fs::write(&temp_path, stripped.as_bytes())
        .map_err(|e| format!("Không ghi được file lua tạm: {e}"))?;

    // Bước 4: Copy từ temp vào stplug-in và đặt ẩn
    let result = write_lua_file_from(&temp_path, &stplugin_dir, &appid);

    // Dọn temp
    let _ = std::fs::remove_file(&temp_path);

    result
}

/// Strip tất cả comment trong mã Lua:
///   - Block comments: --[[ ... ]] (có thể nhiều dòng)
///   - Line comments:  -- ...
/// Giữ nguyên nội dung code, blank lines được giữ để không làm thay đổi số dòng quá nhiều.
fn strip_lua_comments(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let chars: Vec<char> = src.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Kiểm tra "--"
        if i + 1 < len && chars[i] == '-' && chars[i + 1] == '-' {
            // Kiểm tra block comment "--[["
            if i + 3 < len && chars[i + 2] == '[' && chars[i + 3] == '[' {
                // Tìm "]]" kết thúc block
                i += 4;
                while i + 1 < len {
                    if chars[i] == ']' && chars[i + 1] == ']' {
                        i += 2;
                        break;
                    }
                    // Giữ newline để không phá vỡ số dòng
                    if chars[i] == '\n' {
                        out.push('\n');
                    }
                    i += 1;
                }
            } else {
                // Line comment — bỏ đến hết dòng
                while i < len && chars[i] != '\n' {
                    i += 1;
                }
            }
        } else if chars[i] == '"' || chars[i] == '\'' {
            // String literal — giữ nguyên, không strip bên trong
            let quote = chars[i];
            out.push(chars[i]);
            i += 1;
            while i < len {
                if chars[i] == '\\' && i + 1 < len {
                    // Escape sequence
                    out.push(chars[i]);
                    out.push(chars[i + 1]);
                    i += 2;
                } else if chars[i] == quote {
                    out.push(chars[i]);
                    i += 1;
                    break;
                } else {
                    out.push(chars[i]);
                    i += 1;
                }
            }
        } else if chars[i] == '[' && i + 1 < len && chars[i + 1] == '[' {
            // Long string [[ ... ]] — giữ nguyên
            out.push(chars[i]);
            out.push(chars[i + 1]);
            i += 2;
            while i + 1 < len {
                if chars[i] == ']' && chars[i + 1] == ']' {
                    out.push(chars[i]);
                    out.push(chars[i + 1]);
                    i += 2;
                    break;
                }
                out.push(chars[i]);
                i += 1;
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }

    out
}

struct ApiKeyInfo {
    key: String,
    key_id: String,
}

async fn get_lua_api_key(state: State<'_, AppState>) -> Result<ApiKeyInfo, String> {
    let key_res = crate::commands::hubcap::hubcap_get_active_key(state).await?;
    let key = key_res.get("api_key").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let key_id = key_res.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();

    if key.is_empty() {
        return Err("Hiện tại API đang quá tải, vui lòng liên hệ admin để nhận hỗ trợ".into());
    }

    Ok(ApiKeyInfo { key, key_id })
}

/// Copy file lua từ temp path vào stplug-in dir, đặt ẩn
fn write_lua_file_from(src: &std::path::Path, dir: &PathBuf, appid: &str) -> Result<Value, String> {
    let dst = dir.join(format!("{appid}.lua"));
    std::fs::copy(src, &dst)
        .map_err(|e| format!("Không copy file lua từ temp: {e}"))?;
    set_hidden_system_attr(&dst)
        .map_err(|e| format!("Không ẩn file lua: {e}"))?;
    Ok(json!({ "success": true, "appid": appid, "lua_path": dst.to_string_lossy() }))
}

// ─── DLC lua management ───────────────────────────────────────────────────────

/// Tải file lua cho một DLC appid từ API hubcap: /api/v1/lua/dlc/{app_id}/{dlc_appid}
/// Xử lý giống basegame: lưu tạm → strip comments → copy vào stplug-in (ẩn)
#[tauri::command]
pub async fn steam_download_dlc_lua(
    state: State<'_, AppState>,
    steam_path: String,
    app_id: String,
    dlc_appid: String,
) -> Result<Value, String> {
    let stplugin_dir = PathBuf::from(&steam_path).join("config").join("stplug-in");
    std::fs::create_dir_all(&stplugin_dir)
        .map_err(|e| format!("Không tạo được thư mục stplug-in: {e}"))?;

    let api_key = get_lua_api_key(state.clone()).await?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Lỗi tạo HTTP client: {e}"))?;

    // DLC endpoint: /api/v1/lua/dlc/{app_id}/{dlc_appid}
    let url = format!("https://hubcapmanifest.com/api/v1/lua/dlc/{app_id}/{dlc_appid}");

    let bytes = {
        let response = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key.key))
            .send()
            .await
            .map_err(|e| format!("Lỗi tải lua DLC {dlc_appid}: {e}"))?;

        let status = response.status().as_u16();

        if status == 429 {
            if !api_key.key_id.is_empty() {
                let _ = crate::commands::hubcap::hubcap_lock_key(state.clone(), api_key.key_id.clone()).await;
            }
            let api_key2 = get_lua_api_key(state.clone()).await?;
            let response2 = client
                .get(&url)
                .header("Authorization", format!("Bearer {}", api_key2.key))
                .send()
                .await
                .map_err(|e| format!("Lỗi tải lua DLC retry: {e}"))?;

            if !response2.status().is_success() {
                return Ok(json!({
                    "success": false,
                    "reason": "http_error",
                    "status": response2.status().as_u16(),
                    "dlc_appid": dlc_appid,
                }));
            }
            response2.bytes().await.map_err(|e| format!("Lỗi đọc response DLC lua: {e}"))?
        } else if !response.status().is_success() {
            return Ok(json!({
                "success": false,
                "reason": "http_error",
                "status": status,
                "dlc_appid": dlc_appid,
            }));
        } else {
            response.bytes().await.map_err(|e| format!("Lỗi đọc response DLC lua: {e}"))?
        }
    };

    // Strip comments và lưu qua temp
    let raw_str = String::from_utf8_lossy(&bytes);
    let stripped = strip_lua_comments(&raw_str);

    let temp_path = std::env::temp_dir().join(format!("nyvexa_dlc_{dlc_appid}.lua"));
    std::fs::write(&temp_path, stripped.as_bytes())
        .map_err(|e| format!("Không ghi file DLC lua tạm: {e}"))?;

    let result = write_lua_file_from(&temp_path, &stplugin_dir, &dlc_appid);
    let _ = std::fs::remove_file(&temp_path);
    result
}

/// Kiểm tra đủ file kể cả DLC lua: 3 file tĩnh + lua game + lua từng DLC được chọn
#[tauri::command]
pub async fn steam_check_files_with_dlc(
    steam_path: String,
    app_id: String,
    dlc_appids: Vec<String>,
) -> Result<Value, String> {
    let mut missing: Vec<String> = Vec::new();
    let mut present: Vec<String> = Vec::new();

    // 3 file tĩnh
    for file_name in REQUIRED_STATIC_FILES {
        let path = PathBuf::from(&steam_path).join(file_name);
        if path.exists() {
            present.push(file_name.to_string());
        } else {
            missing.push(file_name.to_string());
        }
    }
    let static_files_ready = missing.is_empty();

    // Lua game
    let lua_name = format!("{app_id}.lua");
    let lua_path = PathBuf::from(&steam_path)
        .join("config")
        .join("stplug-in")
        .join(&lua_name);
    let lua_ready = lua_path.exists();
    if lua_ready { present.push(lua_name); } else { missing.push(lua_name); }

    // Lua DLC
    let mut dlc_lua_ready = true;
    for dlc_id in &dlc_appids {
        let dlc_lua = format!("{dlc_id}.lua");
        let dlc_path = PathBuf::from(&steam_path)
            .join("config")
            .join("stplug-in")
            .join(&dlc_lua);
        if dlc_path.exists() {
            present.push(dlc_lua);
        } else {
            missing.push(dlc_lua);
            dlc_lua_ready = false;
        }
    }

    Ok(json!({
        "ready": static_files_ready && lua_ready && dlc_lua_ready,
        "static_files_ready": static_files_ready,
        "lua_ready": lua_ready,
        "dlc_lua_ready": dlc_lua_ready,
        "present": present,
        "missing": missing,
    }))
}

// ─── Steam process management ─────────────────────────────────────────────────

/// Force kill Steam.exe và tất cả process liên quan
#[tauri::command]
pub async fn steam_force_kill() -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        let processes = ["steam.exe", "steamservice.exe", "steamwebhelper.exe"];
        let mut killed = Vec::new();

        for proc in &processes {
            let output = std::process::Command::new("taskkill")
                .args(["/F", "/IM", proc])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            if let Ok(out) = output {
                if out.status.success() {
                    killed.push(*proc);
                }
            }
        }

        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        Ok(json!({ "success": true, "killed": killed }))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Chỉ hỗ trợ Windows".into())
    }
}

/// Mở lại Steam (không chờ, detach)
#[tauri::command]
pub async fn steam_launch(steam_path: String) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        let steam_exe = PathBuf::from(&steam_path).join("Steam.exe");
        if !steam_exe.exists() {
            return Ok(json!({ "success": false, "reason": "steam_exe_not_found", "path": steam_exe.to_string_lossy() }));
        }

        std::process::Command::new(&steam_exe)
            .spawn()
            .map_err(|e| format!("Không mở được Steam: {e}"))?;

        Ok(json!({ "success": true, "steam_exe": steam_exe.to_string_lossy() }))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = steam_path;
        Err("Chỉ hỗ trợ Windows".into())
    }
}

/// Force kill Steam rồi khởi động lại
#[tauri::command]
pub async fn steam_restart(steam_path: String) -> Result<Value, String> {
    steam_force_kill().await?;
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    steam_launch(steam_path).await
}

/// Chạy game qua steam://run/{app_id} (steamrun protocol)
/// Steam phải đang chạy khi gọi lệnh này
#[tauri::command]
pub async fn steam_run_game(app_id: String) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        let url = format!("steam://run/{app_id}");

        // Dùng ShellExecute để mở steam:// protocol URL
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Không thể chạy steam://run: {e}"))?;

        Ok(json!({ "success": true, "url": url }))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app_id;
        Err("Chỉ hỗ trợ Windows".into())
    }
}

// ─── Full play workflow ───────────────────────────────────────────────────────

/// Workflow khi bấm "Chơi ngay" — LUÔN restart Steam trước khi run:
/// 1. Đọc SteamPath từ registry
/// 2. Cài 3 file tĩnh (DLL + steam.cfg) vào SteamPath root nếu chưa có
/// 3. Đảm bảo thư mục stplug-in tồn tại
/// 4. Dọn lua game không còn sở hữu
/// 5. Tải lua game (qua temp → strip comment → stplug-in) nếu chưa có
/// 6. Tải lua DLC được chọn nếu chưa có
/// 7. Kiểm tra ĐỦ FILE (DLL/cfg + lua game + lua DLC) trước khi tiếp tục
/// 8. Restart Steam (kill → relaunch)
/// 9. steam://run/{appId}
#[tauri::command]
pub async fn steam_play_workflow(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    app_id: String,
    dlc_app_ids: Vec<String>,
    owned_appids: Vec<String>,
) -> Result<Value, String> {
    // ── 1. SteamPath ─────────────────────────────────────────────────────────
    let steam_path_res = steam_get_path(state.clone()).await?;
    let steam_path = steam_path_res
        .get("steam_path")
        .and_then(|v| v.as_str())
        .ok_or("Không tìm thấy SteamPath")?
        .to_string();

    // ── 2. Cài file tĩnh nếu thiếu (chỉ cài khi chưa có) ───────────────────
    {
        let dll1 = PathBuf::from(&steam_path).join("xinput1_4.dll");
        let dll2 = PathBuf::from(&steam_path).join("dwmapi.dll");
        if !dll1.exists() || !dll2.exists() {
            steam_install_dll(app, steam_path.clone()).await?;
        }
    }

    // ── 3. Đảm bảo stplug-in tồn tại ────────────────────────────────────────
    let folder_res = steam_ensure_stplugin_folder(steam_path.clone()).await?;
    let folder_existed = folder_res.get("existed").and_then(|v| v.as_bool()).unwrap_or(false);

    // ── 4. Dọn lua game không sở hữu ────────────────────────────────────────
    if folder_existed {
        let lua_list_res = steam_list_lua_files(steam_path.clone()).await?;
        if let Some(existing_appids) = lua_list_res.get("appids").and_then(|v| v.as_array()) {
            for lua_appid in existing_appids {
                if let Some(lua_id) = lua_appid.as_str() {
                    // Xóa nếu không trong owned game list VÀ không phải DLC đang được dùng
                    if !owned_appids.contains(&lua_id.to_string())
                        && !dlc_app_ids.contains(&lua_id.to_string())
                    {
                        let _ = steam_remove_lua_file(steam_path.clone(), lua_id.to_string()).await;
                    }
                }
            }
        }
    }

    // ── 5. Tải lua game nếu chưa có ──────────────────────────────────────────
    let pre_check = steam_check_files(steam_path.clone(), app_id.clone()).await?;
    let lua_already = pre_check.get("lua_ready").and_then(|v| v.as_bool()).unwrap_or(false);
    if !lua_already {
        let lua_res = steam_download_lua(state.clone(), steam_path.clone(), app_id.clone()).await?;
        let lua_ok = lua_res.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
        if !lua_ok {
            return Ok(json!({ "success": false, "step": "download_game_lua", "detail": lua_res }));
        }
    }

    // ── 6. Tải lua DLC được chọn nếu chưa có ─────────────────────────────────
    for dlc_id in &dlc_app_ids {
        let dlc_lua_path = PathBuf::from(&steam_path)
            .join("config")
            .join("stplug-in")
            .join(format!("{dlc_id}.lua"));

        if !dlc_lua_path.exists() {
            let dlc_res = steam_download_dlc_lua(
                state.clone(),
                steam_path.clone(),
                app_id.clone(),
                dlc_id.clone(),
            ).await?;

            let dlc_ok = dlc_res.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            if !dlc_ok {
                // DLC lua không tải được → log nhưng không dừng (DLC 404 = server chưa có)
                let status = dlc_res.get("status").and_then(|v| v.as_u64()).unwrap_or(0);
                if status != 404 {
                    return Ok(json!({
                        "success": false,
                        "step": "download_dlc_lua",
                        "dlc_appid": dlc_id,
                        "detail": dlc_res,
                    }));
                }
                // 404 → server chưa có lua cho DLC này, bỏ qua
            }
        }
    }

    // ── 7. Kiểm tra ĐỦ FILE trước khi restart ────────────────────────────────
    let check_res = steam_check_files_with_dlc(
        steam_path.clone(),
        app_id.clone(),
        dlc_app_ids.clone(),
    ).await?;
    let ready = check_res.get("ready").and_then(|v| v.as_bool()).unwrap_or(false);
    if !ready {
        let missing = check_res.get("missing").cloned().unwrap_or(json!([]));
        return Ok(json!({
            "success": false,
            "step": "check_files",
            "missing_files": missing,
            "detail": "Thiếu file trước khi khởi động Steam.",
        }));
    }

    // ── 8. Kill Steam ───────────────────────────────────────────────────────
    steam_force_kill().await?;
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;

    // ── 9. Mở Steam và chờ Steam sẵn sàng ────────────────────────────────────
    steam_launch(steam_path.clone()).await?;

    // Chờ Steam process sẵn sàng (poll kiểm tra steam.exe chạy + thêm buffer)
    // Steam cần thời gian khởi tạo trước khi có thể xử lý steam://run
    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        #[cfg(target_os = "windows")]
        {
            let output = std::process::Command::new("tasklist")
                .args(["/FI", "IMAGENAME eq steam.exe", "/NH"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            if let Ok(out) = output {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if stdout.to_lowercase().contains("steam.exe") {
                    // Steam process chạy rồi, chờ thêm vài giây để khởi tạo đầy đủ
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    break;
                }
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            tokio::time::sleep(std::time::Duration::from_secs(6)).await;
            break;
        }
    }

    // ── 10. Chạy game qua steam://run ─────────────────────────────────────────
    steam_run_game(app_id.clone()).await?;

    Ok(json!({
        "success": true,
        "steam_path": steam_path,
        "app_id": app_id,
        "dlc_count": dlc_app_ids.len(),
        "files_ok": true,
    }))
}

// ─── Steam Manifest Fix (SteamProof style) ────────────────────────────────────

/// Tìm và đóng popup MessageBox "steamproof.net" do wtsapi32.dll tạo ra.
/// Poll trong tối đa `timeout_secs` giây, đóng ngay khi tìm thấy.
/// Note: steam_manifest_fix đã được di chuyển sang stfixer.rs module
#[cfg(target_os = "windows")]
pub fn dismiss_steamproof_popup(timeout_secs: u64) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::winuser::{FindWindowW, PostMessageW, WM_CLOSE};

    // Các title có thể có của popup
    let titles = ["steamproof.net", "SteamProof", "steamproof"];
    let title_wides: Vec<Vec<u16>> = titles
        .iter()
        .map(|t| OsStr::new(t).encode_wide().chain(std::iter::once(0)).collect())
        .collect();

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
    loop {
        for tw in &title_wides {
            let hwnd = unsafe { FindWindowW(std::ptr::null(), tw.as_ptr()) };
            if !hwnd.is_null() {
                // Gửi WM_CLOSE để đóng cửa sổ MessageBox
                unsafe {
                    PostMessageW(hwnd, WM_CLOSE, 0, 0);
                }
            }
        }
        if std::time::Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
}
