/// Wallet / Deposits — SePay payment integration
use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

const SEPAY_BANK_ID: &str = "MBBank";
const SEPAY_ACCOUNT_NO: &str = "0364663787";
const SEPAY_ACCOUNT_NAME: &str = "HA TRUNG THANH";

/// Tạo payment QR cho deposit dùng SePay.
/// Flow:
///   1. Validate discount_code (nếu có) → tính pay_amount
///   2. Generate order_code unique
///   3. Insert deposits (status PENDING; nếu pay_amount=0 → PAID ngay)
///   4. Nếu pay_amount=0: cộng balance, ghi redemption, return instantPaid
///   5. Ngược lại trả QR theo pay_amount
#[tauri::command]
pub async fn wallet_create_payment(
    state: State<'_, AppState>,
    amount: i64,
    discount_code: Option<String>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();

    if amount < 50_000 {
        return Ok(json!({
            "success": false,
            "message": "Số tiền tối thiểu là 50.000 ₫"
        }));
    }
    if amount > 100_000_000 {
        return Ok(json!({
            "success": false,
            "message": "Số tiền tối đa là 100.000.000 ₫"
        }));
    }

    let user_id = svc.get_user_id().await
        .ok_or_else(|| "Chưa đăng nhập".to_string())?;

    if svc.config.service_key.is_empty() {
        return Err("Hệ thống chưa cấu hình thanh toán (thiếu service key).".into());
    }

    // ── Validate discount code (nếu có) ──────────────────────────────────
    let mut pay_amount: i64 = amount;
    let mut discount_amount: i64 = 0;
    let mut applied_code: Option<(String, String)> = None; // (code_id, code_upper)

    if let Some(raw) = discount_code.as_ref() {
        let code = raw.trim().to_uppercase();
        if !code.is_empty() {
            let info = validate_deposit_code(&svc, &code, amount).await?;
            if !info.success {
                return Ok(json!({
                    "success": false,
                    "message": info.message,
                }));
            }
            pay_amount = info.pay_amount;
            discount_amount = info.discount_amount;
            applied_code = Some((info.code_id, code));
        }
    }

    // Generate order_code: timestamp seconds + random 4 digits
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let random: u64 = (now_secs % 10_000) ^ ((amount as u64) & 0xFFFF);
    let order_code: i64 = (now_secs * 10_000 + random) as i64;

    // Nếu pay_amount = 0 → tạo PAID luôn (instant deposit)
    let instant_paid = pay_amount == 0;
    let status_str = if instant_paid { "PAID" } else { "PENDING" };

    // Insert vào deposits
    let base = svc.config.url.trim_end_matches('/').to_string();
    let insert_url = format!("{base}/rest/v1/deposits");
    let body = json!({
        "user_id": user_id,
        "amount": amount,
        "pay_amount": pay_amount,
        "order_code": order_code,
        "status": status_str,
        "discount_code": applied_code.as_ref().map(|(_, c)| c.clone()),
        "discount_code_id": applied_code.as_ref().map(|(id, _)| id.clone()),
        "discount_amount": discount_amount,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Lỗi tạo HTTP client: {e}"))?;

    let resp = client
        .post(&insert_url)
        .header("Authorization", format!("Bearer {}", svc.config.service_key))
        .header("apikey", &svc.config.anon_key)
        .header("Content-Type", "application/json")
        .header("Prefer", "return=representation")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Lỗi tạo deposit: {e}"))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Tạo deposit thất bại: {text}"));
    }

    let rows: Vec<Value> = resp.json().await.map_err(|e| format!("Parse response lỗi: {e}"))?;
    let deposit = rows.first()
        .ok_or_else(|| "Không nhận được deposit từ DB".to_string())?;
    let deposit_id = deposit.get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // ── Instant paid: cộng balance + ghi redemption ──────────────────────
    if instant_paid {
        if let Err(e) = credit_balance(&svc, &user_id, amount).await {
            // Rollback deposit nếu cộng balance fail
            let rollback_url = format!(
                "{base}/rest/v1/deposits?id=eq.{}",
                urlencoding::encode(&deposit_id)
            );
            let _ = svc.http_patch_admin(&rollback_url, &json!({ "status": "FAILED" })).await;
            return Err(format!("Lỗi cộng balance: {e}"));
        }

        if let Some((code_id, _)) = applied_code.as_ref() {
            record_deposit_redemption(&svc, code_id, &user_id, &deposit_id, amount, discount_amount).await;
        }

        return Ok(json!({
            "success": true,
            "instantPaid": true,
            "depositId": deposit_id,
            "orderCode": order_code.to_string(),
            "amount": amount,
            "payAmount": 0,
            "discountAmount": discount_amount,
            "message": "Đã nạp thành công bằng mã giảm giá 100%",
        }));
    }

    // ── Bình thường: tạo QR cho pay_amount ───────────────────────────────
    // Nếu có applied code (pay_amount > 0) thì increment current_uses + ghi redemption
    // sau khi webhook xác nhận PAID. Hiện tại chưa, sẽ làm trong webhook.

    let content = format!("NYV{order_code}");
    let qr_url = format!(
        "https://qr.sepay.vn/img?acc={}&bank={}&amount={}&des={}",
        SEPAY_ACCOUNT_NO,
        SEPAY_BANK_ID,
        pay_amount,
        content
    );

    Ok(json!({
        "success": true,
        "instantPaid": false,
        "depositId": deposit_id,
        "orderCode": order_code.to_string(),
        "amount": amount,
        "payAmount": pay_amount,
        "discountAmount": discount_amount,
        "qrUrl": qr_url,
        "content": content,
        "bankId": SEPAY_BANK_ID,
        "accountNo": SEPAY_ACCOUNT_NO,
        "accountName": SEPAY_ACCOUNT_NAME,
    }))
}

// ─── Discount helpers ───────────────────────────────────────────────────────

struct DepositCodeValidation {
    success: bool,
    message: String,
    code_id: String,
    pay_amount: i64,
    discount_amount: i64,
}

/// Validate deposit-only discount code và tính số tiền cần trả.
async fn validate_deposit_code(
    svc: &std::sync::Arc<crate::services::supabase::SupabaseService>,
    code_upper: &str,
    deposit_amount: i64,
) -> Result<DepositCodeValidation, String> {
    let base = svc.config.url.trim_end_matches('/');
    let url = format!(
        "{base}/rest/v1/discount_codes?code=eq.{}&select=*&limit=1",
        urlencoding::encode(code_upper)
    );

    let rows = svc.http_get_admin(&url).await.map_err(|e| format!("Lỗi tải mã: {e}"))?;
    let dc = match rows.as_array().and_then(|a| a.first()) {
        Some(d) => d.clone(),
        None => return Ok(DepositCodeValidation {
            success: false,
            message: "Mã giảm giá không tồn tại".into(),
            code_id: String::new(), pay_amount: deposit_amount, discount_amount: 0,
        }),
    };

    let is_active = dc.get("is_active").and_then(|v| v.as_bool()).unwrap_or(false);
    if !is_active {
        return Ok(DepositCodeValidation {
            success: false, message: "Mã đã vô hiệu hóa".into(),
            code_id: String::new(), pay_amount: deposit_amount, discount_amount: 0,
        });
    }

    if let Some(exp_str) = dc.get("expires_at").and_then(|v| v.as_str()) {
        if !exp_str.is_empty() {
            if let Ok(exp) = chrono::DateTime::parse_from_rfc3339(exp_str) {
                if exp.with_timezone(&chrono::Utc) < chrono::Utc::now() {
                    return Ok(DepositCodeValidation {
                        success: false, message: "Mã đã hết hạn".into(),
                        code_id: String::new(), pay_amount: deposit_amount, discount_amount: 0,
                    });
                }
            }
        }
    }

    let dc_type = dc.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if dc_type != "deposit_fixed" && dc_type != "deposit_percent" {
        return Ok(DepositCodeValidation {
            success: false, message: "Mã này không áp dụng cho nạp tiền".into(),
            code_id: String::new(), pay_amount: deposit_amount, discount_amount: 0,
        });
    }

    let max_uses = dc.get("max_uses").and_then(|v| v.as_i64());
    let current_uses = dc.get("current_uses").and_then(|v| v.as_i64()).unwrap_or(0);
    if let Some(mu) = max_uses {
        if current_uses >= mu {
            return Ok(DepositCodeValidation {
                success: false, message: "Mã đã hết lượt sử dụng".into(),
                code_id: String::new(), pay_amount: deposit_amount, discount_amount: 0,
            });
        }
    }

    let value = dc.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let discount_amount = match dc_type.as_str() {
        "deposit_fixed" => (value as i64).min(deposit_amount).max(0),
        "deposit_percent" => {
            let pct = (value / 100.0).clamp(0.0, 1.0);
            ((deposit_amount as f64) * pct).round() as i64
        }
        _ => 0,
    };
    let pay_amount = (deposit_amount - discount_amount).max(0);

    let code_id = dc.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();

    Ok(DepositCodeValidation {
        success: true, message: String::new(),
        code_id, pay_amount, discount_amount,
    })
}

/// Cộng số tiền vào balance của user (read + write, không atomic nhưng đủ dùng).
/// `balance` trong profiles là NUMERIC(14,2) → PostgREST trả về dạng string,
/// nên dùng as_str().parse::<f64>() thay vì as_i64() để không mất giá trị cũ.
async fn credit_balance(
    svc: &std::sync::Arc<crate::services::supabase::SupabaseService>,
    user_id: &str,
    amount: i64,
) -> Result<(), String> {
    let base = svc.config.url.trim_end_matches('/');
    let read_url = format!(
        "{base}/rest/v1/profiles?id=eq.{}&select=balance",
        urlencoding::encode(user_id)
    );
    let rows = svc.http_get_admin(&read_url).await.map_err(|e| format!("read profile: {e}"))?;

    // NUMERIC(14,2) có thể về dưới dạng:
    //   - JSON number: 500000.0  → as_f64()
    //   - JSON string: "500000.00" → as_str() rồi parse
    let cur_f64: f64 = rows.as_array().and_then(|a| a.first())
        .and_then(|r| r.get("balance"))
        .and_then(|v| {
            if let Some(n) = v.as_f64() { return Some(n); }
            if let Some(s) = v.as_str() { return s.parse::<f64>().ok(); }
            None
        })
        .unwrap_or_else(|| {
            eprintln!("[credit_balance] WARN: không parse được balance, fallback 0");
            0.0
        });

    let new_balance = cur_f64 + (amount as f64);

    let patch_url = format!(
        "{base}/rest/v1/profiles?id=eq.{}",
        urlencoding::encode(user_id)
    );
    svc.http_patch_admin(&patch_url, &json!({ "balance": new_balance })).await
        .map_err(|e| format!("update balance: {e}"))?;

    eprintln!("[credit_balance] user={user_id} +{amount} → {new_balance}");
    Ok(())
}

/// Lưu redemption + tăng current_uses cho deposit code.
async fn record_deposit_redemption(
    svc: &std::sync::Arc<crate::services::supabase::SupabaseService>,
    code_id: &str,
    user_id: &str,
    deposit_id: &str,
    deposit_amount: i64,
    discount_amount: i64,
) {
    let base = svc.config.url.trim_end_matches('/');

    let red_url = format!("{base}/rest/v1/discount_code_redemptions");
    let _ = svc.http_post_admin_upsert(&red_url, &json!({
        "code_id": code_id,
        "user_id": user_id,
        "order_type": "deposit",
        "order_id": deposit_id,
        "order_amount": deposit_amount,
        "discount_amount": discount_amount,
    })).await;

    let read_url = format!(
        "{base}/rest/v1/discount_codes?id=eq.{}&select=current_uses",
        urlencoding::encode(code_id)
    );
    if let Ok(rows) = svc.http_get_admin(&read_url).await {
        if let Some(uses) = rows.as_array().and_then(|a| a.first())
            .and_then(|r| r.get("current_uses")).and_then(|v| v.as_i64()) {
            let patch_url = format!(
                "{base}/rest/v1/discount_codes?id=eq.{}",
                urlencoding::encode(code_id)
            );
            let _ = svc.http_patch_admin(&patch_url, &json!({
                "current_uses": uses + 1
            })).await;
        }
    }
}

/// Kiểm tra trạng thái deposit theo ID. Đồng thời nếu deposit đã PAID
/// nhưng client chưa biết, tự động trả balance hiện tại.
#[tauri::command]
pub async fn wallet_check_status(
    state: State<'_, AppState>,
    deposit_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = svc.get_access_token().await
        .ok_or_else(|| "Chưa đăng nhập".to_string())?;

    if deposit_id.is_empty() {
        return Err("Thiếu deposit_id".into());
    }

    let url = format!(
        "{}/rest/v1/deposits?id=eq.{}&select=id,status,amount,pay_amount,order_code,created_at",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&deposit_id)
    );

    let rows = svc.http_get_authed(&url, &token).await
        .map_err(|e| format!("Lỗi check status: {e}"))?;

    let deposit = rows.as_array().and_then(|a| a.first());
    let mut payload = match deposit {
        Some(d) => json!({
            "success": true,
            "status": d.get("status").and_then(|v| v.as_str()).unwrap_or("PENDING"),
            "amount": d.get("amount"),
            "pay_amount": d.get("pay_amount"),
            "order_code": d.get("order_code"),
            "created_at": d.get("created_at"),
        }),
        None => return Ok(json!({
            "success": false,
            "message": "Không tìm thấy giao dịch"
        })),
    };

    // Nếu deposit đã PAID, lấy balance mới của user để client cập nhật
    let status_str = payload.get("status").and_then(|v| v.as_str()).unwrap_or("").to_uppercase();
    if status_str == "PAID" || status_str == "SUCCESS" || status_str == "COMPLETED" {
        if let Some(uid) = svc.get_user_id().await {
            let bal_url = format!(
                "{}/rest/v1/profiles?id=eq.{}&select=balance",
                svc.config.url.trim_end_matches('/'),
                urlencoding::encode(&uid)
            );
            if let Ok(rows) = svc.http_get_authed(&bal_url, &token).await {
                if let Some(bal_f64) = rows.as_array().and_then(|a| a.first())
                    .and_then(|r| r.get("balance"))
                    .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok())))
                {
                    payload["balance"] = json!(bal_f64);
                }
            }
        }
    }

    Ok(payload)
}

/// Lấy lịch sử nạp tiền của user
#[tauri::command]
pub async fn wallet_list_deposits(
    state: State<'_, AppState>,
    limit: Option<i32>,
) -> Result<Value, String> {
    let svc = state.supabase.clone();
    let token = svc.get_access_token().await
        .ok_or_else(|| "Chưa đăng nhập".to_string())?;
    let user_id = svc.get_user_id().await
        .ok_or_else(|| "Chưa đăng nhập".to_string())?;

    let lim = limit.unwrap_or(50).clamp(1, 200);
    let url = format!(
        "{}/rest/v1/deposits?user_id=eq.{}&select=id,amount,order_code,status,created_at&order=created_at.desc&limit={}",
        svc.config.url.trim_end_matches('/'),
        urlencoding::encode(&user_id),
        lim
    );

    match svc.http_get_authed(&url, &token).await {
        Ok(rows) => Ok(json!({
            "success": true,
            "data": rows,
        })),
        Err(e) => Ok(json!({
            "success": false,
            "data": [],
            "message": e,
        })),
    }
}

/// Hủy deposit (chỉ khi status=PENDING). Đổi status → CANCELLED.
#[tauri::command]
pub async fn wallet_cancel_deposit(
    state: State<'_, AppState>,
    deposit_id: String,
) -> Result<Value, String> {
    let svc = state.supabase.clone();

    if svc.config.service_key.is_empty() {
        return Err("Hệ thống chưa cấu hình thanh toán (thiếu service key)".into());
    }

    let user_id = svc.get_user_id().await
        .ok_or_else(|| "Chưa đăng nhập".to_string())?;

    if deposit_id.is_empty() {
        return Err("Thiếu deposit_id".into());
    }

    // Chỉ update khi status=PENDING + đúng owner
    let base = svc.config.url.trim_end_matches('/').to_string();
    let url = format!(
        "{base}/rest/v1/deposits?id=eq.{}&user_id=eq.{}&status=eq.PENDING",
        urlencoding::encode(&deposit_id),
        urlencoding::encode(&user_id)
    );

    let body = json!({ "status": "CANCELLED" });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Lỗi tạo HTTP client: {e}"))?;

    let resp = client
        .patch(&url)
        .header("Authorization", format!("Bearer {}", svc.config.service_key))
        .header("apikey", &svc.config.anon_key)
        .header("Content-Type", "application/json")
        .header("Prefer", "return=representation")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Lỗi cancel deposit: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Cancel deposit thất bại ({status}): {text}"));
    }

    let rows: Value = resp.json().await.unwrap_or(json!([]));
    let updated_count = rows.as_array().map(|a| a.len()).unwrap_or(0);

    Ok(json!({
        "success": true,
        "cancelled": updated_count > 0,
    }))
}
