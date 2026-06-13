/// Discount codes — quản lý + áp dụng mã giảm giá
use serde_json::{json, Value};
use tauri::State;
use crate::state::AppState;

/// Validate + apply mã giảm giá (game/dlc, không phải deposit)
/// Returns: { success, code, type, value, discount_amount, final_amount, message? }
#[tauri::command]
pub async fn discount_validate(
    state: State<'_, AppState>,
    code: String,
    order_type: String,           // "game" | "dlc"
    order_amount: f64,
    game_id: Option<String>,      // ID của game/dlc trong DB
    is_on_sale: bool,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = svc.get_access_token().await
        .ok_or_else(|| "Chưa đăng nhập".to_string())?;

    let code_upper = code.trim().to_uppercase();
    if code_upper.is_empty() {
        return Ok(json!({ "success": false, "message": "Mã giảm giá rỗng" }));
    }

    let url = format!(
        "{}/rest/v1/discount_codes?code=eq.{}&select=*&limit=1",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&code_upper)
    );

    let rows = svc.http_get_authed(&url, &token).await
        .map_err(|e| format!("Lỗi tải mã: {e}"))?;

    let dc = match rows.as_array().and_then(|a| a.first()) {
        Some(d) => d,
        None => return Ok(json!({ "success": false, "message": "Mã giảm giá không tồn tại" })),
    };

    let is_active = dc.get("is_active").and_then(|v| v.as_bool()).unwrap_or(false);
    if !is_active {
        return Ok(json!({ "success": false, "message": "Mã giảm giá đã bị vô hiệu hóa" }));
    }

    // Check expires
    if let Some(exp_str) = dc.get("expires_at").and_then(|v| v.as_str()) {
        if !exp_str.is_empty() {
            // Compare with now
            if let Ok(exp) = chrono::DateTime::parse_from_rfc3339(exp_str) {
                if exp.with_timezone(&chrono::Utc) < chrono::Utc::now() {
                    return Ok(json!({ "success": false, "message": "Mã giảm giá đã hết hạn" }));
                }
            }
        }
    }

    // Check type — không cho phép dùng deposit_* cho game/dlc
    let dc_type = dc.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if dc_type == "deposit_fixed" || dc_type == "deposit_percent" {
        return Ok(json!({ "success": false, "message": "Mã giảm giá này chỉ áp dụng cho nạp tiền" }));
    }

    if order_type != "game" && order_type != "dlc" {
        return Ok(json!({ "success": false, "message": "Loại đơn không hỗ trợ" }));
    }

    // Check max uses
    let max_uses = dc.get("max_uses").and_then(|v| v.as_i64());
    let current_uses = dc.get("current_uses").and_then(|v| v.as_i64()).unwrap_or(0);
    if let Some(mu) = max_uses {
        if current_uses >= mu {
            return Ok(json!({ "success": false, "message": "Mã đã hết lượt sử dụng" }));
        }
    }

    // Check applies_to_sale
    let applies_to_sale = dc.get("applies_to_sale").and_then(|v| v.as_bool()).unwrap_or(true);
    if is_on_sale && !applies_to_sale {
        return Ok(json!({ "success": false, "message": "Mã không áp dụng cho game đang sale" }));
    }

    // Check applies_to_all + applicable_game_ids
    let applies_to_all = dc.get("applies_to_all").and_then(|v| v.as_bool()).unwrap_or(true);
    if !applies_to_all {
        let allowed: Vec<String> = dc.get("applicable_game_ids")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let gid = game_id.unwrap_or_default();
        if gid.is_empty() || !allowed.contains(&gid) {
            return Ok(json!({ "success": false, "message": "Mã không áp dụng cho sản phẩm này" }));
        }
    }

    // Check min/max price
    let min_price = dc.get("min_price").and_then(|v| v.as_f64());
    let max_price = dc.get("max_price").and_then(|v| v.as_f64());
    if let Some(mp) = min_price {
        if order_amount < mp {
            return Ok(json!({
                "success": false,
                "message": format!("Mã yêu cầu đơn từ {} ₫", format_vnd(mp as i64))
            }));
        }
    }
    if let Some(mp) = max_price {
        if order_amount > mp {
            return Ok(json!({
                "success": false,
                "message": format!("Mã chỉ áp dụng cho đơn dưới {} ₫", format_vnd(mp as i64))
            }));
        }
    }

    // Compute discount
    let value = dc.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let discount_amount = match dc_type {
        "fixed" => value.min(order_amount).max(0.0),
        "percent" => {
            let pct = (value / 100.0).clamp(0.0, 1.0);
            (order_amount * pct).round()
        }
        _ => 0.0,
    };

    let final_amount = (order_amount - discount_amount).max(0.0);

    Ok(json!({
        "success": true,
        "code_id": dc.get("id"),
        "code": code_upper,
        "name": dc.get("name"),
        "type": dc_type,
        "value": value,
        "discount_amount": discount_amount,
        "final_amount": final_amount,
        "original_amount": order_amount,
    }))
}

/// Validate mã cho deposit (chỉ deposit_*)
#[tauri::command]
pub async fn discount_validate_deposit(
    state: State<'_, AppState>,
    code: String,
    deposit_amount: f64,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = svc.get_access_token().await
        .ok_or_else(|| "Chưa đăng nhập".to_string())?;

    let code_upper = code.trim().to_uppercase();
    if code_upper.is_empty() {
        return Ok(json!({ "success": false, "message": "Mã giảm giá rỗng" }));
    }

    let url = format!(
        "{}/rest/v1/discount_codes?code=eq.{}&select=*&limit=1",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&code_upper)
    );

    let rows = svc.http_get_authed(&url, &token).await
        .map_err(|e| format!("Lỗi tải mã: {e}"))?;

    let dc = match rows.as_array().and_then(|a| a.first()) {
        Some(d) => d,
        None => return Ok(json!({ "success": false, "message": "Mã giảm giá không tồn tại" })),
    };

    let is_active = dc.get("is_active").and_then(|v| v.as_bool()).unwrap_or(false);
    if !is_active {
        return Ok(json!({ "success": false, "message": "Mã đã vô hiệu hóa" }));
    }

    if let Some(exp_str) = dc.get("expires_at").and_then(|v| v.as_str()) {
        if !exp_str.is_empty() {
            if let Ok(exp) = chrono::DateTime::parse_from_rfc3339(exp_str) {
                if exp.with_timezone(&chrono::Utc) < chrono::Utc::now() {
                    return Ok(json!({ "success": false, "message": "Mã đã hết hạn" }));
                }
            }
        }
    }

    let dc_type = dc.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if dc_type != "deposit_fixed" && dc_type != "deposit_percent" {
        return Ok(json!({ "success": false, "message": "Mã này không áp dụng cho nạp tiền" }));
    }

    let max_uses = dc.get("max_uses").and_then(|v| v.as_i64());
    let current_uses = dc.get("current_uses").and_then(|v| v.as_i64()).unwrap_or(0);
    if let Some(mu) = max_uses {
        if current_uses >= mu {
            return Ok(json!({ "success": false, "message": "Mã đã hết lượt sử dụng" }));
        }
    }

    let value = dc.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let discount_amount = match dc_type {
        "deposit_fixed" => value.min(deposit_amount).max(0.0),
        "deposit_percent" => {
            let pct = (value / 100.0).clamp(0.0, 1.0);
            (deposit_amount * pct).round()
        }
        _ => 0.0,
    };

    let pay_amount = (deposit_amount - discount_amount).max(0.0);

    Ok(json!({
        "success": true,
        "code_id": dc.get("id"),
        "code": code_upper,
        "type": dc_type,
        "value": value,
        "discount_amount": discount_amount,
        "deposit_amount": deposit_amount,    // số tiền user nhận được vào ví
        "pay_amount": pay_amount,            // số tiền user thật sự cần trả
    }))
}

/// Lấy danh sách mã giảm giá user có thể dùng (active + chưa hết hạn, không phải deposit)
#[tauri::command]
pub async fn discount_list_available(
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = svc.get_access_token().await
        .ok_or_else(|| "Chưa đăng nhập".to_string())?;

    let url = format!(
        "{}/rest/v1/discount_codes?is_active=eq.true&is_hidden=eq.false&type=in.(fixed,percent)&select=id,code,name,description,type,value,expires_at,applies_to_sale,applies_to_all,min_price,max_price,max_uses,current_uses&order=created_at.desc",
        svc.config.url.trim_end_matches('/')
    );

    match svc.http_get_authed(&url, &token).await {
        Ok(rows) => {
            // Lọc lại các mã đã hết lượt hoặc hết hạn
            let now = chrono::Utc::now();
            let filtered: Vec<Value> = rows.as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter(|dc| {
                    let max_uses = dc.get("max_uses").and_then(|v| v.as_i64());
                    let current_uses = dc.get("current_uses").and_then(|v| v.as_i64()).unwrap_or(0);
                    if let Some(mu) = max_uses {
                        if current_uses >= mu { return false; }
                    }
                    if let Some(exp_str) = dc.get("expires_at").and_then(|v| v.as_str()) {
                        if !exp_str.is_empty() {
                            if let Ok(exp) = chrono::DateTime::parse_from_rfc3339(exp_str) {
                                if exp.with_timezone(&chrono::Utc) < now { return false; }
                            }
                        }
                    }
                    true
                })
                .cloned()
                .collect();
            Ok(json!({ "success": true, "data": filtered }))
        }
        Err(e) => Ok(json!({ "success": false, "data": [], "message": e })),
    }
}

// ─── Admin commands ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn admin_discount_list(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    if svc.config.service_key.is_empty() {
        return Err("Thiếu service key".into());
    }
    let url = format!(
        "{}/rest/v1/discount_codes?select=*&order=created_at.desc",
        svc.config.url.trim_end_matches('/')
    );
    svc.http_get_admin(&url).await
}

#[tauri::command]
pub async fn admin_discount_create(
    state: State<'_, AppState>,
    payload: Value,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    if svc.config.service_key.is_empty() {
        return Err("Thiếu service key".into());
    }

    // Đảm bảo code uppercase
    let mut data = payload.clone();
    if let Some(code) = data.get("code").and_then(|v| v.as_str()) {
        data["code"] = json!(code.trim().to_uppercase());
    }

    let url = format!("{}/rest/v1/discount_codes", svc.config.url.trim_end_matches('/'));
    svc.http_post_admin_upsert(&url, &data).await?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn admin_discount_update(
    state: State<'_, AppState>,
    id: String,
    patch: Value,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    if svc.config.service_key.is_empty() {
        return Err("Thiếu service key".into());
    }

    let mut data = patch.clone();
    if let Some(code) = data.get("code").and_then(|v| v.as_str()) {
        data["code"] = json!(code.trim().to_uppercase());
    }

    let url = format!(
        "{}/rest/v1/discount_codes?id=eq.{}",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&id)
    );
    svc.http_patch_admin(&url, &data).await?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn admin_discount_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    if svc.config.service_key.is_empty() {
        return Err("Thiếu service key".into());
    }
    let url = format!(
        "{}/rest/v1/discount_codes?id=eq.{}",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&id)
    );
    svc.http_delete_admin(&url).await?;
    Ok(json!({ "success": true }))
}

// ─── Helper ─────────────────────────────────────────────────────────────

fn format_vnd(n: i64) -> String {
    let s = n.abs().to_string();
    let bytes = s.as_bytes();
    let mut out = String::new();
    let len = bytes.len();
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 && (len - i) % 3 == 0 { out.push('.'); }
        out.push(*b as char);
    }
    out
}
