/// Hubcap API key management commands
/// CRUD + health check + auto-rotation logic
use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

use crate::state::AppState;

// ─── HTTP helper ──────────────────────────────────────────────────────────────

fn make_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("nyvexa-launcher/2")
        .build()
        .unwrap_or_default()
}

// ─── Check a single key against hubcapmanifest /api/v1/user/stats ─────────────

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct HubcapKeyStats {
    pub alive: bool,
    pub expires_at: Option<String>,
    pub daily_limit: Option<i64>,
    pub used_today: Option<i64>,
    pub remaining: Option<i64>,
    pub raw: Value,
}

/// Gọi GET https://hubcapmanifest.com/api/v1/user/stats với Bearer token
/// Trả về { alive, expires_at, daily_limit, used_today, remaining, raw }
#[tauri::command]
pub async fn hubcap_check_key(api_key: String) -> Result<Value, String> {
    if api_key.trim().is_empty() {
        return Err("API key không được để trống".into());
    }

    let client = make_client();
    let res = client
        .get("https://hubcapmanifest.com/api/v1/user/stats")
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .send()
        .await
        .map_err(|e| format!("Lỗi kết nối hubcap: {e}"))?;

    let status = res.status().as_u16();
    let body: Value = res.json().await.unwrap_or(Value::Null);

    if status == 401 || status == 403 {
        return Ok(json!({
            "alive": false,
            "status": status,
            "reason": "invalid_key",
            "raw": body,
        }));
    }

    if !matches!(status, 200..=299) {
        return Ok(json!({
            "alive": false,
            "status": status,
            "reason": "http_error",
            "raw": body,
        }));
    }

    // Parse thông tin từ response
    // Hubcap có thể trả về nhiều cấu trúc khác nhau — parse linh hoạt
    let expires_at = body.get("expires_at")
        .or_else(|| body.get("expiry"))
        .or_else(|| body.get("expire_at"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let daily_limit = body.get("daily_limit")
        .or_else(|| body.get("limit"))
        .or_else(|| body.get("rate_limit"))
        .and_then(|v| v.as_i64());

    let used_today = body.get("used_today")
        .or_else(|| body.get("requests_today"))
        .or_else(|| body.get("used"))
        .or_else(|| body.get("count"))
        .and_then(|v| v.as_i64());

    let remaining = body.get("remaining")
        .or_else(|| body.get("remaining_requests"))
        .and_then(|v| v.as_i64())
        .or_else(|| {
            // Tính remaining nếu không có trường riêng
            daily_limit.zip(used_today).map(|(lim, used)| (lim - used).max(0))
        });

    Ok(json!({
        "alive": true,
        "status": status,
        "expires_at": expires_at,
        "daily_limit": daily_limit,
        "used_today": used_today,
        "remaining": remaining,
        "raw": body,
    }))
}

// ─── List all keys ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hubcap_list_keys(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    if svc.config.service_key.is_empty() {
        return Err("Thiếu service key Supabase".into());
    }

    let base = svc.config.url.trim_end_matches('/');
    // Che api_key: trả về 4 ký tự đầu + *** để không lộ full key trên UI
    let url = format!(
        "{base}/rest/v1/hubcap_api_keys?select=id,label,is_active,is_locked,locked_at,sort_order,created_at,updated_at,api_key&order=sort_order.asc,created_at.asc"
    );

    let rows = svc
        .http_get_admin(&url)
        .await
        .map_err(|e| format!("Lỗi tải keys: {e}"))?;

    // Mask api_key: chỉ hiện 8 ký tự đầu + *** (tránh lộ full token)
    let masked: Vec<Value> = rows
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|row| {
            let mut r = row.clone();
            if let Some(key) = row.get("api_key").and_then(|v| v.as_str()) {
                let preview = if key.len() > 8 {
                    format!("{}***", &key[..8])
                } else {
                    "***".to_string()
                };
                if let Some(obj) = r.as_object_mut() {
                    obj.insert("api_key_preview".into(), json!(preview));
                    obj.remove("api_key"); // Không gửi full key về frontend
                }
            }
            r
        })
        .collect();

    Ok(json!({ "success": true, "data": masked }))
}

// ─── Add key ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hubcap_add_key(
    state: State<'_, AppState>,
    api_key: String,
    label: String,
    sort_order: Option<i64>,
) -> Result<Value, String> {
    if api_key.trim().is_empty() {
        return Err("API key không được để trống".into());
    }

    let svc = state.supabase.clone();
    if svc.config.service_key.is_empty() {
        return Err("Thiếu service key Supabase".into());
    }

    let base = svc.config.url.trim_end_matches('/');
    let url = format!("{base}/rest/v1/hubcap_api_keys");

    let body = json!({
        "api_key": api_key.trim(),
        "label": label.trim(),
        "sort_order": sort_order.unwrap_or(0),
        "is_active": true,
        "is_locked": false,
    });

    svc.http_post_admin_upsert(&url, &body)
        .await
        .map_err(|e| format!("Lỗi thêm key: {e}"))?;

    Ok(json!({ "success": true }))
}

// ─── Delete key ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hubcap_delete_key(
    state: State<'_, AppState>,
    key_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    if svc.config.service_key.is_empty() {
        return Err("Thiếu service key Supabase".into());
    }

    let base = svc.config.url.trim_end_matches('/');
    let url = format!("{base}/rest/v1/hubcap_api_keys?id=eq.{}", urlencoding::encode(&key_id));

    svc.http_delete_admin(&url)
        .await
        .map_err(|e| format!("Lỗi xóa key: {e}"))?;

    Ok(json!({ "success": true }))
}

// ─── Toggle active ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hubcap_toggle_key(
    state: State<'_, AppState>,
    key_id: String,
    is_active: bool,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    if svc.config.service_key.is_empty() {
        return Err("Thiếu service key Supabase".into());
    }

    let base = svc.config.url.trim_end_matches('/');
    let url = format!("{base}/rest/v1/hubcap_api_keys?id=eq.{}", urlencoding::encode(&key_id));

    svc.http_patch_admin(&url, &json!({ "is_active": is_active }))
        .await
        .map_err(|e| format!("Lỗi cập nhật key: {e}"))?;

    Ok(json!({ "success": true }))
}

// ─── Get active key for lua download (rotation logic) ────────────────────────

/// Lấy API key khả dụng tiếp theo để tải lua.
/// Logic:
///   1. Tự động mở khoá các key đã bị lock > 24h
///   2. Lấy key is_active=true, is_locked=false, sort_order thấp nhất
///   3. Nếu không có key nào → trả lỗi
/// Trả về full api_key (không mask) vì dùng nội bộ trong Rust
#[tauri::command]
pub async fn hubcap_get_active_key(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    if svc.config.service_key.is_empty() {
        return Err("Thiếu service key Supabase".into());
    }

    let base = svc.config.url.trim_end_matches('/');

    // ── Bước 1: Mở khoá key đã lock > 24h ──────────────────────────────────
    let locked_url = format!(
        "{base}/rest/v1/hubcap_api_keys?is_locked=eq.true&is_active=eq.true&select=id,locked_at"
    );

    if let Ok(locked_rows) = svc.http_get_admin(&locked_url).await {
        if let Some(arr) = locked_rows.as_array() {
            let now = chrono::Utc::now();
            for row in arr {
                let id = row.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let locked_at_str = row.get("locked_at").and_then(|v| v.as_str()).unwrap_or("");

                if id.is_empty() || locked_at_str.is_empty() {
                    continue;
                }

                if let Ok(locked_at) = locked_at_str.parse::<chrono::DateTime<chrono::Utc>>() {
                    let elapsed = now - locked_at;
                    if elapsed.num_hours() >= 24 {
                        // Đủ 24h → mở khoá
                        let unlock_url = format!(
                            "{base}/rest/v1/hubcap_api_keys?id=eq.{}",
                            urlencoding::encode(id)
                        );
                        let _ = svc
                            .http_patch_admin(
                                &unlock_url,
                                &json!({ "is_locked": false, "locked_at": null }),
                            )
                            .await;
                    }
                }
            }
        }
    }

    // ── Bước 2: Lấy key khả dụng đầu tiên ──────────────────────────────────
    let url = format!(
        "{base}/rest/v1/hubcap_api_keys?is_active=eq.true&is_locked=eq.false&select=id,api_key,label&order=sort_order.asc,created_at.asc&limit=1"
    );

    let rows = svc
        .http_get_admin(&url)
        .await
        .map_err(|e| format!("Lỗi lấy key: {e}"))?;

    let row = rows
        .as_array()
        .and_then(|a| a.first())
        .cloned()
        .ok_or_else(|| "Hiện tại API đang quá tải, vui lòng liên hệ admin để nhận hỗ trợ".to_string())?;

    Ok(row)
}

// ─── Lock a key (used_today >= daily_limit) ───────────────────────────────────

#[tauri::command]
pub async fn hubcap_lock_key(
    state: State<'_, AppState>,
    key_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    if svc.config.service_key.is_empty() {
        return Err("Thiếu service key Supabase".into());
    }

    let base = svc.config.url.trim_end_matches('/');
    let url = format!("{base}/rest/v1/hubcap_api_keys?id=eq.{}", urlencoding::encode(&key_id));
    let now = chrono::Utc::now().to_rfc3339();

    svc.http_patch_admin(&url, &json!({ "is_locked": true, "locked_at": now }))
        .await
        .map_err(|e| format!("Lỗi lock key: {e}"))?;

    Ok(json!({ "success": true }))
}

// ─── Check key stats và auto-lock nếu hết limit ───────────────────────────────

/// Kiểm tra stats của key đang active:
///   - Nếu remaining == 0 → lock key, trả { exhausted: true, locked_key_id }
///   - Nếu vẫn còn quota → trả stats bình thường
#[tauri::command]
pub async fn hubcap_check_active_key_stats(state: State<'_, AppState>) -> Result<Value, String> {
    // Lấy key active
    let key_res = hubcap_get_active_key(state.clone()).await?;
    let key_id = key_res.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let api_key = key_res.get("api_key").and_then(|v| v.as_str()).unwrap_or("").to_string();

    if api_key.is_empty() {
        return Err("Hiện tại API đang quá tải, vui lòng liên hệ admin để nhận hỗ trợ".into());
    }

    // Kiểm tra stats
    let stats = hubcap_check_key(api_key).await?;

    let alive = stats.get("alive").and_then(|v| v.as_bool()).unwrap_or(false);
    let remaining = stats.get("remaining").and_then(|v| v.as_i64());
    let used_today = stats.get("used_today").and_then(|v| v.as_i64());
    let daily_limit = stats.get("daily_limit").and_then(|v| v.as_i64());

    // Key hết hạn hoặc không alive → lock
    if !alive {
        let _ = hubcap_lock_key(state.clone(), key_id.clone()).await;
        return Ok(json!({
            "exhausted": true,
            "reason": "dead_key",
            "locked_key_id": key_id,
            "stats": stats,
        }));
    }

    // Hết quota → lock
    let exhausted = match (remaining, used_today, daily_limit) {
        (Some(r), _, _) => r <= 0,
        (None, Some(u), Some(l)) => u >= l,
        _ => false,
    };

    if exhausted && !key_id.is_empty() {
        let _ = hubcap_lock_key(state.clone(), key_id.clone()).await;
        return Ok(json!({
            "exhausted": true,
            "reason": "quota_exceeded",
            "locked_key_id": key_id,
            "stats": stats,
        }));
    }

    Ok(json!({
        "exhausted": false,
        "key_id": key_id,
        "stats": stats,
    }))
}
