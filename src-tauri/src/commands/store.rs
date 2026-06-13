/// Store & Library Tauri commands
/// These proxy requests to Supabase via the existing SupabaseService HTTP client.
use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

// ─── Debug helper ─────────────────────────────────────────────────────────────

/// Trả về thông tin debug: có token không, URL Supabase, user_id
#[tauri::command]
pub async fn store_debug_info(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token_opt = svc.get_access_token().await;
    let has_token = token_opt.is_some();
    let token_prefix = token_opt.as_deref().map(|t| {
        let trimmed = t.trim();
        if trimmed.len() > 20 { format!("{}...", &trimmed[..20]) } else { trimmed.to_string() }
    });
    let user_id = svc.get_user_id().await;
    let supabase_url = svc.config.url.clone();
    let anon_key_prefix = if svc.config.anon_key.len() > 20 {
        format!("{}...", &svc.config.anon_key[..20])
    } else {
        svc.config.anon_key.clone()
    };

    // Thử query trực tiếp và trả về raw error
    let test_result = if let Some(token) = token_opt {
        let url = format!("{}/rest/v1/games?select=id,name&limit=1", supabase_url.trim_end_matches('/'));
        match svc.http_get_authed(&url, &token).await {
            Ok(v) => format!("OK: {} rows", v.as_array().map(|a| a.len()).unwrap_or(0)),
            Err(e) => format!("ERR: {e}"),
        }
    } else {
        "no_token".to_string()
    };

    Ok(json!({
        "has_token": has_token,
        "token_prefix": token_prefix,
        "user_id": user_id,
        "supabase_url": supabase_url,
        "anon_key_prefix": anon_key_prefix,
        "test_query": test_result,
    }))
}

// ─── User Games (owned) ───────────────────────────────────────────────────────

/// Kiểm tra user hiện tại có sở hữu game (theo game_id UUID) không
#[tauri::command]
pub async fn user_games_has(
    state: State<'_, AppState>,
    game_id: String,
) -> Result<bool, String> {
    let svc = state.supabase.clone();
    let token = match svc.get_access_token().await {
        Some(t) => t,
        None => return Ok(false),
    };
    let user_id = match svc.get_user_id().await {
        Some(id) => id,
        None => return Ok(false),
    };
    let url = format!(
        "{}/rest/v1/user_games?user_id=eq.{}&game_id=eq.{}&select=id",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&user_id),
        urlencoding::encode(&game_id)
    );
    match svc.http_get_authed(&url, &token).await {
        Ok(v) => Ok(v.as_array().map(|a| !a.is_empty()).unwrap_or(false)),
        Err(_) => Ok(false),
    }
}

/// Mua game: kiểm tra sở hữu → kiểm tra số dư → trừ tiền → thêm vào thư viện.
/// Dùng service_key để bypass RLS khi cập nhật balance + user_games.
/// Hỗ trợ discount code (tùy chọn).
#[tauri::command]
pub async fn purchase_game(
    state: State<'_, AppState>,
    game_id: String,
    discount_code: Option<String>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();

    if svc.config.service_key.is_empty() {
        return Err("Hệ thống chưa cấu hình thanh toán (thiếu service key).".into());
    }

    let user_id = match svc.get_user_id().await {
        Some(id) => id,
        None => return Err("Vui lòng đăng nhập lại.".into()),
    };

    let base = svc.config.url.trim_end_matches('/').to_string();

    // 1. Lấy thông tin game (giá)
    let game_url = format!("{base}/rest/v1/games?id=eq.{}&select=id,name,price,original_price", urlencoding::encode(&game_id));
    let game_rows = svc.http_get_admin(&game_url).await
        .map_err(|e| format!("Lỗi tải game: {e}"))?;
    let game = game_rows.as_array().and_then(|a| a.first())
        .ok_or_else(|| "Không tìm thấy game.".to_string())?;
    let original_price = game.get("price")
        .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok())))
        .unwrap_or(0.0)
        .max(0.0)
        .floor() as i64;
    let game_name = game.get("name").and_then(|v| v.as_str()).unwrap_or("Game").to_string();

    // Kiểm tra game có đang sale không
    let game_orig_price = game.get("original_price")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0)
        .floor() as i64;
    let is_on_sale = game_orig_price > original_price && game_orig_price > 0;

    // 2. Kiểm tra đã sở hữu chưa
    let owned_url = format!(
        "{base}/rest/v1/user_games?user_id=eq.{}&game_id=eq.{}&select=id",
        urlencoding::encode(&user_id), urlencoding::encode(&game_id)
    );
    let owned = svc.http_get_admin(&owned_url).await.unwrap_or(json!([]));
    if owned.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
        return Err("Bạn đã sở hữu game này rồi.".into());
    }

    // 3. Áp dụng discount code (nếu có)
    let (final_price, discount_info) = apply_discount_for_purchase(
        &svc,
        &discount_code,
        "game",
        &game_id,
        original_price as f64,
        is_on_sale,
    ).await?;

    let final_price = final_price.floor() as i64;

    // 4. Lấy số dư
    let profile_url = format!("{base}/rest/v1/profiles?id=eq.{}&select=balance", urlencoding::encode(&user_id));
    let profile_rows = svc.http_get_admin(&profile_url).await
        .map_err(|e| format!("Lỗi tải số dư: {e}"))?;
    let balance = profile_rows.as_array().and_then(|a| a.first())
        .and_then(|r| r.get("balance"))
        .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok())))
        .unwrap_or(0.0)
        .floor() as i64;

    if balance < final_price {
        return Err(format!(
            "Số dư không đủ. Cần {} ₫, hiện có {} ₫.",
            format_vnd(final_price), format_vnd(balance)
        ));
    }

    // 5. Trừ tiền
    let new_balance = balance - final_price;
    svc.set_balance_with_reason(&user_id, new_balance as f64, "purchase_game", Some(&game_id)).await
        .map_err(|e| format!("Lỗi trừ tiền: {e}"))?;

    // 6. Thêm game vào thư viện
    let ug_url = format!("{base}/rest/v1/user_games");
    let add_res = svc.http_post_admin_upsert(&ug_url, &json!({
        "user_id": user_id,
        "game_id": game_id,
    })).await;

    if let Err(e) = add_res {
        // Rollback balance nếu thêm game thất bại
        let _ = svc.set_balance_with_reason(&user_id, balance as f64, "rollback", Some(&game_id)).await;
        return Err(format!("Lỗi thêm game vào thư viện: {e}"));
    }

    // 7. Record discount redemption (nếu có)
    if let Some(info) = &discount_info {
        record_discount_redemption(&svc, info, &user_id, "game", &game_id, original_price as f64).await;
    }

    // 8. Áp dụng referral code (nếu có) — xử lý SONG SONG với discount code
    // Referral code được truyền qua discount_code field, nhưng chỉ khi nó là referral (8 ký tự)
    // và không phải discount code thông thường (discount_info đã xử lý rồi).
    // Để hỗ trợ, frontend sẽ gọi riêng referral_validate_code trước, sau đó
    // truyền referral_code_id qua purchase.
    // Tính toán: commission = final_price * discount_pct / 100

    Ok(json!({
        "success": true,
        "game_name": game_name,
        "price": final_price,
        "original_price": original_price,
        "discount": discount_info,
        "new_balance": new_balance,
    }))
}

/// Áp dụng discount code, trả về (final_price, discount_info)
/// Nếu không có code → trả về (original_price, None)
/// Nếu code invalid → trả về Err
async fn apply_discount_for_purchase(
    svc: &std::sync::Arc<crate::services::supabase::SupabaseService>,
    discount_code: &Option<String>,
    order_type: &str,
    _order_id: &str,
    order_amount: f64,
    is_on_sale: bool,
) -> Result<(f64, Option<DiscountInfo>), String> {
    let code = match discount_code {
        Some(c) if !c.trim().is_empty() => c.trim().to_uppercase(),
        _ => return Ok((order_amount, None)),
    };

    let base = svc.config.url.trim_end_matches('/');
    let url = format!(
        "{}/rest/v1/discount_codes?code=eq.{}&select=*&limit=1",
        base,
        urlencoding::encode(&code)
    );

    let rows = svc.http_get_admin(&url).await
        .map_err(|e| format!("Lỗi load discount code: {e}"))?;
    let dc = rows.as_array().and_then(|a| a.first())
        .ok_or_else(|| "Mã giảm giá không tồn tại".to_string())?;

    let is_active = dc.get("is_active").and_then(|v| v.as_bool()).unwrap_or(false);
    if !is_active {
        return Err("Mã giảm giá đã bị vô hiệu hóa".into());
    }

    if let Some(exp_str) = dc.get("expires_at").and_then(|v| v.as_str()) {
        if !exp_str.is_empty() {
            if let Ok(exp) = chrono::DateTime::parse_from_rfc3339(exp_str) {
                if exp.with_timezone(&chrono::Utc) < chrono::Utc::now() {
                    return Err("Mã giảm giá đã hết hạn".into());
                }
            }
        }
    }

    let dc_type = dc.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if dc_type != "fixed" && dc_type != "percent" {
        return Err("Mã không áp dụng cho game/DLC".into());
    }

    let max_uses = dc.get("max_uses").and_then(|v| v.as_i64());
    let current_uses = dc.get("current_uses").and_then(|v| v.as_i64()).unwrap_or(0);
    if let Some(mu) = max_uses {
        if current_uses >= mu {
            return Err("Mã đã hết lượt sử dụng".into());
        }
    }

    let applies_to_sale = dc.get("applies_to_sale").and_then(|v| v.as_bool()).unwrap_or(true);
    if is_on_sale && !applies_to_sale {
        return Err("Mã không áp dụng cho game đang sale".into());
    }

    let applies_to_all = dc.get("applies_to_all").and_then(|v| v.as_bool()).unwrap_or(true);
    if !applies_to_all {
        let allowed: Vec<String> = dc.get("applicable_game_ids")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        if !allowed.contains(&_order_id.to_string()) {
            return Err("Mã không áp dụng cho sản phẩm này".into());
        }
    }

    if let Some(mp) = dc.get("min_price").and_then(|v| v.as_f64()) {
        if order_amount < mp {
            return Err(format!("Mã yêu cầu đơn từ {} ₫", format_vnd(mp as i64)));
        }
    }
    if let Some(mp) = dc.get("max_price").and_then(|v| v.as_f64()) {
        if order_amount > mp {
            return Err(format!("Mã chỉ áp dụng cho đơn dưới {} ₫", format_vnd(mp as i64)));
        }
    }

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

    let code_id = dc.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let _ = order_type; // chưa dùng riêng cho game/dlc
    Ok((final_amount, Some(DiscountInfo {
        code_id,
        code: code.clone(),
        discount_amount,
        original_amount: order_amount,
        final_amount,
    })))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DiscountInfo {
    pub code_id: String,
    pub code: String,
    pub discount_amount: f64,
    pub original_amount: f64,
    pub final_amount: f64,
}

/// Lưu redemption + tăng current_uses
async fn record_discount_redemption(
    svc: &std::sync::Arc<crate::services::supabase::SupabaseService>,
    info: &DiscountInfo,
    user_id: &str,
    order_type: &str,
    order_id: &str,
    order_amount: f64,
) {
    let base = svc.config.url.trim_end_matches('/');

    // Insert redemption
    let red_url = format!("{base}/rest/v1/discount_code_redemptions");
    let _ = svc.http_post_admin_upsert(&red_url, &json!({
        "code_id": info.code_id,
        "user_id": user_id,
        "order_type": order_type,
        "order_id": order_id,
        "order_amount": order_amount,
        "discount_amount": info.discount_amount,
    })).await;

    // Tăng current_uses (dùng RPC sẽ atomic hơn nhưng tạm increment qua read+write)
    let read_url = format!(
        "{base}/rest/v1/discount_codes?id=eq.{}&select=current_uses",
        urlencoding::encode(&info.code_id)
    );
    if let Ok(rows) = svc.http_get_admin(&read_url).await {
        if let Some(uses) = rows.as_array().and_then(|a| a.first())
            .and_then(|r| r.get("current_uses")).and_then(|v| v.as_i64()) {
            let patch_url = format!(
                "{base}/rest/v1/discount_codes?id=eq.{}",
                urlencoding::encode(&info.code_id)
            );
            let _ = svc.http_patch_admin(&patch_url, &json!({
                "current_uses": uses + 1
            })).await;
        }
    }
}

fn format_vnd(n: i64) -> String {
    let s = n.abs().to_string();
    let bytes = s.as_bytes();
    let mut out = String::new();
    let len = bytes.len();
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            out.push('.');
        }
        out.push(*b as char);
    }
    if n < 0 { format!("-{out}") } else { out }
}

// ─── Games ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn games_list(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = match svc.get_access_token().await {
        Some(t) => t,
        None => return Err("Chưa đăng nhập. Vui lòng đăng nhập lại.".into()),
    };
    // Thử với user token trước, nếu fail thử với anon key (games là public read)
    let url = format!(
        "{}/rest/v1/games?select=*&base_appid=is.null&order=purchase_count.desc.nullslast,release_date.desc.nullslast,created_at.desc",
        svc.config.url.trim_end_matches('/')
    );
    match svc.http_get_authed(&url, &token).await {
        Ok(res) => Ok(json!({ "data": res, "success": true })),
        Err(e) => {
            eprintln!("[games_list] user token failed: {e}, trying anon key...");
            // Fallback: anon key (games bảng public)
            match svc.http_get_anon(&url).await {
                Ok(res) => Ok(json!({ "data": res, "success": true })),
                Err(e2) => {
                    eprintln!("[games_list] anon key also failed: {e2}");
                    Err(format!("Lỗi tải danh sách game: {e} | anon: {e2}"))
                }
            }
        }
    }
}

#[tauri::command]
pub async fn games_list_review_summaries(
    state: State<'_, AppState>,
    game_ids: Vec<String>,
) -> Result<Value, String> {
    if game_ids.is_empty() {
        return Ok(json!({ "success": true, "data": {} }));
    }
    let svc = state.supabase.clone();
    let token = match svc.get_access_token().await {
        Some(t) => t,
        None => return Ok(json!({ "success": false, "data": {} })),
    };
    // Truyền dưới dạng mảng JSON thay vì CSV
    let url = format!(
        "{}/rest/v1/rpc/get_review_summaries",
        svc.config.url.trim_end_matches('/')
    );
    let body = json!({ "game_ids": game_ids });
    match svc.http_post_authed(&url, &token, &body).await {
        Ok(res) => Ok(json!({ "success": true, "data": res })),
        // Không crash nếu function không tồn tại
        Err(_) => Ok(json!({ "success": false, "data": {} })),
    }
}

// ─── Reviews ──────────────────────────────────────────────────────────────────

/// Submit review (insert hoặc update — UNIQUE(user_id, game_id) đảm bảo 1 user 1 review/game).
/// Dùng upsert on conflict.
#[tauri::command]
pub async fn review_submit(
    state: State<'_, AppState>,
    game_id: String,
    recommended: bool,
    content: Option<String>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let user_id = svc.get_user_id().await.ok_or_else(|| "Chưa đăng nhập".to_string())?;

    if svc.config.service_key.is_empty() {
        return Err("Thiếu service key".into());
    }

    let base = svc.config.url.trim_end_matches('/');
    let body = json!({
        "user_id": user_id,
        "game_id": game_id,
        "recommended": recommended,
        "content": content.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()),
        "updated_at": chrono::Utc::now().to_rfc3339(),
    });

    // Insert only — nếu đã review rồi sẽ bị conflict → lỗi
    let insert_url = format!("{base}/rest/v1/reviews");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Lỗi HTTP client: {e}"))?;

    let resp = client
        .post(&insert_url)
        .header("Authorization", format!("Bearer {}", svc.config.service_key))
        .header("apikey", &svc.config.anon_key)
        .header("Content-Type", "application/json")
        .header("Prefer", "return=minimal")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Lỗi gửi đánh giá: {e}"))?;

    if resp.status().as_u16() == 409 || resp.status().as_u16() == 23505 {
        return Err("Bạn đã đánh giá game này rồi.".into());
    }
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        if text.contains("duplicate") || text.contains("unique") || text.contains("23505") {
            return Err("Bạn đã đánh giá game này rồi.".into());
        }
        return Err(format!("Lỗi gửi đánh giá: {text}"));
    }

    Ok(json!({ "success": true }))
}

/// Lấy review của user hiện tại cho 1 game (nếu có).
#[tauri::command]
pub async fn review_my(
    state: State<'_, AppState>,
    game_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = svc.get_access_token().await.ok_or_else(|| "Chưa đăng nhập".to_string())?;
    let user_id = svc.get_user_id().await.ok_or_else(|| "Chưa đăng nhập".to_string())?;

    let url = format!(
        "{}/rest/v1/reviews?user_id=eq.{}&game_id=eq.{}&select=*&limit=1",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&user_id),
        urlencoding::encode(&game_id),
    );
    let rows = svc.http_get_authed(&url, &token).await.map_err(|e| format!("Lỗi: {e}"))?;
    let review = rows.as_array().and_then(|a| a.first()).cloned();
    Ok(json!({ "success": true, "data": review }))
}

/// Lấy tất cả review cho 1 game (kèm user info).
#[tauri::command]
pub async fn review_list(
    state: State<'_, AppState>,
    game_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = svc.get_access_token().await.ok_or_else(|| "Chưa đăng nhập".to_string())?;

    let url = format!(
        "{}/rest/v1/reviews?game_id=eq.{}&select=id,user_id,recommended,content,created_at,updated_at,profiles(display_name,username,avatar_url)&order=created_at.desc&limit=50",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&game_id),
    );
    let rows = svc.http_get_authed(&url, &token).await.map_err(|e| format!("Lỗi: {e}"))?;
    Ok(json!({ "success": true, "data": rows }))
}

// ─── User Games (owned) ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn user_games_list_owned(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = match svc.get_access_token().await {
        Some(t) => t,
        None => return Err("Chưa đăng nhập. Vui lòng đăng nhập lại.".into()),
    };
    let user_id = match svc.get_user_id().await {
        Some(id) => id,
        None => return Err("Không lấy được user ID.".into()),
    };

    let url = format!(
        "{}/rest/v1/user_games?user_id=eq.{}&select=game_id,games(*)",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&user_id)
    );
    let rows = svc
        .http_get_authed(&url, &token)
        .await
        .map_err(|e| {
            eprintln!("[user_games_list_owned] Supabase error: {e}");
            format!("Lỗi tải user_games: {e}")
        })?;

    // Flatten: user_games rows contain a nested games object
    let games: Vec<Value> = if let Some(arr) = rows.as_array() {
        arr.iter()
            .filter_map(|row| row.get("games").cloned())
            .filter(|v| !v.is_null())
            .collect()
    } else {
        vec![]
    };

    Ok(Value::Array(games))
}

// ─── Admin: store assets ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn admin_list_store_assets(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = match svc.get_access_token().await {
        Some(t) => t,
        // Nếu chưa login, trả mảng rỗng thay vì crash
        None => return Ok(Value::Array(vec![])),
    };
    let url = format!(
        "{}/rest/v1/store_assets?select=id,type,image_url,link_url,position&order=position.asc",
        svc.config.url.trim_end_matches('/')
    );
    // Không để crash store nếu bảng không tồn tại hoặc RLS block
    match svc.http_get_authed(&url, &token).await {
        Ok(res) => Ok(res),
        Err(_) => Ok(Value::Array(vec![])),
    }
}

// ─── Steam app details (proxy to steam proxy server or Supabase edge fn) ────

#[tauri::command]
pub async fn steam_get_app_details(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = match svc.get_access_token().await {
        Some(t) => t,
        None => return Err("Chưa đăng nhập".into()),
    };
    let body = json!({ "appId": app_id });
    let res = svc
        .post_edge_function_authed("steam-app-details", &token, &body)
        .await;
    Ok(res.get("data").cloned().unwrap_or(Value::Null))
}

// ─── Steam: play ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn steam_play(
    state: State<'_, AppState>,
    app_id: String,
    dlc_app_ids: Vec<String>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = match svc.get_access_token().await {
        Some(t) => t,
        None => return Err("Chưa đăng nhập".into()),
    };
    let body = json!({ "appId": app_id, "dlcAppIds": dlc_app_ids });
    let res = svc
        .post_edge_function_authed("steam-play", &token, &body)
        .await;
    Ok(res)
}

// ─── Steam: preload ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn steam_preload(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = match svc.get_access_token().await {
        Some(t) => t,
        None => return Err("Chưa đăng nhập".into()),
    };
    let body = json!({ "appId": app_id });
    let res = svc
        .post_edge_function_authed("steam-preload", &token, &body)
        .await;
    Ok(res)
}

// ─── Steam: preload metadata ──────────────────────────────────────────────────

#[tauri::command]
pub async fn steam_get_preload_metadata(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = match svc.get_access_token().await {
        Some(t) => t,
        None => return Err("Chưa đăng nhập".into()),
    };
    let body = json!({ "appId": app_id });
    let res = svc
        .post_edge_function_authed("steam-preload-metadata", &token, &body)
        .await;
    Ok(res)
}

// ─── DLC: get or fetch single DLC ─────────────────────────────────────────

/// Lấy thông tin 1 DLC. Ưu tiên DB; nếu chưa có trong DB → fetch từ Steam,
/// auto-pricing 35%, lưu vào DB rồi trả về.
/// Trả về: { appid, name, price, original_price, header_image, id (nếu có), ... }
#[tauri::command]
pub async fn dlc_get_or_fetch(
    state: State<'_, AppState>,
    base_appid: String,
    dlc_appid: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = match svc.get_access_token().await {
        Some(t) => t,
        None => return Err("Chưa đăng nhập".into()),
    };

    // ── Bước 1: Thử lấy từ DB ─────────────────────────────────────────────
    let db_url = format!(
        "{}/rest/v1/dlcs?appid=eq.{}&select=id,appid,name,price,original_price,header_image,custom_image,base_appid,is_free&limit=1",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&dlc_appid)
    );

    if let Ok(rows) = svc.http_get_authed(&db_url, &token).await {
        if let Some(arr) = rows.as_array() {
            if let Some(row) = arr.first() {
                let price = row.get("price").and_then(|v| v.as_i64()).unwrap_or(0);
                let name = row.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                // Nếu DB đã có đủ data (giá > 0 HOẶC name không rỗng) → trả về luôn
                if price > 0 || !name.is_empty() {
                    return Ok(json!({ "success": true, "data": row, "source": "db" }));
                }
            }
        }
    }

    // ── Bước 2: Fetch từ Steam API ────────────────────────────────────────
    // Lấy name + image từ ICommunityService
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) nyvexa-launcher/2")
        .build()
        .map_err(|e| format!("Lỗi tạo HTTP client: {e}"))?;

    let community_url = format!(
        "https://api.steampowered.com/ICommunityService/GetApps/v1/?appids[0]={}",
        dlc_appid
    );

    let community_data = client.get(&community_url).send().await
        .ok()
        .and_then(|r| if r.status().is_success() { Some(r) } else { None });

    let mut name = String::new();
    let mut header_image = format!(
        "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/header.jpg",
        dlc_appid
    );

    if let Some(resp) = community_data {
        if let Ok(payload) = resp.json::<Value>().await {
            if let Some(apps) = payload.get("response").and_then(|r| r.get("apps")).and_then(|a| a.as_array()) {
                if let Some(app) = apps.first() {
                    name = app.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let icon_hash = app.get("icon").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if !icon_hash.is_empty() {
                        let _ = icon_hash; // header_image ưu tiên header.jpg, không dùng icon
                    }
                }
            }
        }
    }

    if name.is_empty() {
        name = format!("DLC {}", dlc_appid);
    }

    // Lấy giá từ Steam Store API + tính giá 35%
    let (price, original_price) = fetch_dlc_price_from_steam(&dlc_appid)
        .await
        .unwrap_or((0, 0));

    // ── Bước 3: Upsert vào DB ─────────────────────────────────────────────
    let upsert_url = format!(
        "{}/rest/v1/dlcs",
        svc.config.url.trim_end_matches('/')
    );
    let upsert_body = json!({
        "appid": dlc_appid,
        "name": name,
        "price": price,
        "original_price": original_price,
        "header_image": header_image,
        "base_appid": base_appid,
    });

    let _ = svc.http_upsert_authed(&upsert_url, &token, &upsert_body, "appid").await;

    // ── Bước 4: Lấy lại từ DB để có id ─────────────────────────────────────
    if let Ok(rows) = svc.http_get_authed(&db_url, &token).await {
        if let Some(arr) = rows.as_array() {
            if let Some(row) = arr.first() {
                return Ok(json!({ "success": true, "data": row, "source": "steam" }));
            }
        }
    }

    // Fallback: trả về data đã fetch (không có id)
    Ok(json!({
        "success": true,
        "source": "steam",
        "data": {
            "appid": dlc_appid,
            "name": name,
            "price": price,
            "original_price": original_price,
            "header_image": header_image,
            "base_appid": base_appid,
        }
    }))
}

// ─── DLC: list all DLCs for a base game (from DB) ────────────────────────────

/// Trả về danh sách DLC có trong bảng dlcs với base_appid = app_id.
/// Mỗi row gồm: id, appid, name, price, header_image
#[tauri::command]
pub async fn dlc_list_for_basegame(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = match svc.get_access_token().await {
        Some(t) => t,
        None => return Err("Chưa đăng nhập".into()),
    };

    let url = format!(
        "{}/rest/v1/dlcs?base_appid=eq.{}&select=id,appid,name,price,original_price,header_image,custom_image,is_free&order=name.asc",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&app_id)
    );

    match svc.http_get_authed(&url, &token).await {
        Ok(rows) => Ok(json!({ "success": true, "data": rows })),
        Err(e) => {
            eprintln!("[dlc_list_for_basegame] error: {e}");
            Ok(json!({ "success": false, "data": [], "error": e }))
        }
    }
}

// ─── DLC: batch upsert DLCs vào database ─────────────────────────────────────

/// Tự động thêm/cập nhật DLCs vào bảng games sau khi fetch từ Steam API.
/// Input: base_appid, dlcs: [{ appid, name, header_image }]
/// Logic:
///  - DLC đã có trong DB → giữ nguyên giá (admin đã chỉnh)
///  - DLC mới → fetch giá từ Steam Store API, tính giá = steam_price * 35%
#[tauri::command]
pub async fn dlc_batch_upsert(
    state: State<'_, AppState>,
    base_appid: String,
    dlcs: Vec<Value>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = match svc.get_access_token().await {
        Some(t) => t,
        None => return Err("Chưa đăng nhập".into()),
    };

    if dlcs.is_empty() {
        return Ok(json!({ "success": true, "processed": 0 }));
    }

    // Lấy danh sách DLC đã có trong DB (để giữ nguyên giá)
    let check_url = format!(
        "{}/rest/v1/dlcs?base_appid=eq.{}&select=appid,price,original_price",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&base_appid)
    );
    let existing_rows = svc.http_get_authed(&check_url, &token).await
        .map_err(|e| format!("Lỗi kiểm tra DLC hiện có: {e}"))?;

    let existing_map: std::collections::HashMap<String, (i64, i64)> = existing_rows
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|row| {
            let appid = row.get("appid")?.as_str()?.to_string();
            let price = row.get("price").and_then(|v| v.as_i64()).unwrap_or(0);
            let orig = row.get("original_price").and_then(|v| v.as_i64()).unwrap_or(0);
            Some((appid, (price, orig)))
        })
        .collect();

    let mut processed = 0;
    let mut price_fetched = 0;
    const MAX_PRICE_FETCH: usize = 10; // Giới hạn fetch giá mỗi lần để tránh rate limit

    // Insert/update từng DLC
    for dlc in dlcs {
        let appid = match dlc.get("appid").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => continue,
        };
        let name = dlc.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let header_image = dlc.get("header_image").and_then(|v| v.as_str()).unwrap_or("").to_string();

        let (price, original_price) = if let Some((p, op)) = existing_map.get(&appid) {
            if *p > 0 {
                // DLC đã tồn tại VÀ có giá > 0 → giữ nguyên (admin đã chỉnh)
                (*p, *op)
            } else if price_fetched < MAX_PRICE_FETCH {
                // DLC tồn tại nhưng giá = 0 → fetch giá từ Steam (giới hạn)
                price_fetched += 1;
                match fetch_dlc_price_from_steam(&appid).await {
                    Some((steam_price, steam_orig)) => (steam_price, steam_orig),
                    None => (0, 0),
                }
            } else {
                (0, 0)
            }
        } else if price_fetched < MAX_PRICE_FETCH {
            // DLC mới → fetch giá từ Steam Store API và tính giá tự động
            price_fetched += 1;
            match fetch_dlc_price_from_steam(&appid).await {
                Some((steam_price, steam_orig)) => (steam_price, steam_orig),
                None => (0, 0),
            }
        } else {
            (0, 0)
        };

        let upsert_url = format!(
            "{}/rest/v1/dlcs",
            svc.config.url.trim_end_matches('/')
        );
        let body = json!({
            "appid": appid,
            "name": name,
            "price": price,
            "original_price": original_price,
            "header_image": header_image,
            "base_appid": base_appid,
        });

        // Upsert: insert nếu mới, update nếu appid đã tồn tại
        let _res = svc.http_upsert_authed(&upsert_url, &token, &body, "appid").await;
        processed += 1;
    }

    Ok(json!({
        "success": true,
        "processed": processed,
    }))
}

/// Fetch giá DLC từ Steam Store API (thử nhiều CC)
/// Trả về (price_vnd, original_price_vnd) đã tính theo 35%
async fn fetch_dlc_price_from_steam(appid: &str) -> Option<(i64, i64)> {
    const PRICE_MULTIPLIER: f64 = 0.35;
    const USD_TO_VND: f64 = 25_500.0;
    const PRICE_CAP_VND: i64 = 229_000;

    let ccs = ["us", "sg", "th", "gb"];
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) nyvexa-launcher/2")
        .build()
        .ok()?;

    for cc in &ccs {
        let url = format!(
            "https://store.steampowered.com/api/appdetails?appids={}&cc={}&l=english",
            appid, cc
        );

        let resp = client.get(&url).send().await.ok()?;
        if !resp.status().is_success() {
            continue;
        }

        let payload: Value = resp.json().await.ok()?;
        let data = payload
            .get(appid)
            .or_else(|| payload.as_object().and_then(|m| m.values().next()))?;

        if data.get("success").and_then(|v| v.as_bool()) != Some(true) {
            continue;
        }

        let app_data = data.get("data")?;

        // Kiểm tra free
        if app_data.get("is_free").and_then(|v| v.as_bool()) == Some(true) {
            return Some((0, 0));
        }

        // Lấy giá từ price_overview
        if let Some(price_ov) = app_data.get("price_overview") {
            let initial_cents = price_ov
                .get("initial")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let final_cents = price_ov
                .get("final")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);

            if final_cents == 0 {
                continue;
            }

            // Tính giá VND với multiplier 35%, áp giá trần 229.000đ
            let price_vnd = ((((final_cents as f64 / 100.0) * USD_TO_VND * PRICE_MULTIPLIER).round() as i64).max(0)).min(PRICE_CAP_VND);
            let orig_vnd = if initial_cents > final_cents {
                ((((initial_cents as f64 / 100.0) * USD_TO_VND * PRICE_MULTIPLIER).round() as i64).max(0)).min(PRICE_CAP_VND)
            } else {
                0
            };

            return Some((price_vnd, orig_vnd));
        }
    }

    None
}

// ─── DLC: list owned for base game ────────────────────────────────────────────

#[tauri::command]
pub async fn dlc_list_owned_for_basegame(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = match svc.get_access_token().await {
        Some(t) => t,
        None => return Err("Chưa đăng nhập".into()),
    };
    let user_id = svc
        .get_user_id()
        .await
        .ok_or_else(|| "Chưa đăng nhập".to_string())?;

    let url = format!(
        "{}/rest/v1/owned_dlcs?user_id=eq.{}&base_appid=eq.{}&select=dlc_appid",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&user_id),
        urlencoding::encode(&app_id)
    );
    let rows = svc
        .http_get_authed(&url, &token)
        .await
        .map_err(|e| e.to_string())?;

    let ids: Vec<String> = rows
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|r| r.get("dlc_appid").and_then(|v| v.as_str()).map(String::from))
        .collect();

    Ok(json!({ "data": ids }))
}

// ─── DLC: purchase ────────────────────────────────────────────────────────────

// ─── DLC: purchase ────────────────────────────────────────────────────────────

/// Mua DLC: yêu cầu user đã sở hữu base game.
/// Implementation đầy đủ trong Rust, không dùng edge function.
/// Hỗ trợ discount code (tùy chọn).
#[tauri::command]
pub async fn dlc_purchase(
    state: State<'_, AppState>,
    base_app_id: String,
    dlc_app_id: String,
    gift_code: Option<String>,
    discount_code: Option<String>,
) -> Result<Value, String> {
    let _ = gift_code;
    let svc = state.supabase.clone();

    if svc.config.service_key.is_empty() {
        return Err("Hệ thống chưa cấu hình thanh toán (thiếu service key).".into());
    }

    let user_id = match svc.get_user_id().await {
        Some(id) => id,
        None => return Err("Vui lòng đăng nhập lại.".into()),
    };

    let base = svc.config.url.trim_end_matches('/').to_string();

    // ── 1. Kiểm tra user đã sở hữu base game chưa ─────────────────────────
    let base_game_url = format!(
        "{base}/rest/v1/games?appid=eq.{}&select=id&limit=1",
        urlencoding::encode(&base_app_id)
    );
    let base_game_rows = svc.http_get_admin(&base_game_url).await
        .map_err(|e| format!("Lỗi tải base game: {e}"))?;
    let base_game = base_game_rows.as_array().and_then(|a| a.first())
        .ok_or_else(|| "Không tìm thấy game gốc trong cửa hàng.".to_string())?;
    let base_game_id = base_game.get("id").and_then(|v| v.as_str())
        .ok_or_else(|| "Game gốc không có ID hợp lệ.".to_string())?
        .to_string();

    let owned_base_url = format!(
        "{base}/rest/v1/user_games?user_id=eq.{}&game_id=eq.{}&select=id",
        urlencoding::encode(&user_id), urlencoding::encode(&base_game_id)
    );
    let owned_base = svc.http_get_admin(&owned_base_url).await.unwrap_or(json!([]));
    if !owned_base.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
        return Err("Bạn cần sở hữu game gốc trước khi mua DLC này.".into());
    }

    // ── 2. Lấy thông tin DLC (giá) ────────────────────────────────────────
    let dlc_url = format!(
        "{base}/rest/v1/dlcs?appid=eq.{}&select=id,name,price,original_price,is_free&limit=1",
        urlencoding::encode(&dlc_app_id)
    );
    let dlc_rows = svc.http_get_admin(&dlc_url).await
        .map_err(|e| format!("Lỗi tải DLC: {e}"))?;
    let dlc = dlc_rows.as_array().and_then(|a| a.first())
        .ok_or_else(|| "Không tìm thấy DLC trong cửa hàng.".to_string())?;
    let original_price = dlc.get("price")
        .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok())))
        .unwrap_or(0.0)
        .max(0.0)
        .floor() as i64;
    let dlc_name = dlc.get("name").and_then(|v| v.as_str()).unwrap_or("DLC").to_string();
    let dlc_id = dlc.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let is_free = dlc.get("is_free").and_then(|v| v.as_bool()).unwrap_or(false);

    let dlc_orig = dlc.get("original_price").and_then(|v| v.as_f64()).unwrap_or(0.0).floor() as i64;
    let is_on_sale = dlc_orig > original_price && dlc_orig > 0;

    // DLC giá 0 chỉ cho phép mua khi admin đã tích "miễn phí" (is_free).
    if original_price <= 0 && !is_free {
        return Err("DLC này chưa có giá. Vui lòng liên hệ admin.".into());
    }

    // ── 3. Kiểm tra đã sở hữu DLC chưa ────────────────────────────────────
    let owned_dlc_url = format!(
        "{base}/rest/v1/owned_dlcs?user_id=eq.{}&dlc_appid=eq.{}&select=id",
        urlencoding::encode(&user_id), urlencoding::encode(&dlc_app_id)
    );
    let owned_dlc = svc.http_get_admin(&owned_dlc_url).await.unwrap_or(json!([]));
    if owned_dlc.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
        return Err("Bạn đã sở hữu DLC này rồi.".into());
    }

    // ── 4. Áp dụng discount code (nếu có) ─────────────────────────────────
    let (final_price, discount_info) = apply_discount_for_purchase(
        &svc,
        &discount_code,
        "dlc",
        &dlc_id,
        original_price as f64,
        is_on_sale,
    ).await?;
    let final_price = final_price.floor() as i64;

    // ── 5. Lấy số dư ──────────────────────────────────────────────────────
    let profile_url = format!(
        "{base}/rest/v1/profiles?id=eq.{}&select=balance",
        urlencoding::encode(&user_id)
    );
    let profile_rows = svc.http_get_admin(&profile_url).await
        .map_err(|e| format!("Lỗi tải số dư: {e}"))?;
    let balance = profile_rows.as_array().and_then(|a| a.first())
        .and_then(|r| r.get("balance"))
        .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok())))
        .unwrap_or(0.0)
        .floor() as i64;

    if balance < final_price {
        return Err(format!(
            "Số dư không đủ. Cần {} ₫, hiện có {} ₫.",
            format_vnd(final_price), format_vnd(balance)
        ));
    }

    // ── 6. Trừ tiền ───────────────────────────────────────────────────────
    let new_balance = balance - final_price;
    svc.set_balance_with_reason(&user_id, new_balance as f64, "purchase_dlc", Some(&dlc_app_id)).await
        .map_err(|e| format!("Lỗi trừ tiền: {e}"))?;

    // ── 7. Thêm DLC vào owned_dlcs ────────────────────────────────────────
    let owned_dlcs_url = format!("{base}/rest/v1/owned_dlcs");
    let add_res = svc.http_post_admin_upsert(&owned_dlcs_url, &json!({
        "user_id": user_id,
        "base_appid": base_app_id,
        "dlc_appid": dlc_app_id,
    })).await;

    if let Err(e) = add_res {
        let _ = svc.set_balance_with_reason(&user_id, balance as f64, "rollback", None).await;
        return Err(format!("Lỗi thêm DLC vào thư viện: {e}"));
    }

    // ── 8. Record discount redemption ─────────────────────────────────────
    if let Some(info) = &discount_info {
        record_discount_redemption(&svc, info, &user_id, "dlc", &dlc_id, original_price as f64).await;
    }

    Ok(json!({
        "success": true,
        "dlc_name": dlc_name,
        "price": final_price,
        "original_price": original_price,
        "discount": discount_info,
        "new_balance": new_balance,
    }))
}

// ─── Community: movie history ─────────────────────────────────────────────────

#[tauri::command]
pub async fn community_list_movie_history(
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = match svc.get_access_token().await {
        Some(t) => t,
        None => return Err("Chưa đăng nhập".into()),
    };
    let user_id = svc
        .get_user_id()
        .await
        .ok_or_else(|| "Chưa đăng nhập".to_string())?;

    let url = format!(
        "{}/rest/v1/movie_history?user_id=eq.{}&select=*&order=updated_at.desc",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&user_id)
    );
    let rows = svc
        .http_get_authed(&url, &token)
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!({ "data": rows }))
}

// ─── Community: movie progress ────────────────────────────────────────────────

#[tauri::command]
pub async fn community_get_movie_progress(
    state: State<'_, AppState>,
    slug: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = match svc.get_access_token().await {
        Some(t) => t,
        None => return Err("Chưa đăng nhập".into()),
    };
    let user_id = svc
        .get_user_id()
        .await
        .ok_or_else(|| "Chưa đăng nhập".to_string())?;

    let url = format!(
        "{}/rest/v1/movie_progress?user_id=eq.{}&slug=eq.{}&select=*",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&user_id),
        urlencoding::encode(&slug)
    );
    let rows = svc
        .http_get_authed(&url, &token)
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!({ "data": rows }))
}

// ─── Library assets: lưu icon/banner thư viện vào DB (bảng games) ────────────

/// Lưu link icon và banner thư viện cho game theo appid (dùng service_key).
/// Chỉ cập nhật các cột chưa có giá trị để không ghi đè ảnh custom của admin.
#[tauri::command]
pub async fn games_set_library_assets(
    state: State<'_, AppState>,
    appid: String,
    icon_url: Option<String>,
    hero_url: Option<String>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    if svc.config.service_key.is_empty() {
        return Ok(json!({ "success": false, "reason": "no_service_key" }));
    }
    let aid = appid.trim().to_string();
    if aid.is_empty() {
        return Ok(json!({ "success": false, "reason": "bad_appid" }));
    }

    let mut patch = serde_json::Map::new();
    if let Some(icon) = icon_url.filter(|s| !s.trim().is_empty()) {
        patch.insert("library_icon_url".into(), json!(icon));
    }
    if let Some(hero) = hero_url.filter(|s| !s.trim().is_empty()) {
        patch.insert("library_hero_url".into(), json!(hero));
    }
    if patch.is_empty() {
        return Ok(json!({ "success": true, "skipped": true }));
    }

    let base = svc.config.url.trim_end_matches('/');
    let url = format!("{base}/rest/v1/games?appid=eq.{}", urlencoding::encode(&aid));
    // Không để lỗi DB làm hỏng UI thư viện
    match svc.http_patch_admin(&url, &Value::Object(patch)).await {
        Ok(_) => Ok(json!({ "success": true })),
        Err(e) => Ok(json!({ "success": false, "reason": e })),
    }
}

// ─── Referral System ─────────────────────────────────────────────────────────

fn referral_discount_percent(total_uses: i64) -> i64 {
    if total_uses >= 50 { 25 } else if total_uses >= 20 { 20 } else { 15 }
}

fn referral_random_code() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    let mut h = DefaultHasher::new();
    ts.hash(&mut h);
    std::thread::current().id().hash(&mut h);
    let n: u64 = h.finish();
    // Tạo 8 ký tự a-zA-Z0-9
    let charset: Vec<char> = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789".chars().collect();
    let len = charset.len() as u64;
    let mut code = String::with_capacity(8);
    let mut v = n;
    for _ in 0..8 {
        code.push(charset[(v % len) as usize]);
        v /= len;
    }
    code
}

/// Lấy thông tin mã giới thiệu của user đang đăng nhập.
/// Nếu chưa có thì trả về { code: null }.
#[tauri::command]
pub async fn referral_get_my_code(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let user_id = svc.get_user_id().await.ok_or("Vui lòng đăng nhập lại.")?;
    let base = svc.config.url.trim_end_matches('/');

    let url = format!(
        "{base}/rest/v1/referral_codes?user_id=eq.{}&select=id,code,total_uses,total_earned&limit=1",
        urlencoding::encode(&user_id)
    );
    let rows = svc.http_get_admin(&url).await.map_err(|e| e.to_string())?;
    let row = rows.as_array().and_then(|a| a.first()).cloned();

    let profile_url = format!(
        "{base}/rest/v1/profiles?id=eq.{}&select=username,referral_balance&limit=1",
        urlencoding::encode(&user_id)
    );
    let profiles = svc.http_get_admin(&profile_url).await.unwrap_or(json!([]));
    let profile = profiles.as_array().and_then(|a| a.first()).cloned().unwrap_or(json!({}));

    match row {
        Some(r) => {
            let total_uses = r.get("total_uses").and_then(|v| v.as_i64()).unwrap_or(0);
            let discount_pct = referral_discount_percent(total_uses);
            let tier = if total_uses >= 50 { 3 } else if total_uses >= 20 { 2 } else { 1 };
            Ok(json!({
                "code": r.get("code"),
                "id": r.get("id"),
                "total_uses": total_uses,
                "total_earned": r.get("total_earned"),
                "discount_percent": discount_pct,
                "tier": tier,
                "username": profile.get("username"),
                "referral_balance": profile.get("referral_balance").and_then(|v| v.as_i64()).unwrap_or(0),
            }))
        }
        None => Ok(json!({
            "code": null,
            "total_uses": 0,
            "total_earned": 0,
            "discount_percent": 15,
            "tier": 1,
            "username": profile.get("username"),
            "referral_balance": profile.get("referral_balance").and_then(|v| v.as_i64()).unwrap_or(0),
        })),
    }
}

/// Tạo mã giới thiệu mới cho user đang đăng nhập.
/// Chỉ cho phép tạo 1 lần — nếu đã có thì trả về lỗi.
#[tauri::command]
pub async fn referral_create_code(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let user_id = svc.get_user_id().await.ok_or("Vui lòng đăng nhập lại.")?;
    let base = svc.config.url.trim_end_matches('/');

    // Kiểm tra đã có chưa
    let check_url = format!(
        "{base}/rest/v1/referral_codes?user_id=eq.{}&select=code&limit=1",
        urlencoding::encode(&user_id)
    );
    let existing = svc.http_get_admin(&check_url).await.map_err(|e| e.to_string())?;
    if existing.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
        return Err("Bạn đã có mã giới thiệu rồi.".into());
    }

    // Tạo mã ngẫu nhiên, retry nếu trùng
    let mut code = referral_random_code();
    for _ in 0..5 {
        let chk = format!(
            "{base}/rest/v1/referral_codes?code=eq.{}&select=id&limit=1",
            urlencoding::encode(&code)
        );
        let dup = svc.http_get_admin(&chk).await.unwrap_or(json!([]));
        if dup.as_array().map(|a| a.is_empty()).unwrap_or(true) {
            break;
        }
        code = referral_random_code();
    }

    let ins_url = format!("{base}/rest/v1/referral_codes");
    svc.http_post_admin_upsert(
        &ins_url,
        &json!({ "user_id": user_id, "code": code }),
    )
    .await
    .map_err(|e| format!("Không tạo được mã: {e}"))?;

    Ok(json!({ "success": true, "code": code }))
}

/// Validate mã giới thiệu khi user nhập lúc mua game.
/// Trả về thông tin mã + % giảm.
#[tauri::command]
pub async fn referral_validate_code(
    state: State<'_, AppState>,
    code: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let base = svc.config.url.trim_end_matches('/');
    let clean = code.trim().to_uppercase();
    if clean.is_empty() {
        return Err("Mã giới thiệu không được để trống.".into());
    }

    let url = format!(
        "{base}/rest/v1/referral_codes?code=eq.{}&select=id,user_id,total_uses&limit=1",
        urlencoding::encode(&clean)
    );
    let rows = svc.http_get_admin(&url).await.map_err(|e| e.to_string())?;
    let row = rows
        .as_array()
        .and_then(|a| a.first())
        .ok_or("Mã giới thiệu không tồn tại.")?;

    let total_uses = row.get("total_uses").and_then(|v| v.as_i64()).unwrap_or(0);
    let discount_pct = referral_discount_percent(total_uses);

    // Không cho user dùng mã của chính mình
    let buyer_id = svc.get_user_id().await.unwrap_or_default();
    let owner_id = row.get("user_id").and_then(|v| v.as_str()).unwrap_or("");
    if buyer_id == owner_id {
        return Err("Bạn không thể dùng mã giới thiệu của chính mình.".into());
    }

    // Kiểm tra buyer đã từng dùng bất kỳ mã giới thiệu nào chưa (chỉ dùng 1 lần)
    let used_before_url = format!(
        "{base}/rest/v1/referral_uses?buyer_user_id=eq.{}&select=id&limit=1",
        urlencoding::encode(&buyer_id)
    );
    let used_before = svc.http_get_admin(&used_before_url).await.unwrap_or(json!([]));
    if used_before.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
        return Err("Bạn đã sử dụng mã giới thiệu trước đó rồi. Mỗi tài khoản chỉ được dùng mã 1 lần.".into());
    }

    // Kiểm tra buyer chưa sở hữu game nào (tài khoản mới)
    let owned_url = format!(
        "{base}/rest/v1/user_games?user_id=eq.{}&select=id&limit=1",
        urlencoding::encode(&buyer_id)
    );
    let owned = svc.http_get_admin(&owned_url).await.unwrap_or(json!([]));
    if owned.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
        return Err("Mã giới thiệu chỉ áp dụng cho tài khoản chưa mua game nào.".into());
    }

    Ok(json!({
        "valid": true,
        "code": clean,
        "referral_code_id": row.get("id"),
        "owner_user_id": row.get("user_id"),
        "discount_percent": discount_pct,
    }))
}

// Admin: lấy danh sách tất cả referral codes
#[tauri::command]
pub async fn admin_referral_list(state: State<'_, AppState>) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let base = svc.config.url.trim_end_matches('/');

    // Lấy referral codes trước
    let url = format!(
        "{base}/rest/v1/referral_codes?select=id,code,total_uses,total_earned,user_id,created_at&order=total_uses.desc,created_at.desc"
    );
    let mut rows: Vec<Value> = svc.http_get_admin(&url).await
        .map_err(|e| e.to_string())?
        .as_array()
        .cloned()
        .unwrap_or_default();

    // Lấy username từ profiles cho từng row
    for row in rows.iter_mut() {
        let user_id = row.get("user_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if !user_id.is_empty() {
            let profile_url = format!(
                "{base}/rest/v1/profiles?id=eq.{}&select=username&limit=1",
                urlencoding::encode(&user_id)
            );
            if let Ok(profiles) = svc.http_get_admin(&profile_url).await {
                let username = profiles.as_array()
                    .and_then(|a| a.first())
                    .and_then(|p| p.get("username"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if let Some(obj) = row.as_object_mut() {
                    obj.insert("username".to_string(), json!(username));
                }
            }
        }
    }

    Ok(json!({ "success": true, "data": rows }))
}

// Admin: lấy danh sách uses của 1 mã
#[tauri::command]
pub async fn admin_referral_uses(
    state: State<'_, AppState>,
    referral_code_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let base = svc.config.url.trim_end_matches('/');

    let url = format!(
        "{base}/rest/v1/referral_uses?referral_code_id=eq.{}&select=id,buyer_user_id,game_name,order_amount,discount_percent,discount_amount,commission_amount,created_at&order=created_at.desc",
        urlencoding::encode(&referral_code_id)
    );
    let mut rows: Vec<Value> = svc.http_get_admin(&url).await
        .map_err(|e| e.to_string())?
        .as_array()
        .cloned()
        .unwrap_or_default();

    // Lấy username/display_name từ profiles cho từng buyer
    for row in rows.iter_mut() {
        let buyer_id = row.get("buyer_user_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if !buyer_id.is_empty() {
            let profile_url = format!(
                "{base}/rest/v1/profiles?id=eq.{}&select=username,display_name&limit=1",
                urlencoding::encode(&buyer_id)
            );
            if let Ok(profiles) = svc.http_get_admin(&profile_url).await {
                if let Some(p) = profiles.as_array().and_then(|a| a.first()) {
                    let username = p.get("username").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let display_name = p.get("display_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if let Some(obj) = row.as_object_mut() {
                        obj.insert("username".to_string(), json!(username));
                        obj.insert("display_name".to_string(), json!(display_name));
                    }
                }
            }
        }
    }

    Ok(json!({ "success": true, "data": rows }))
}

// Admin: reset số tiền kiếm được của 1 referral code
#[tauri::command]
pub async fn admin_referral_reset_earned(
    state: State<'_, AppState>,
    referral_code_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let base = svc.config.url.trim_end_matches('/');

    // Lấy user_id để reset referral_balance trong profiles
    let code_url = format!(
        "{base}/rest/v1/referral_codes?id=eq.{}&select=user_id,total_earned&limit=1",
        urlencoding::encode(&referral_code_id)
    );
    let rows = svc.http_get_admin(&code_url).await.map_err(|e| e.to_string())?;
    let row = rows.as_array().and_then(|a| a.first())
        .ok_or("Không tìm thấy mã.")?;
    let owner_id = row.get("user_id").and_then(|v| v.as_str()).unwrap_or("");

    // Reset total_earned về 0
    let patch_code_url = format!(
        "{base}/rest/v1/referral_codes?id=eq.{}",
        urlencoding::encode(&referral_code_id)
    );
    svc.http_patch_admin(&patch_code_url, &json!({ "total_earned": 0 }))
        .await
        .map_err(|e| format!("Không reset được: {e}"))?;

    // Reset referral_balance của owner về 0
    if !owner_id.is_empty() {
        let patch_profile_url = format!(
            "{base}/rest/v1/profiles?id=eq.{}",
            urlencoding::encode(owner_id)
        );
        let _ = svc.http_patch_admin(&patch_profile_url, &json!({ "referral_balance": 0 })).await;
    }

    Ok(json!({ "success": true }))
}

/// Ghi nhận một lần sử dụng referral code sau khi mua game thành công.
/// Được gọi từ frontend SAU KHI purchase_game thành công.
#[tauri::command]
pub async fn referral_record_use(
    state: State<'_, AppState>,
    referral_code_id: String,
    game_id: String,
    game_name: String,
    order_amount: i64,    // giá gốc
    final_amount: i64,    // giá sau giảm
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let buyer_id = svc.get_user_id().await.ok_or("Vui lòng đăng nhập lại.")?;
    let base = svc.config.url.trim_end_matches('/');

    // Lấy thông tin referral code
    let code_url = format!(
        "{base}/rest/v1/referral_codes?id=eq.{}&select=id,user_id,total_uses,total_earned&limit=1",
        urlencoding::encode(&referral_code_id)
    );
    let rows = svc.http_get_admin(&code_url).await.map_err(|e| e.to_string())?;
    let row = rows.as_array().and_then(|a| a.first())
        .ok_or("Referral code không tồn tại.")?;

    let owner_id = row.get("user_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let total_uses = row.get("total_uses").and_then(|v| v.as_i64()).unwrap_or(0);
    let total_earned = row.get("total_earned").and_then(|v| v.as_i64()).unwrap_or(0);

    // Không cho tự dùng mã mình
    if buyer_id == owner_id {
        return Err("Không thể dùng mã của chính mình.".into());
    }

    // Kiểm tra buyer đã từng dùng bất kỳ mã nào chưa (chỉ được dùng 1 lần)
    let used_before_url = format!(
        "{base}/rest/v1/referral_uses?buyer_user_id=eq.{}&select=id&limit=1",
        urlencoding::encode(&buyer_id)
    );
    let used_before = svc.http_get_admin(&used_before_url).await.unwrap_or(json!([]));
    if used_before.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
        return Ok(json!({ "success": false, "skipped": true, "reason": "already_used_referral" }));
    }

    // Kiểm tra buyer chưa sở hữu game nào trước khi mua (tài khoản mới)
    // Lúc này game đã được mua, nên chỉ check nếu user_games có đúng 1 game (game vừa mua)
    let owned_url = format!(
        "{base}/rest/v1/user_games?user_id=eq.{}&select=id",
        urlencoding::encode(&buyer_id)
    );
    let owned = svc.http_get_admin(&owned_url).await.unwrap_or(json!([]));
    let owned_count = owned.as_array().map(|a| a.len()).unwrap_or(0);
    // Nếu user đã có hơn 1 game thì không áp dụng (tài khoản không phải mới)
    if owned_count > 1 {
        return Ok(json!({ "success": false, "skipped": true, "reason": "not_new_account" }));
    }

    let discount_pct = referral_discount_percent(total_uses);
    // discount_amount = giá gốc * % / 100 (= số tiền người mua được giảm = số tiền chủ mã nhận)
    let discount_amount = (order_amount * discount_pct) / 100;

    // Kiểm tra buyer chưa dùng mã này cho game này (tránh duplicate)
    let dup_url = format!(
        "{base}/rest/v1/referral_uses?referral_code_id=eq.{}&buyer_user_id=eq.{}&game_id=eq.{}&select=id&limit=1",
        urlencoding::encode(&referral_code_id),
        urlencoding::encode(&buyer_id),
        urlencoding::encode(&game_id)
    );
    let dup = svc.http_get_admin(&dup_url).await.unwrap_or(json!([]));
    if dup.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
        return Ok(json!({ "success": true, "skipped": true, "reason": "already_used" }));
    }

    // Insert referral_uses
    let ins_url = format!("{base}/rest/v1/referral_uses");
    svc.http_post_admin_upsert(&ins_url, &json!({
        "referral_code_id": referral_code_id,
        "buyer_user_id": buyer_id,
        "game_id": game_id,
        "game_name": game_name,
        "order_amount": order_amount,
        "discount_percent": discount_pct,
        "discount_amount": discount_amount,
        "commission_amount": discount_amount,
    })).await.map_err(|e| format!("Lỗi ghi referral use: {e}"))?;

    // Cập nhật total_uses + total_earned trong referral_codes
    let patch_code_url = format!(
        "{base}/rest/v1/referral_codes?id=eq.{}",
        urlencoding::encode(&referral_code_id)
    );
    let _ = svc.http_patch_admin(&patch_code_url, &json!({
        "total_uses": total_uses + 1,
        "total_earned": total_earned + discount_amount,
    })).await;

    // Cộng referral_balance cho chủ mã
    if !owner_id.is_empty() {
        let owner_profile_url = format!(
            "{base}/rest/v1/profiles?id=eq.{}&select=referral_balance&limit=1",
            urlencoding::encode(&owner_id)
        );
        let owner_rows = svc.http_get_admin(&owner_profile_url).await.unwrap_or(json!([]));
        let owner_rb = owner_rows.as_array().and_then(|a| a.first())
            .and_then(|r| r.get("referral_balance"))
            .and_then(|v| v.as_i64()).unwrap_or(0);
        let patch_owner_url = format!(
            "{base}/rest/v1/profiles?id=eq.{}",
            urlencoding::encode(&owner_id)
        );
        let new_rb = owner_rb + discount_amount;
        match svc.http_patch_admin(&patch_owner_url, &json!({
            "referral_balance": new_rb,
        })).await {
            Ok(_) => {},
            Err(e) => {
                // Không block nhưng trả về warning trong response
                return Ok(json!({
                    "success": true,
                    "discount_amount": discount_amount,
                    "discount_percent": discount_pct,
                    "commission_amount": discount_amount,
                    "warning": format!("Ghi nhận thành công nhưng không cập nhật được số dư chủ mã: {}", e),
                }));
            }
        }
    }

    Ok(json!({
        "success": true,
        "discount_amount": discount_amount,
        "discount_percent": discount_pct,
        "commission_amount": discount_amount,
    }))
}
