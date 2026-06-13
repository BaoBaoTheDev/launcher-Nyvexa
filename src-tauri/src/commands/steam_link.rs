//! Steam Account Linking Commands
//! 
//! Handles the linking of Steam accounts to launcher user accounts.

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use urlencoding;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const STEAM_STEAMID_OFFSET: u64 = 76561197960265728;
const STEAM_REGISTRY_PATH: &str = r"SOFTWARE\Valve\Steam\ActiveProcess";
const STEAM_USERS_PATH: &str = r"SOFTWARE\Valve\Steam\Users";

async fn check_is_admin(svc: &crate::services::supabase::SupabaseService, user_id: &str) -> Result<bool, String> {
    let url = format!(
        "{}/rest/v1/profiles?id=eq.{}&select=role",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(user_id)
    );
    match svc.http_get_admin(&url).await {
        Ok(data) => {
            if let Some(arr) = data.as_array() {
                if let Some(profile) = arr.first() {
                    let role = profile.get("role").and_then(|v| v.as_str()).unwrap_or("user");
                    return Ok(role == "admin" || role == "manager" || role == "payer");
                }
            }
            Ok(false)
        }
        Err(_) => Ok(false),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamLinkInfo {
    pub id: String,
    pub user_id: String,
    #[serde(rename = "registry_id", alias = "steam_id")]
    pub registry_id: String,
    pub persona_name: Option<String>,
    pub avatar_url: Option<String>,
    pub linked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamAccountInfo {
    pub steam_id: u64,
    pub persona_name: Option<String>,
    pub avatar_url: Option<String>,
    pub is_logged_in: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkSteamResult {
    pub success: bool,
    pub message: Option<String>,
    pub link_info: Option<SteamLinkInfo>,
}

/// Get current ActiveUser from Steam registry
#[tauri::command]
pub async fn steam_get_active_user() -> Result<Value, String> {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        
        // First get ActiveUser to know which user subkey to read
        let active_user = match hkcu.open_subkey(STEAM_REGISTRY_PATH) {
            Ok(key) => key.get_value::<u32, _>("ActiveUser").ok(),
            Err(_) => None,
        };
        
        let active_user = match active_user {
            Some(u) if u != 0 => u,
            _ => return Ok(json!({
                "active": false,
                "active_user": 0,
                "steam_id": null
            })),
        };
        
        // Now get SteamID from the user's registry subkey
        // Steam stores the SteamID in SOFTWARE\Valve\Steam\Users\<ActiveUser>
        let users_path = format!("{}\\{}", STEAM_REGISTRY_PATH.replace("ActiveProcess", "Users"), active_user);
        
        if let Ok(user_key) = hkcu.open_subkey(&users_path) {
            // Try to get SteamID from various possible field names
            let steam_id: Option<u64> = user_key.get_value("SteamId")
                .or_else(|_| user_key.get_value("PersonaName"))
                .ok()
                .and_then(|s: String| s.parse::<u64>().ok());
            
            if let Some(steam_id) = steam_id {
                return Ok(json!({
                    "active": true,
                    "active_user": active_user,
                    "steam_id": steam_id
                }));
            }
        }
        
        // Fallback: calculate from ActiveUser (this might not be accurate)
        Ok(json!({
            "active": true,
            "active_user": active_user,
            "steam_id": active_user
        }))
    }

    #[cfg(not(windows))]
    {
        Ok(json!({
            "active": false,
            "message": "Steam registry monitoring is only available on Windows"
        }))
    }
}

/// Fetch Steam profile data from Steam Community API
/// 
/// IMPORTANT: The ActiveUser from registry is NOT directly the SteamID64.
/// We need to query Steam's API to get the real SteamID.
/// 
/// We try multiple possible SteamID formats because the registry might store
/// different representations of the SteamID.
#[tauri::command]
pub async fn steam_fetch_profile(active_user: u32) -> Result<SteamAccountInfo, String> {
    if active_user == 0 {
        return Err("Chưa đăng nhập Steam".to_string());
    }
    
    // Try multiple possible SteamID calculations
    // Format 1: SteamID64 = ActiveUser + STEAM_STEAMID_OFFSET
    // Format 2: Just ActiveUser (some systems store raw ID)
    // Format 3: Some other offset values Steam might use
    let possible_steam_ids = vec![
        u64::from(active_user).saturating_add(STEAM_STEAMID_OFFSET),
        u64::from(active_user),
        u64::from(active_user) * 2 + STEAM_STEAMID_OFFSET,
        u64::from(active_user) + 1,
    ];
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    
    // Try each possible SteamID until we find one that works
    for calc_steam_id in possible_steam_ids {
        let url = format!("https://steamcommunity.com/profiles/{}/?xml=1", calc_steam_id);
        
        let response = match client.get(&url).send().await {
            Ok(r) => r,
            Err(_) => continue,
        };
        
        if !response.status().is_success() {
            continue;
        }
        
        let body = match response.text().await {
            Ok(b) => b,
            Err(_) => continue,
        };
        
        // Parse XML - get steamID64 from response
        // This is the CORRECT SteamID that Steam assigns to the account
        let actual_steam_id = extract_xml_value(&body, "steamID64")
            .and_then(|s| s.parse::<u64>().ok());
        
        // Also check if we got a valid persona name (confirms we got the right profile)
        let persona_name = extract_xml_value(&body, "steamID");
        
        if persona_name.is_some() {
            let avatar_medium = extract_xml_value(&body, "avatarMedium");
            eprintln!("[steam_link] persona: {:?}, avatar: {:?}", persona_name, avatar_medium);
            
            return Ok(SteamAccountInfo {
                steam_id: actual_steam_id.unwrap_or(calc_steam_id),
                persona_name,
                avatar_url: avatar_medium,
                is_logged_in: true,
            });
        }
    }
    
    Err("Không tìm thấy thông tin tài khoản Steam. Vui lòng kiểm tra đăng nhập Steam.".to_string())
}

fn extract_xml_value(xml: &str, tag: &str) -> Option<String> {
    let open_tag = format!("<{}>", tag);
    let close_tag = format!("</{}>", tag);
    
    if let Some(start) = xml.find(&open_tag) {
        let content_start = start + open_tag.len();
        if let Some(end) = xml[content_start..].find(&close_tag) {
            let content = xml[content_start..content_start + end].trim();
            
            // Handle CDATA sections like <![CDATA[ ... ]]>
            if content.starts_with("<![CDATA[") && content.ends_with("]]>") {
                return Some(content[9..content.len() - 3].trim().to_string());
            }
            
            return Some(content.to_string());
        }
    }
    None
}

/// Get user's linked Steam account (if any)
#[tauri::command]
pub async fn steam_get_linked_account(state: State<'_, AppState>) -> Result<Value, String> {
    let user_id = state.supabase.get_user_id().await
        .ok_or_else(|| "Vui lòng đăng nhập".to_string())?;
    
    // Query steam_links table via REST
    let url = format!("{}/rest/v1/steam_links?user_id=eq.{}&select=*", 
        state.supabase.config.url, user_id);
    
    let response = state.supabase.http_get_admin(&url).await;
    
    match response {
        Ok(data) => {
            if let Some(links) = data.as_array() {
                if let Some(link) = links.first() {
                    return Ok(json!({
                        "linked": true,
                        "link": {
                            "id": link.get("id"),
                            "steam_id": link.get("steam_id"),
                            "registry_id": link.get("registry_id"),
                            "persona_name": link.get("persona_name"),
                            "avatar_url": link.get("avatar_url"),
                            "linked_at": link.get("linked_at")
                        }
                    }));
                }
            }
            Ok(json!({ "linked": false }))
        }
        Err(e) => Ok(json!({ "linked": false, "error": e })),
    }
}

/// Link Steam account to user account
#[tauri::command]
pub async fn steam_link_account(
    state: State<'_, AppState>,
    registry_id: String,
    persona_name: Option<String>,
    avatar_url: Option<String>,
) -> Result<LinkSteamResult, String> {
    let user_id = state.supabase.get_user_id().await
        .ok_or("Vui lòng đăng nhập để liên kết tài khoản Steam")?;
    
    // Validate registry_id format (should be decimal u32 value)
    let registry_id_val: u32 = registry_id.parse()
        .map_err(|_| "Registry ID không hợp lệ")?;
    
    // Check if already linked by another user
    let check_url = format!(
        "{}/rest/v1/steam_links?registry_id=eq.{}&user_id=not.eq.{}&select=user_id",
        state.supabase.config.url, registry_id, user_id
    );
    
    if let Ok(existing) = state.supabase.http_get_admin(&check_url).await {
        if let Some(links) = existing.as_array() {
            if !links.is_empty() {
                return Err("Tài khoản Steam này đã được liên kết với tài khoản khác".to_string());
            }
        }
    }
    
    // Insert into steam_links table - store registry_id instead of steam_id
    let insert_url = format!("{}/rest/v1/steam_links", state.supabase.config.url);
    
    let body = json!({
        "user_id": user_id,
        "registry_id": registry_id,
        "steam_id": serde_json::Value::Null,
        "persona_name": persona_name,
        "avatar_url": avatar_url
    });
    
    match state.supabase.http_post_admin_upsert(&insert_url, &body).await {
        Ok(result) => {
            eprintln!("[steam_link] Insert successful");
            let link_info = SteamLinkInfo {
                id: result.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                user_id: user_id.clone(),
                registry_id: registry_id.clone(),
                persona_name: persona_name.clone(),
                avatar_url: avatar_url.clone(),
                linked_at: chrono::Utc::now().to_rfc3339(),
            };
            
            Ok(LinkSteamResult {
                success: true,
                message: Some("Đã liên kết tài khoản Steam thành công!".to_string()),
                link_info: Some(link_info),
            })
        }
        Err(e) => {
            eprintln!("[steam_link] Insert failed: {}", e);
            Err(format!("Không thể liên kết: {}", e))
        }
    }
}

/// Unlink Steam account from user account
#[tauri::command]
pub async fn steam_unlink_account(state: State<'_, AppState>) -> Result<Value, String> {
    let user_id = state.supabase.get_user_id().await
        .ok_or("Vui lòng đăng nhập để thực hiện thao tác này")?;
    
    let url = format!("{}/rest/v1/steam_links?user_id=eq.{}", state.supabase.config.url, user_id);
    
    // Use reqwest directly for DELETE
    let client = reqwest::Client::new();
    let _response = client
        .delete(&url)
        .header("apikey", &state.supabase.config.service_key)
        .header("Authorization", format!("Bearer {}", state.supabase.config.service_key))
        .send()
        .await
        .map_err(|e| format!("Không thể hủy liên kết: {}", e))?;
    
    Ok(json!({
        "success": true,
        "message": "Đã hủy liên kết tài khoản Steam"
    }))
}

/// Check if current Steam user matches linked account
#[tauri::command]
pub async fn steam_verify_linked_account(state: State<'_, AppState>) -> Result<Value, String> {
    // Get current active user from registry
    let active_user = steam_get_active_user().await?;
    let active_user_id = active_user.get("active_user")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
        .unwrap_or(0);
    
    if active_user_id == 0 {
        return Ok(json!({
            "verified": false,
            "is_mismatch": true,
            "registry_id": null,
            "linked_registry_id": null,
            "reason": "not_logged_in",
            "message": "Chưa đăng nhập Steam"
        }));
    }
    
    // Get linked account from database
    let linked_info = steam_get_linked_account(state).await?;
    
    if !linked_info.get("linked").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Ok(json!({
            "verified": false,
            "reason": "no_link",
            "message": "Chưa liên kết tài khoản Steam"
        }));
    }
    
    // Compare registry IDs directly
    let linked_registry_id = linked_info.get("link")
        .and_then(|v| v.get("registry_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    
    let is_mismatch = match (Some(active_user_id.to_string()).as_ref(), linked_registry_id.as_ref()) {
        (Some(current), Some(linked)) => current != linked,
        _ => true,
    };
    
    eprintln!("[steam_verify] registry_id: {}, linked_registry_id: {:?}, is_mismatch: {}", active_user_id, linked_registry_id, is_mismatch);
    
    Ok(json!({
        "verified": !is_mismatch,
        "is_mismatch": is_mismatch,
        "registry_id": active_user_id,
        "linked_registry_id": linked_registry_id,
        "reason": if is_mismatch { "mismatch" } else { "ok" }
    }))
}

/// Start the Steam Guardian helper process
#[tauri::command]
pub async fn steam_guardian_start() -> Result<Value, String> {
    // Check if guardian is already running by reading status file
    let data_dir = std::env::temp_dir().join("nyvexa-launcher");
    let status_file = data_dir.join("steam_guardian_status.json");
    
    if status_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&status_file) {
            if let Ok(status) = serde_json::from_str::<serde_json::Value>(&content) {
                if status.get("running").and_then(|v| v.as_bool()).unwrap_or(false) {
                    return Ok(json!({
                        "success": true,
                        "already_running": true,
                        "message": "Guardian đang chạy"
                    }));
                }
            }
        }
    }
    
    // Get executable path
    let exe_path = std::env::current_exe()
        .map_err(|e| e.to_string())?;
    
    let guardian_exe = exe_path.parent()
        .map(|p| p.join("steam_guardian.exe"))
        .ok_or("Không tìm thấy steam_guardian.exe")?;
    
    if !guardian_exe.exists() {
        return Err("steam_guardian.exe không tồn tại".to_string());
    }
    
    // Start the process
    let child = std::process::Command::new(&guardian_exe)
        .arg(&data_dir)
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .spawn()
        .map_err(|e| format!("Không thể khởi động Guardian: {}", e))?;
    
    // Give it a moment to start
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    Ok(json!({
        "success": true,
        "pid": child.id(),
        "message": "Guardian đã được khởi động"
    }))
}

/// Stop the Steam Guardian helper process
#[tauri::command]
pub async fn steam_guardian_stop() -> Result<Value, String> {
    // Kill the guardian process
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "steam_guardian.exe"])
            .creation_flags(0x08000000)
            .output();
    }
    
    Ok(json!({
        "success": true,
        "message": "Guardian đã dừng"
    }))
}

/// Force restart Steam and clear launcher DLLs
#[tauri::command]
pub async fn steam_force_restart_and_clear(state: State<'_, AppState>) -> Result<Value, String> {
    // Get Steam path from state
    let steam_path = {
        let guard = state.steam_path.lock().await;
        guard.clone()
    };
    
    let steam_path = match steam_path {
        Some(p) => p,
        None => {
            // Try to get from registry
            let steam_reg_path = r"SOFTWARE\WOW6432Node\Valve\Steam";
            #[cfg(windows)]
            {
                use winreg::enums::*;
                use winreg::RegKey;
                
                let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
                match hklm.open_subkey(steam_reg_path) {
                    Ok(key) => key.get_value::<String, _>("InstallPath")
                        .map_err(|_| "Không tìm thấy Steam")?,
                    Err(_) => {
                        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
                        match hkcu.open_subkey(steam_reg_path) {
                            Ok(key) => key.get_value::<String, _>("InstallPath")
                                .map_err(|_| "Không tìm thấy Steam")?,
                            Err(_) => return Err("Không tìm thấy đường dẫn Steam".to_string()),
                        }
                    }
                }
            }
            #[cfg(not(windows))]
            {
                return Err("Steam not found".to_string());
            }
        }
    };
    
    // Kill Steam
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "steam.exe"])
            .creation_flags(0x08000000)
            .output();
    }
    
    std::thread::sleep(std::time::Duration::from_secs(2));
    
    // Delete launcher DLLs
    let steam_path_buf = std::path::PathBuf::from(&steam_path);
    for dll in ["xinput1_4.dll", "dwmapi.dll"] {
        let dll_path = steam_path_buf.join(dll);
        if dll_path.exists() {
            // Clear attributes
            #[cfg(windows)]
            {
                let _ = std::process::Command::new("attrib")
                    .args(["-H", "-S", &dll_path.to_string_lossy()])
                    .creation_flags(0x08000000)
                    .output();
            }
            let _ = std::fs::remove_file(&dll_path);
        }
    }
    
    // Restart Steam
    let steam_exe = steam_path_buf.join("Steam.exe");
    if !steam_exe.exists() {
        return Err("Steam.exe không tìm thấy".to_string());
    }
    
    #[cfg(windows)]
    {
        let _ = std::process::Command::new(&steam_exe)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| format!("Không thể khởi động Steam: {}", e))?;
    }
    
    Ok(json!({
        "success": true,
        "message": "Đã khởi động lại Steam và xóa file DLL"
    }))
}

/// Admin: Unlink Steam account from a specific user
#[tauri::command]
pub async fn admin_unlink_steam_account(
    state: State<'_, AppState>,
    target_user_id: String,
) -> Result<Value, String> {
    // Verify admin has permission
    let svc = state.supabase.clone();
    let user_id = svc.get_user_id().await
        .ok_or("Vui lòng đăng nhập")?;
    
    let is_admin = check_is_admin(&svc, &user_id).await
        .unwrap_or(false);
    
    if !is_admin {
        return Err("Không có quyền thực hiện thao tác này".to_string());
    }
    
    let url = format!("{}/rest/v1/steam_links?user_id=eq.{}", svc.config.url, target_user_id);
    
    let client = reqwest::Client::new();
    let _response = client
        .delete(&url)
        .header("apikey", &state.supabase.config.service_key)
        .header("Authorization", format!("Bearer {}", state.supabase.config.service_key))
        .send()
        .await
        .map_err(|e| format!("Không thể hủy liên kết: {}", e))?;
    
    Ok(json!({
        "success": true,
        "message": "Đã hủy liên kết Steam của người dùng"
    }))
}

/// Admin: Get linked Steam account info for a specific user
#[tauri::command]
pub async fn admin_get_user_steam_link(
    state: State<'_, AppState>,
    target_user_id: String,
) -> Result<Value, String> {
    // Verify admin has permission
    let svc = state.supabase.clone();
    let user_id = svc.get_user_id().await
        .ok_or("Vui lòng đăng nhập")?;
    
    let is_admin = check_is_admin(&svc, &user_id).await
        .unwrap_or(false);
    
    if !is_admin {
        return Err("Không có quyền thực hiện thao tác này".to_string());
    }
    
    let url = format!(
        "{}/rest/v1/steam_links?user_id=eq.{}&select=*",
        svc.config.url, target_user_id
    );
    
    match svc.http_get_admin(&url).await {
        Ok(data) => {
            if let Some(links) = data.as_array() {
                if let Some(link) = links.first() {
                    return Ok(json!({
                        "linked": true,
                        "link": {
                            "id": link.get("id"),
                            "registry_id": link.get("registry_id"),
                            "steam_id": link.get("steam_id"),
                            "persona_name": link.get("persona_name"),
                            "avatar_url": link.get("avatar_url"),
                            "linked_at": link.get("linked_at")
                        }
                    }));
                }
            }
            Ok(json!({ "linked": false }))
        }
        Err(e) => Ok(json!({ "linked": false, "error": e })),
    }
}
