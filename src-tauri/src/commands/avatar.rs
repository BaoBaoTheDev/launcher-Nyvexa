/// Avatar system: admin uploads PNG/JPG to Supabase Storage bucket "avatars".
/// User selects → DB stores image_url directly into profiles.avatar_url.
/// Frontend renders <img src={user.avatar_url}> — no local cache, no resolve.

use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

// ─── User commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn avatar_list_presets(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = svc.get_access_token().await
        .ok_or_else(|| "Chưa đăng nhập".to_string())?;
    let url = format!(
        "{}/rest/v1/avatar_presets?is_active=eq.true&select=id,name,image_url,sort_order&order=sort_order.asc,name.asc",
        svc.config.url.trim_end_matches('/')
    );
    match svc.http_get_authed(&url, &token).await {
        Ok(rows) => Ok(json!({ "success": true, "data": rows })),
        Err(e) => Ok(json!({ "success": false, "data": [], "message": e })),
    }
}

// ─── Admin commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn admin_avatar_list(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    if svc.config.service_key.is_empty() { return Err("Thiếu service key".into()); }
    let url = format!(
        "{}/rest/v1/avatar_presets?select=*&order=sort_order.asc,name.asc",
        svc.config.url.trim_end_matches('/')
    );
    svc.http_get_admin(&url).await
}

/// Upload ảnh lên bucket "avatars" + insert vào avatar_presets
#[tauri::command]
pub async fn admin_avatar_upload(
    state: State<'_, AppState>,
    name: String,
    image_data: String,
    mime_type: String,
    sort_order: Option<i32>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    if svc.config.service_key.is_empty() { return Err("Thiếu service key".into()); }

    let name_clean = name.trim().to_string();
    if name_clean.is_empty() { return Err("Tên avatar không được rỗng".into()); }

    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(image_data.trim())
        .map_err(|e| format!("Base64 không hợp lệ: {e}"))?;
    if bytes.len() < 100 { return Err("File quá nhỏ".into()); }
    if bytes.len() > 5 * 1024 * 1024 { return Err("File quá lớn (>5MB)".into()); }

    let ext = match mime_type.as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => return Err(format!("Định dạng không hỗ trợ: {mime_type}")),
    };

    // Upload lên Storage bucket "avatars"
    let object_name = format!("{name_clean}.{ext}");
    let storage_url = format!(
        "{}/storage/v1/object/avatars/{}",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&object_name)
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP client: {e}"))?;

    let resp = client
        .post(&storage_url)
        .header("Authorization", format!("Bearer {}", svc.config.service_key))
        .header("apikey", &svc.config.anon_key)
        .header("Content-Type", &mime_type)
        .header("x-upsert", "true")
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("Upload thất bại: {e}"))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Upload bucket lỗi: {text}"));
    }

    let public_url = format!(
        "{}/storage/v1/object/public/avatars/{}",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&object_name)
    );

    // Upsert vào avatar_presets
    let table_url = format!("{}/rest/v1/avatar_presets", svc.config.url.trim_end_matches('/'));
    let body = json!({
        "name": name_clean,
        "image_url": public_url,
        "sort_order": sort_order.unwrap_or(0),
        "is_active": true,
    });
    svc.http_post_admin_upsert_on_conflict(&table_url, &body, "name").await?;

    Ok(json!({ "success": true, "name": name_clean, "image_url": public_url }))
}

/// Cập nhật sort_order cho nhiều avatar cùng lúc (kéo-thả / nút lên-xuống).
/// items = [{ "id": "...", "sort_order": 0 }, ...]
#[tauri::command]
pub async fn admin_avatar_reorder(
    state: State<'_, AppState>,
    items: Value,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    if svc.config.service_key.is_empty() { return Err("Thiếu service key".into()); }
    let base = svc.config.url.trim_end_matches('/');

    let arr = items.as_array().ok_or("Payload không hợp lệ")?;
    let mut updated = 0i64;
    for it in arr {
        let id = match it.get("id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s,
            _ => continue,
        };
        let order = it.get("sort_order").and_then(|v| v.as_i64()).unwrap_or(0);
        let url = format!(
            "{}/rest/v1/avatar_presets?id=eq.{}",
            base,
            urlencoding::encode(id)
        );
        let body = json!({ "sort_order": order });
        if svc.http_patch_admin(&url, &body).await.is_ok() {
            updated += 1;
        }
    }

    Ok(json!({ "success": true, "updated": updated }))
}

#[tauri::command]
pub async fn admin_avatar_delete(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    if svc.config.service_key.is_empty() { return Err("Thiếu service key".into()); }
    let base = svc.config.url.trim_end_matches('/');

    // Xóa file trong bucket (thử nhiều extension)
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    for ext in &["png", "jpg", "jpeg", "gif", "webp"] {
        let object_name = format!("{}.{}", name, ext);
        let storage_url = format!(
            "{}/storage/v1/object/avatars/{}",
            base,
            urlencoding::encode(&object_name)
        );
        let _ = client
            .delete(&storage_url)
            .header("Authorization", format!("Bearer {}", svc.config.service_key))
            .header("apikey", &svc.config.anon_key)
            .send()
            .await;
    }

    // Xóa row trong table
    let url = format!(
        "{}/rest/v1/avatar_presets?id=eq.{}",
        base,
        urlencoding::encode(&id)
    );
    svc.http_delete_admin(&url).await?;
    Ok(json!({ "success": true }))
}
