/// Admin dashboard Tauri commands
/// Dùng service_key (admin headers) để bypass RLS
use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

/// Debug: trả về role trực tiếp từ DB
#[tauri::command]
pub async fn admin_debug_my_role(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = svc.get_access_token().await.ok_or("no token")?;
    let user_id = svc.get_user_id().await.ok_or("no user_id")?;

    // Thử select tối thiểu — cột này chắc chắn tồn tại
    let url = format!(
        "{}/rest/v1/profiles?id=eq.{}&select=id,role,display_name,username,balance",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&user_id)
    );
    let result = svc.http_get_authed(&url, &token).await
        .or_else(|_| {
            // nếu display_name không tồn tại, thử không có
            Ok::<Value, String>(Value::Array(vec![]))
        })?;
    Ok(json!({ "user_id": user_id, "db_result": result }))
}

async fn admin_token(svc: &crate::services::supabase::SupabaseService) -> Result<String, String> {
    svc.get_access_token()
        .await
        .ok_or_else(|| "Chưa đăng nhập".to_string())
}

fn require_service_key(svc: &crate::services::supabase::SupabaseService) -> Result<(), String> {
    if svc.config.service_key.is_empty() {
        Err("Chưa cấu hình Service Role Key".to_string())
    } else {
        Ok(())
    }
}

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

// ─── Users ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn admin_list_users(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let base = svc.config.url.trim_end_matches('/');

    // Thử lần lượt từ nhiều cột → ít cột để tương thích DB thiếu cột.
    // QUAN TRỌNG: mọi biến thể đều phải có `balance` để hiển thị số dư.
    let selects = [
        "id,email,username,display_name,balance,ctv_balance,role,is_banned,steam_exception,created_at",
        "id,email,username,display_name,balance,ctv_balance,role,is_banned,created_at",
        "id,username,display_name,balance,ctv_balance,role,is_banned,created_at",
        "id,username,display_name,balance,role,created_at",
        "id,username,display_name,balance,role",
    ];

    let mut result: Option<Value> = None;
    for sel in selects.iter() {
        let url = format!("{base}/rest/v1/profiles?select={sel}&order=created_at.desc");
        // Một số biến thể không có created_at → bỏ order nếu cần
        let url = if sel.contains("created_at") {
            url
        } else {
            format!("{base}/rest/v1/profiles?select={sel}")
        };
        if let Ok(v) = svc.http_get_admin(&url).await {
            if v.is_array() {
                result = Some(v);
                break;
            }
        }
    }

    let mut rows = result.ok_or_else(|| "Không tải được danh sách người dùng.".to_string())?;

    // Normalize balance: PostgREST trả numeric dạng string "100000.00" → number
    if let Some(arr) = rows.as_array_mut() {
        for row in arr.iter_mut() {
            if let Some(bal) = row.get("balance") {
                let num = bal
                    .as_f64()
                    .or_else(|| bal.as_str().and_then(|s| s.parse::<f64>().ok()))
                    .unwrap_or(0.0);
                row["balance"] = json!(num);
            } else {
                row["balance"] = json!(0.0);
            }
            if let Some(cb) = row.get("ctv_balance") {
                let num = cb
                    .as_f64()
                    .or_else(|| cb.as_str().and_then(|s| s.parse::<f64>().ok()))
                    .unwrap_or(0.0);
                row["ctv_balance"] = json!(num);
            }
        }
    }

    Ok(rows)
}

#[tauri::command]
pub async fn admin_list_user_games(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let url = format!(
        "{}/rest/v1/user_games?user_id=eq.{}&select=game_id,games(id,appid,name,price)",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&user_id)
    );
    let rows = svc.http_get_admin(&url).await?;
    let games: Vec<Value> = rows
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|r| r.get("games").cloned())
        .filter(|v| !v.is_null())
        .collect();
    Ok(Value::Array(games))
}

#[tauri::command]
pub async fn admin_revoke_game(
    state: State<'_, AppState>,
    user_id: String,
    game_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let url = format!(
        "{}/rest/v1/user_games?user_id=eq.{}&game_id=eq.{}",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&user_id),
        urlencoding::encode(&game_id)
    );
    svc.http_delete_admin(&url).await?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn admin_grant_game(
    state: State<'_, AppState>,
    user_id: String,
    game_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let url = format!(
        "{}/rest/v1/user_games",
        svc.config.url.trim_end_matches('/')
    );
    let body = json!({ "user_id": user_id, "game_id": game_id });
    svc.http_post_admin_upsert(&url, &body).await?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn admin_gift_balance(
    state: State<'_, AppState>,
    user_id: String,
    amount: f64,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    // Fetch current balance
    let url = format!(
        "{}/rest/v1/profiles?id=eq.{}&select=balance",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&user_id)
    );
    let rows = svc.http_get_admin(&url).await?;
    let current = rows
        .as_array()
        .and_then(|a| a.first())
        .and_then(|r| r.get("balance"))
        .and_then(|v| {
            // PostgREST trả numeric dạng string "0.00" hoặc number
            v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
        })
        .unwrap_or(0.0);
    let new_balance = (current + amount).max(0.0);
    match svc.set_balance_with_reason(&user_id, new_balance, "admin_gift", None).await {
        Ok(_) => Ok(json!({ "success": true, "new_balance": new_balance })),
        Err(e) => Err(format!("Lỗi cập nhật balance: {e} (current={current}, amount={amount})")),
    }
}

#[tauri::command]
pub async fn admin_set_balance(
    state: State<'_, AppState>,
    user_id: String,
    balance: f64,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    if balance < 0.0 {
        return Err("Số dư không hợp lệ".into());
    }
    match svc.set_balance_with_reason(&user_id, balance.floor(), "admin_set", None).await {
        Ok(_) => Ok(json!({ "success": true })),
        Err(e) => Err(format!("Lỗi set balance: {e}")),
    }
}

#[tauri::command]
pub async fn admin_toggle_ban(
    state: State<'_, AppState>,
    user_id: String,
    is_banned: bool,
    reason: Option<String>,
    duration_hours: Option<f64>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let url = format!(
        "{}/rest/v1/profiles?id=eq.{}",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&user_id)
    );

    let body = if is_banned {
        // Tính ban_until nếu có duration
        let ban_until = duration_hours.and_then(|h| {
            if h > 0.0 {
                let until = chrono::Utc::now() + chrono::Duration::milliseconds((h * 3600.0 * 1000.0) as i64);
                Some(until.to_rfc3339())
            } else {
                None
            }
        });
        json!({
            "is_banned": true,
            "ban_reason": reason.unwrap_or_default(),
            "ban_until": ban_until,
            "banned_at": chrono::Utc::now().to_rfc3339(),
        })
    } else {
        json!({
            "is_banned": false,
            "ban_reason": null,
            "ban_until": null,
            "banned_at": null,
        })
    };

    svc.http_patch_admin(&url, &body).await?;
    Ok(json!({ "success": true }))
}

// ─── Games ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn admin_games_list(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let url = format!(
        "{}/rest/v1/games?select=*&order=purchase_count.desc.nullslast,release_date.desc.nullslast,created_at.desc",
        svc.config.url.trim_end_matches('/')
    );
    svc.http_get_all_pages_admin(&url).await
}

#[tauri::command]
pub async fn admin_games_add(
    state: State<'_, AppState>,
    game: Value,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let url = format!(
        "{}/rest/v1/games",
        svc.config.url.trim_end_matches('/')
    );
    svc.http_post_admin_upsert(&url, &game).await?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn admin_games_update(
    state: State<'_, AppState>,
    id: String,
    patch: Value,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let url = format!(
        "{}/rest/v1/games?id=eq.{}",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&id)
    );
    svc.http_patch_admin(&url, &patch).await?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn admin_games_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let url = format!(
        "{}/rest/v1/games?id=eq.{}",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&id)
    );
    svc.http_delete_admin(&url).await?;
    Ok(json!({ "success": true }))
}

/// Batch update sort_order cho nhiều game cùng lúc.
/// Nhận mảng [{ id, sort_order }] và patch từng game.
#[tauri::command]
pub async fn admin_games_reorder(
    state: State<'_, AppState>,
    items: Vec<Value>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let base = svc.config.url.trim_end_matches('/');
    let mut updated = 0;
    for item in &items {
        let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let order = item.get("sort_order").and_then(|v| v.as_i64());
        if id.is_empty() { continue; }
        let url = format!("{base}/rest/v1/games?id=eq.{}", urlencoding::encode(id));
        let _ = svc.http_patch_admin(&url, &json!({ "sort_order": order })).await;
        updated += 1;
    }
    Ok(json!({ "success": true, "updated": updated }))
}

// ─── DLCs Admin ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn admin_dlcs_list(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let url = format!(
        "{}/rest/v1/dlcs?select=*&order=created_at.desc",
        svc.config.url.trim_end_matches('/')
    );
    svc.http_get_all_pages_admin(&url).await
}

#[tauri::command]
pub async fn admin_dlcs_update(
    state: State<'_, AppState>,
    id: String,
    patch: Value,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let url = format!(
        "{}/rest/v1/dlcs?id=eq.{}",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&id)
    );
    svc.http_patch_admin(&url, &patch).await?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn admin_dlcs_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let url = format!(
        "{}/rest/v1/dlcs?id=eq.{}",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&id)
    );
    svc.http_delete_admin(&url).await?;
    Ok(json!({ "success": true }))
}

/// Áp dụng sale cho nhiều DLC. Logic giống admin_apply_sale.
#[tauri::command]
pub async fn admin_apply_sale_dlc(
    state: State<'_, AppState>,
    dlc_ids: Vec<String>,
    sale_type: String,
    sale_value: f64,
    sale_start: Option<String>,
    sale_end: Option<String>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;

    if dlc_ids.is_empty() {
        return Err("Chưa chọn DLC nào".into());
    }

    let ids_param = dlc_ids.iter()
        .map(|id| format!("\"{}\"", id))
        .collect::<Vec<_>>()
        .join(",");
    let url = format!(
        "{}/rest/v1/dlcs?id=in.({})&select=id,price",
        svc.config.url.trim_end_matches('/'),
        ids_param
    );
    let rows = svc.http_get_admin(&url).await
        .unwrap_or_else(|_| serde_json::Value::Array(vec![]));

    let dlcs: Vec<(String, f64)> = rows.as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|r| {
            let id = r.get("id")?.as_str()?.to_string();
            let price = r.get("price").and_then(|v| v.as_f64()).unwrap_or(0.0);
            Some((id, price))
        })
        .collect();

    let mut errors: Vec<String> = Vec::new();
    let mut ok = 0;

    for (id, current_price) in dlcs {
        let sale_price = match sale_type.as_str() {
            "percent" => {
                let pct = (sale_value / 100.0).clamp(0.0, 1.0);
                (current_price * (1.0 - pct)).round()
            }
            "fixed_price" => sale_value.max(0.0).round(),
            "fixed_amount" => (current_price - sale_value).max(0.0).round(),
            _ => current_price,
        };

        let patch_url = format!(
            "{}/rest/v1/dlcs?id=eq.{}",
            svc.config.url.trim_end_matches('/'),
            urlencoding::encode(&id)
        );

        let mut patch = serde_json::json!({
            "original_price": current_price,
            "price": sale_price,
        });

        if let Some(ref end) = sale_end {
            if !end.is_empty() {
                patch["sale_end_at"] = serde_json::Value::String(end.clone());
            }
        }
        let _ = sale_start;

        match svc.http_patch_admin(&patch_url, &patch).await {
            Ok(_) => ok += 1,
            Err(e) => errors.push(format!("{id}: {e}")),
        }
    }

    Ok(serde_json::json!({
        "success": errors.is_empty(),
        "updated": ok,
        "errors": errors,
    }))
}

/// Gỡ sale cho DLCs
#[tauri::command]
pub async fn admin_remove_sale_dlc(
    state: State<'_, AppState>,
    dlc_ids: Vec<String>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;

    let mut ok = 0;
    let mut errors: Vec<String> = Vec::new();

    for id in &dlc_ids {
        let patch_url = format!(
            "{}/rest/v1/dlcs?id=eq.{}",
            svc.config.url.trim_end_matches('/'),
            urlencoding::encode(id)
        );
        let patch = serde_json::json!({
            "original_price": 0,
            "sale_end_at": serde_json::Value::Null,
        });
        match svc.http_patch_admin(&patch_url, &patch).await {
            Ok(_) => ok += 1,
            Err(e) => errors.push(format!("{id}: {e}")),
        }
    }

    Ok(serde_json::json!({ "success": errors.is_empty(), "updated": ok, "errors": errors }))
}

// ─── Store Assets ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn admin_store_assets_list(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = admin_token(&svc).await?;
    let url = format!(
        "{}/rest/v1/store_assets?select=id,type,image_url,link_url,position&order=position.asc",
        svc.config.url.trim_end_matches('/')
    );
    match svc.http_get_authed(&url, &token).await {
        Ok(v) => Ok(v),
        Err(_) => Ok(Value::Array(vec![])),
    }
}

#[tauri::command]
pub async fn admin_store_assets_add(
    state: State<'_, AppState>,
    asset: Value,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let url = format!(
        "{}/rest/v1/store_assets",
        svc.config.url.trim_end_matches('/')
    );
    svc.http_post_admin_upsert(&url, &asset).await?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn admin_store_assets_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let url = format!(
        "{}/rest/v1/store_assets?id=eq.{}",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&id)
    );
    svc.http_delete_admin(&url).await?;
    Ok(json!({ "success": true }))
}

// ─── Balance Logs ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn admin_balance_logs(
    state: State<'_, AppState>,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let lim = limit.unwrap_or(50).clamp(1, 200);
    let off = offset.unwrap_or(0).max(0);
    let url = format!(
        "{}/rest/v1/balance_logs?select=*&order=created_at.desc&limit={}&offset={}",
        svc.config.url.trim_end_matches('/'),
        lim,
        off
    );
    let logs = svc.http_get_admin(&url).await?;

    // Enrich với thông tin user từ profiles
    let mut user_ids: Vec<String> = logs.as_array()
        .map(|a| a.iter().filter_map(|r| r.get("user_id").and_then(|v| v.as_str()).map(String::from)).collect())
        .unwrap_or_default();
    user_ids.sort();
    user_ids.dedup();

    if user_ids.is_empty() {
        return Ok(logs);
    }

    let ids_csv = user_ids.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(",");
    let profiles_url = format!(
        "{}/rest/v1/profiles?id=in.({})&select=id,display_name,username,email",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&ids_csv)
    );
    let profiles = svc.http_get_admin(&profiles_url).await.unwrap_or(serde_json::json!([]));

    // Map id → profile
    let mut profile_map: std::collections::HashMap<String, serde_json::Value> = std::collections::HashMap::new();
    if let Some(arr) = profiles.as_array() {
        for p in arr {
            if let Some(id) = p.get("id").and_then(|v| v.as_str()) {
                profile_map.insert(id.to_string(), p.clone());
            }
        }
    }

    let mut enriched: Vec<serde_json::Value> = Vec::new();
    if let Some(arr) = logs.as_array() {
        for log in arr {
            let mut log = log.clone();
            let uid = log.get("user_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if let Some(p) = profile_map.get(&uid) {
                if let Some(obj) = log.as_object_mut() {
                    obj.insert("profiles".to_string(), p.clone());
                }
            }
            enriched.push(log);
        }
    }
    Ok(serde_json::Value::Array(enriched))
}

// ─── Analytics ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn admin_get_analytics(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;

    // Total user count
    let users_url = format!(
        "{}/rest/v1/profiles?select=id,role,is_banned,created_at",
        svc.config.url.trim_end_matches('/')
    );
    let users_res = svc.http_get_admin(&users_url).await.unwrap_or(json!([]));
    let users_arr = users_res.as_array().cloned().unwrap_or_default();
    let total_users = users_arr.len();
    let banned_users = users_arr.iter().filter(|u| u.get("is_banned").and_then(|v| v.as_bool()).unwrap_or(false)).count();

    // Game count
    let games_url = format!(
        "{}/rest/v1/games?select=id&order=id",
        svc.config.url.trim_end_matches('/')
    );
    let games_res = svc.http_get_admin(&games_url).await.unwrap_or(json!([]));
    let total_games = games_res.as_array().map(|a| a.len()).unwrap_or(0);

    // Recent purchases (last 50)
    let ug_url = format!(
        "{}/rest/v1/user_games?select=game_id,created_at,games(name,appid)&order=created_at.desc&limit=50",
        svc.config.url.trim_end_matches('/')
    );
    let ug_res = svc.http_get_admin(&ug_url).await.unwrap_or(json!([]));

    // Top games by purchase count
    let top_url = format!(
        "{}/rest/v1/games?select=id,name,appid,purchase_count&order=purchase_count.desc&limit=5",
        svc.config.url.trim_end_matches('/')
    );
    let top_games = svc.http_get_admin(&top_url).await.unwrap_or(json!([]));

    Ok(json!({
        "success": true,
        "data": {
            "total_users": total_users,
            "banned_users": banned_users,
            "total_games": total_games,
            "recent_purchases": ug_res,
            "top_games": top_games,
        }
    }))
}

// ─── Sale ─────────────────────────────────────────────────────────────────────

/// Áp dụng sale cho nhiều game cùng lúc.
/// sale_type: "percent" | "fixed_price" | "fixed_amount"
/// sale_value: % giảm / giá còn lại / số tiền giảm
/// sale_start, sale_end: ISO string hoặc null
#[tauri::command]
pub async fn admin_apply_sale(
    state: State<'_, AppState>,
    game_ids: Vec<String>,
    sale_type: String,
    sale_value: f64,
    sale_start: Option<String>,
    sale_end: Option<String>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;

    if game_ids.is_empty() {
        return Err("Chưa chọn game nào".into());
    }

    // Lấy price hiện tại của các game được chọn
    let ids_param = game_ids.iter()
        .map(|id| format!("\"{}\"", id))
        .collect::<Vec<_>>()
        .join(",");
    let url = format!(
        "{}/rest/v1/games?id=in.({})&select=id,price",
        svc.config.url.trim_end_matches('/'),
        ids_param
    );
    let rows = svc.http_get_admin(&url).await
        .unwrap_or_else(|_| serde_json::Value::Array(vec![]));

    let games: Vec<(String, f64)> = rows.as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|r| {
            let id = r.get("id")?.as_str()?.to_string();
            let price = r.get("price").and_then(|v| v.as_f64()).unwrap_or(0.0);
            Some((id, price))
        })
        .collect();

    let mut errors: Vec<String> = Vec::new();
    let mut ok = 0;

    for (id, current_price) in games {
        let sale_price = match sale_type.as_str() {
            "percent" => {
                let pct = (sale_value / 100.0).clamp(0.0, 1.0);
                (current_price * (1.0 - pct)).round()
            }
            "fixed_price" => sale_value.max(0.0).round(),
            "fixed_amount" => (current_price - sale_value).max(0.0).round(),
            _ => current_price,
        };

        let patch_url = format!(
            "{}/rest/v1/games?id=eq.{}",
            svc.config.url.trim_end_matches('/'),
            urlencoding::encode(&id)
        );

        let mut patch = serde_json::json!({
            "original_price": current_price,
            "price": sale_price,
        });

        if let Some(ref start) = sale_start {
            if !start.is_empty() {
                patch["sale_start_at"] = serde_json::Value::String(start.clone());
            }
        }
        if let Some(ref end) = sale_end {
            if !end.is_empty() {
                patch["sale_end_at"] = serde_json::Value::String(end.clone());
            }
        }

        match svc.http_patch_admin(&patch_url, &patch).await {
            Ok(_) => ok += 1,
            Err(e) => errors.push(format!("{id}: {e}")),
        }
    }

    Ok(serde_json::json!({
        "success": errors.is_empty(),
        "updated": ok,
        "errors": errors,
    }))
}

/// Gỡ sale — reset original_price về null, price giữ nguyên
#[tauri::command]
pub async fn admin_remove_sale(
    state: State<'_, AppState>,
    game_ids: Vec<String>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;

    let mut ok = 0;
    let mut errors: Vec<String> = Vec::new();

    for id in &game_ids {
        let patch_url = format!(
            "{}/rest/v1/games?id=eq.{}",
            svc.config.url.trim_end_matches('/'),
            urlencoding::encode(id)
        );
        let patch = serde_json::json!({
            "original_price": serde_json::Value::Null,
            "sale_end_at": serde_json::Value::Null,
            "sale_start_at": serde_json::Value::Null,
        });
        match svc.http_patch_admin(&patch_url, &patch).await {
            Ok(_) => ok += 1,
            Err(e) => errors.push(format!("{id}: {e}")),
        }
    }

    Ok(serde_json::json!({ "success": errors.is_empty(), "updated": ok, "errors": errors }))
}

// ─── App Settings ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn admin_get_app_settings(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let url = format!(
        "{}/rest/v1/app_settings?select=key,value",
        svc.config.url.trim_end_matches('/')
    );
    let rows = svc.http_get_admin(&url).await.unwrap_or(json!([]));
    let settings: serde_json::Map<String, Value> = rows
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|r| {
            let k = r.get("key")?.as_str()?.to_string();
            let v = r.get("value").cloned()?;
            Some((k, v))
        })
        .collect();
    Ok(json!({ "success": true, "settings": settings }))
}

#[tauri::command]
pub async fn admin_save_app_settings(
    state: State<'_, AppState>,
    settings: Value,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let allowed = ["download_url", "latest_version", "min_version"];
    let obj = settings.as_object().ok_or("Payload không hợp lệ")?;
    let rows: Vec<Value> = allowed
        .iter()
        .filter_map(|k| {
            obj.get(*k).map(|v| json!({ "key": k, "value": v }))
        })
        .collect();
    if rows.is_empty() {
        return Err("Không có cài đặt hợp lệ".into());
    }
    let url = format!(
        "{}/rest/v1/app_settings",
        svc.config.url.trim_end_matches('/')
    );
    let body = Value::Array(rows);
    svc.http_post_admin_upsert_on_conflict(&url, &body, "key").await?;
    Ok(json!({ "success": true }))
}

// ─── Rescan genres cho toàn bộ game ───────────────────────────────────────────

/// Quét lại và fetch thể loại cho tất cả game (hoặc chỉ game thiếu thể loại).
/// Trả về số game đã cập nhật.
#[tauri::command]
pub async fn admin_rescan_genres(
    state: State<'_, AppState>,
    only_missing: Option<bool>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let base = svc.config.url.trim_end_matches('/').to_string();
    let only_missing = only_missing.unwrap_or(false);

    // Lấy toàn bộ game
    let list_url = format!("{base}/rest/v1/games?select=id,appid,genres");
    let games = svc.http_get_admin(&list_url).await
        .map_err(|e| format!("Lỗi tải danh sách game: {e}"))?;
    let arr = games.as_array().cloned().unwrap_or_default();

    let mut updated = 0i64;
    let mut failed = 0i64;
    let mut skipped = 0i64;

    for g in arr {
        let appid = g.get("appid").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let id = g.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if appid.is_empty() || id.is_empty() { continue; }

        // Nếu chỉ quét game thiếu thể loại
        if only_missing {
            let cur = g.get("genres").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            if !cur.is_empty() {
                skipped += 1;
                continue;
            }
        }

        match crate::commands::steam_fetch::fetch_steam_game_data(&appid).await {
            Ok(data) => {
                let genres = data.get("genres").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                if genres.is_empty() { failed += 1; continue; }
                let patch_url = format!("{base}/rest/v1/games?id=eq.{}", urlencoding::encode(&id));
                match svc.http_patch_admin(&patch_url, &json!({ "genres": genres })).await {
                    Ok(_) => updated += 1,
                    Err(_) => failed += 1,
                }
            }
            Err(_) => failed += 1,
        }
    }

    Ok(json!({
        "success": true,
        "updated": updated,
        "failed": failed,
        "skipped": skipped,
    }))
}

// ─── Discount code redemptions (admin) ───────────────────────────────────────

/// Lấy danh sách user đã dùng mã giảm giá cụ thể.
#[tauri::command]
pub async fn admin_discount_redemptions(
    state: State<'_, AppState>,
    code_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let base = svc.config.url.trim_end_matches('/');

    let url = format!(
        "{base}/rest/v1/discount_code_redemptions?code_id=eq.{}&select=id,user_id,order_type,order_id,order_amount,discount_amount,used_at&order=used_at.desc",
        urlencoding::encode(&code_id)
    );
    let mut rows: Vec<Value> = svc.http_get_admin(&url).await
        .unwrap_or(json!([]))
        .as_array()
        .cloned()
        .unwrap_or_default();

    // Enrich với username từ profiles
    for row in rows.iter_mut() {
        let uid = row.get("user_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if !uid.is_empty() {
            let pu = format!(
                "{base}/rest/v1/profiles?id=eq.{}&select=username,display_name&limit=1",
                urlencoding::encode(&uid)
            );
            if let Ok(ps) = svc.http_get_admin(&pu).await {
                if let Some(p) = ps.as_array().and_then(|a| a.first()) {
                    if let Some(obj) = row.as_object_mut() {
                        obj.insert("username".to_string(), p.get("username").cloned().unwrap_or(json!(null)));
                        obj.insert("display_name".to_string(), p.get("display_name").cloned().unwrap_or(json!(null)));
                    }
                }
            }
        }
        // Enrich game name nếu order_type = game
        let order_type = row.get("order_type").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let order_id = row.get("order_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if order_type == "game" && !order_id.is_empty() {
            let gu = format!(
                "{base}/rest/v1/games?id=eq.{}&select=name&limit=1",
                urlencoding::encode(&order_id)
            );
            if let Ok(gs) = svc.http_get_admin(&gu).await {
                if let Some(g) = gs.as_array().and_then(|a| a.first()) {
                    if let Some(obj) = row.as_object_mut() {
                        obj.insert("game_name".to_string(), g.get("name").cloned().unwrap_or(json!(null)));
                    }
                }
            }
        } else if order_type == "dlc" && !order_id.is_empty() {
            let du = format!(
                "{base}/rest/v1/dlcs?appid=eq.{}&select=name&limit=1",
                urlencoding::encode(&order_id)
            );
            if let Ok(ds) = svc.http_get_admin(&du).await {
                if let Some(d) = ds.as_array().and_then(|a| a.first()) {
                    if let Some(obj) = row.as_object_mut() {
                        obj.insert("game_name".to_string(), d.get("name").cloned().unwrap_or(json!(null)));
                    }
                }
            }
        }
    }

    Ok(json!({ "success": true, "data": rows }))
}

// ─── Grant game to user (payer) ───────────────────────────────────────────────

/// Thêm game vào thư viện của user. Dùng bởi payer.
#[tauri::command]
pub async fn admin_grant_game_to_user(
    state: State<'_, AppState>,
    user_id: String,
    game_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let base = svc.config.url.trim_end_matches('/');

    // Kiểm tra đã có chưa
    let check_url = format!(
        "{base}/rest/v1/user_games?user_id=eq.{}&game_id=eq.{}&select=id&limit=1",
        urlencoding::encode(&user_id),
        urlencoding::encode(&game_id)
    );
    let existing = svc.http_get_admin(&check_url).await.unwrap_or(json!([]));
    if existing.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
        return Ok(json!({ "success": true, "skipped": true, "reason": "already_owned" }));
    }

    let url = format!("{base}/rest/v1/user_games");
    svc.http_post_admin_upsert(&url, &json!({ "user_id": user_id, "game_id": game_id })).await?;
    Ok(json!({ "success": true }))
}

// ─── Analytics v2 ─────────────────────────────────────────────────────────────

/// Analytics mở rộng: doanh thu tháng này, tổng doanh thu, tổng hoa hồng referral.
/// Chỉ tính deposits tự động (user tự nạp tiền qua QR) — không tính payer gift/set.
#[tauri::command]
pub async fn admin_get_analytics_v2(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let base = svc.config.url.trim_end_matches('/');

    // Doanh thu từ deposits: chỉ lấy status=PAID, tính pay_amount (số tiền thực user trả)
    let deposits_url = format!(
        "{base}/rest/v1/deposits?select=pay_amount,created_at&status=eq.PAID&order=created_at.desc"
    );
    let deposits = svc.http_get_admin(&deposits_url).await.unwrap_or(json!([]));
    let deposits_arr = deposits.as_array().cloned().unwrap_or_default();

    // Tháng hiện tại
    let now = chrono::Utc::now();
    let year = now.format("%Y").to_string();
    let month = now.format("%m").to_string();
    let month_start_str = format!("{year}-{month}-01T00:00:00Z");
    let month_start = chrono::DateTime::parse_from_rfc3339(&month_start_str)
        .unwrap_or_else(|_| now.fixed_offset())
        .with_timezone(&chrono::Utc);

    let mut revenue_this_month: i64 = 0;
    let mut revenue_total: i64 = 0;
    for d in &deposits_arr {
        let pay = d.get("pay_amount")
            .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
            .unwrap_or(0.0)
            .floor() as i64;
        revenue_total += pay;

        if let Some(ts) = d.get("created_at").and_then(|v| v.as_str()) {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
                if dt.with_timezone(&chrono::Utc) >= month_start {
                    revenue_this_month += pay;
                }
            }
        }
    }

    // Tổng hoa hồng referral (tất cả chủ mã cộng lại)
    let ref_url = format!("{base}/rest/v1/referral_codes?select=total_earned");
    let ref_rows = svc.http_get_admin(&ref_url).await.unwrap_or(json!([]));
    let total_referral_earned: i64 = ref_rows.as_array().unwrap_or(&vec![])
        .iter()
        .filter_map(|r| r.get("total_earned").and_then(|v| v.as_i64()))
        .sum();

    Ok(json!({
        "success": true,
        "revenue_this_month": revenue_this_month,
        "revenue_total": revenue_total,
        "total_referral_earned": total_referral_earned,
        "deposit_count_this_month": deposits_arr.iter().filter(|d| {
            d.get("created_at").and_then(|v| v.as_str())
                .and_then(|ts| chrono::DateTime::parse_from_rfc3339(ts).ok())
                .map(|dt| dt.with_timezone(&chrono::Utc) >= month_start)
                .unwrap_or(false)
        }).count(),
    }))
}

// ─── Discord webhooks ─────────────────────────────────────────────────────────

async fn send_discord_webhook_url(svc: &crate::services::supabase::SupabaseService, url: &str, payload: &Value) {
    if url.is_empty() { return; }
    // Dùng reqwest client trực tiếp qua http helper có sẵn — tạo client mới vì svc.client private
    let client = reqwest::Client::new();
    let _ = client.post(url).json(payload).send().await;
}

/// Gửi thông báo Discord khi game mới được thêm.
/// Gọi ngay sau admin_games_add thành công.
#[tauri::command]
pub async fn discord_notify_new_game(
    state: State<'_, AppState>,
    game_name: String,
    appid: String,
    price: f64,
    header_image: Option<String>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    // Đọc webhook URL từ config (lấy từ .env secret, không lưu DB)
    let webhook_url = svc.config.discord_webhook_new_game.clone();
    if webhook_url.is_empty() { return Ok(json!({ "success": true, "skipped": true })); }

    let price_str = if price == 0.0 { "Miễn phí".to_string() } else { format!("{} ₫", price as i64) };
    let store_url = format!("https://store.steampowered.com/app/{appid}");

    let mut embed = json!({
        "title": format!("🎮 Game mới: {}", game_name),
        "description": format!("**{}** vừa được thêm vào Nyvexa Launcher!\n💰 Giá: **{}**", game_name, price_str),
        "url": store_url,
        "color": 3447003,
        "footer": { "text": "Nyvexa Launcher" }
    });

    if let Some(img) = header_image {
        if !img.is_empty() {
            embed["image"] = json!({ "url": img });
        }
    }

    let payload = json!({ "embeds": [embed] });
    send_discord_webhook_url(&svc, &webhook_url, &payload).await;
    Ok(json!({ "success": true }))
}

/// Gửi thông báo Discord khi có sale hoặc voucher mới.
#[tauri::command]
pub async fn discord_notify_sale(
    state: State<'_, AppState>,
    title: String,
    description: String,
    color: Option<u32>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    // Đọc webhook URL từ config (lấy từ .env secret, không lưu DB)
    let webhook_url = svc.config.discord_webhook_sale.clone();
    if webhook_url.is_empty() { return Ok(json!({ "success": true, "skipped": true })); }

    let embed = json!({
        "title": title,
        "description": description,
        "color": color.unwrap_or(15844367),
        "footer": { "text": "Nyvexa Launcher" }
    });
    let payload = json!({ "embeds": [embed] });
    send_discord_webhook_url(&svc, &webhook_url, &payload).await;
    Ok(json!({ "success": true }))
}

// ─── Balance logs v2 (with filters) ──────────────────────────────────────────

/// Balance logs với bộ lọc: direction (in/out), source (auto/manual), username search.
#[tauri::command]
pub async fn admin_balance_logs_v2(
    state: State<'_, AppState>,
    limit: Option<i32>,
    offset: Option<i32>,
    direction: Option<String>, // "in" | "out" | null
    source: Option<String>,    // "auto" | "manual" | null
    username: Option<String>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let base = svc.config.url.trim_end_matches('/');
    let lim = limit.unwrap_or(50).clamp(1, 200);
    let off = offset.unwrap_or(0).max(0);

    // Nếu có username filter → tìm user_id trước
    let user_id_filter: Option<String> = if let Some(ref uname) = username {
        if !uname.trim().is_empty() {
            let q = uname.trim().to_lowercase();
            let pu = format!(
                "{base}/rest/v1/profiles?or=(username.ilike.*{q}*,display_name.ilike.*{q}*,email.ilike.*{q}*)&select=id&limit=20",
            );
            let profiles = svc.http_get_admin(&pu).await.unwrap_or(json!([]));
            let ids: Vec<String> = profiles.as_array().unwrap_or(&vec![])
                .iter()
                .filter_map(|p| p.get("id").and_then(|v| v.as_str()).map(String::from))
                .collect();
            if ids.is_empty() {
                // Không tìm thấy user → trả về rỗng ngay
                return Ok(json!({ "success": true, "data": [], "total": 0 }));
            }
            Some(ids.join(","))
        } else { None }
    } else { None };

    // Build query
    let mut filters = Vec::new();
    if let Some(dir) = &direction {
        match dir.as_str() {
            "in"  => filters.push("amount=gte.0".to_string()),
            "out" => filters.push("amount=lt.0".to_string()),
            _ => {}
        }
    }
    if let Some(src) = &source {
        match src.as_str() {
            // Tự động = user tự nạp tiền (deposit) hoặc mua game/DLC
            "auto"   => filters.push("reason=in.(deposit,wallet_topup,topup,purchase_game,purchase_dlc)".to_string()),
            // Thủ công = payer tặng tiền hoặc set tiền
            "manual" => filters.push("reason=in.(admin_gift,admin_set)".to_string()),
            _ => {}
        }
    }
    if let Some(ids) = &user_id_filter {
        filters.push(format!("user_id=in.({})", ids));
    }

    let filter_str = if filters.is_empty() { String::new() } else { format!("&{}", filters.join("&")) };
    let url = format!(
        "{base}/rest/v1/balance_logs?select=*&order=created_at.desc&limit={lim}&offset={off}{filter_str}"
    );

    let logs = svc.http_get_admin(&url).await?;

    // Enrich với profile
    let mut user_ids: Vec<String> = logs.as_array()
        .map(|a| a.iter()
            .filter_map(|r| r.get("user_id").and_then(|v| v.as_str()).map(String::from))
            .collect())
        .unwrap_or_default();
    user_ids.sort(); user_ids.dedup();

    let mut profile_map: std::collections::HashMap<String, Value> = Default::default();
    if !user_ids.is_empty() {
        let ids_csv = user_ids.join(",");
        let pu = format!(
            "{base}/rest/v1/profiles?id=in.({})&select=id,display_name,username,email",
            urlencoding::encode(&ids_csv)
        );
        if let Ok(ps) = svc.http_get_admin(&pu).await {
            for p in ps.as_array().unwrap_or(&vec![]) {
                if let Some(id) = p.get("id").and_then(|v| v.as_str()) {
                    profile_map.insert(id.to_string(), p.clone());
                }
            }
        }
    }

    let enriched: Vec<Value> = logs.as_array().unwrap_or(&vec![]).iter().map(|log| {
        let mut log = log.clone();
        let uid = log.get("user_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if let Some(p) = profile_map.get(&uid) {
            if let Some(obj) = log.as_object_mut() {
                obj.insert("profiles".to_string(), p.clone());
            }
        }
        log
    }).collect();

    Ok(json!({ "success": true, "data": enriched }))
}

/// Lấy chi tiết biến động số dư (hành động gây ra biến động).
#[tauri::command]
pub async fn admin_balance_log_detail(
    state: State<'_, AppState>,
    log_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    require_service_key(&svc)?;
    let base = svc.config.url.trim_end_matches('/');

    // Lấy log
    let log_url = format!(
        "{base}/rest/v1/balance_logs?id=eq.{}&select=*&limit=1",
        urlencoding::encode(&log_id)
    );
    let logs = svc.http_get_admin(&log_url).await?;
    let log = logs.as_array().and_then(|a| a.first()).cloned()
        .ok_or("Không tìm thấy log.")?;

    let user_id = log.get("user_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let reason = log.get("reason").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let reference_id = log.get("reference_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let amount = log.get("amount").and_then(|v| v.as_i64()).unwrap_or(0);
    let created_at = log.get("created_at").and_then(|v| v.as_str()).unwrap_or("").to_string();

    // Lấy thông tin user
    let profile_url = format!(
        "{base}/rest/v1/profiles?id=eq.{}&select=username,display_name,email&limit=1",
        urlencoding::encode(&user_id)
    );
    let profile = svc.http_get_admin(&profile_url).await.unwrap_or(json!([]))
        .as_array().and_then(|a| a.first()).cloned().unwrap_or(json!({}));

    let mut detail = json!({
        "log": log,
        "user": profile,
        "reason": reason,
        "amount": amount,
        "created_at": created_at,
        "reference_id": reference_id,
        "action_detail": null,
    });

    // Lấy chi tiết hành động dựa vào reason + reference_id
    match reason.as_str() {
        "purchase" | "purchase_game" | "game_purchase" => {
            // reference_id = game_id (UUID)
            if !reference_id.is_empty() {
                // Tìm game name
                let game_url = format!(
                    "{base}/rest/v1/games?id=eq.{}&select=id,name,appid,price&limit=1",
                    urlencoding::encode(&reference_id)
                );
                let games = svc.http_get_admin(&game_url).await.unwrap_or(json!([]));
                let game = games.as_array().and_then(|a| a.first()).cloned().unwrap_or(json!({}));

                // Tìm user_games để lấy created_at
                let ug_url = format!(
                    "{base}/rest/v1/user_games?user_id=eq.{}&game_id=eq.{}&select=created_at&limit=1",
                    urlencoding::encode(&user_id),
                    urlencoding::encode(&reference_id)
                );
                let ug = svc.http_get_admin(&ug_url).await.unwrap_or(json!([]));
                let purchase_time = ug.as_array().and_then(|a| a.first())
                    .and_then(|r| r.get("created_at")).cloned();

                detail["action_detail"] = json!({
                    "type": "game_purchase",
                    "game_id": reference_id,
                    "game_name": game.get("name"),
                    "game_appid": game.get("appid"),
                    "purchase_time": purchase_time,
                });
            }
        }
        "purchase_dlc" => {
            // reference_id = dlc_appid
            if !reference_id.is_empty() {
                let dlc_url = format!(
                    "{base}/rest/v1/dlcs?appid=eq.{}&select=appid,name,base_appid&limit=1",
                    urlencoding::encode(&reference_id)
                );
                let dlcs = svc.http_get_admin(&dlc_url).await.unwrap_or(json!([]));
                let dlc = dlcs.as_array().and_then(|a| a.first()).cloned().unwrap_or(json!({}));
                detail["action_detail"] = json!({
                    "type": "dlc_purchase",
                    "dlc_appid": reference_id,
                    "dlc_name": dlc.get("name"),
                    "base_appid": dlc.get("base_appid"),
                });
            }
        }
        "deposit" | "wallet_topup" | "topup" => {
            if !reference_id.is_empty() {
                let dep_url = format!(
                    "{base}/rest/v1/deposits?id=eq.{}&select=amount,pay_amount,order_code,status,created_at,discount_code,discount_amount&limit=1",
                    urlencoding::encode(&reference_id)
                );
                let dep = svc.http_get_admin(&dep_url).await.unwrap_or(json!([]));
                if let Some(row) = dep.as_array().and_then(|a| a.first()) {
                    detail["action_detail"] = json!({
                        "type": "deposit",
                        "deposit": row,
                    });
                }
            }
        }
        "admin_gift" => {
            detail["action_detail"] = json!({
                "type": "admin_gift",
                "description": "Payer tặng/trừ số dư thủ công",
            });
        }
        "admin_set" => {
            detail["action_detail"] = json!({
                "type": "admin_set",
                "description": "Payer đặt số dư chính xác",
            });
        }
        _ => {}
    }

    // Kiểm tra có dùng mã giảm giá không (chỉ check khi mua game/DLC)
    if !user_id.is_empty() && !reference_id.is_empty()
        && (reason == "purchase_game" || reason == "purchase_dlc" || reason == "purchase" || reason == "game_purchase")
    {
        let dcr_url = format!(
            "{base}/rest/v1/discount_code_redemptions?user_id=eq.{}&order_id=eq.{}&select=discount_amount,order_amount,discount_codes(code,name)&limit=1",
            urlencoding::encode(&user_id),
            urlencoding::encode(&reference_id)
        );
        let dcr = svc.http_get_admin(&dcr_url).await.unwrap_or(json!([]));
        if let Some(row) = dcr.as_array().and_then(|a| a.first()) {
            let code = row.get("discount_codes").and_then(|v| v.get("code")).cloned();
            let name = row.get("discount_codes").and_then(|v| v.get("name")).cloned();
            detail["discount_used"] = json!({
                "code": code,
                "name": name,
                "discount_amount": row.get("discount_amount"),
                "order_amount": row.get("order_amount"),
            });
        }
    }

    Ok(detail)
}
