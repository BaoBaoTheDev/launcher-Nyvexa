use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::services::crypto::{random_base32_secret, verify_totp_code};
use crate::state::AppState;

#[tauri::command]
pub async fn get_supabase_config(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(state.supabase.public_config())
}

#[tauri::command]
pub async fn supabase_sign_in(
    state: State<'_, AppState>,
    data: Value,
) -> Result<Value, String> {
    let email = data.get("email").and_then(|v| v.as_str()).unwrap_or("");
    let password = data.get("password").and_then(|v| v.as_str()).unwrap_or("");
    let device_id = data.get("deviceId").and_then(|v| v.as_str());

    let result = state
        .supabase
        .sign_in(email, password, device_id)
        .await;

    if result.success {
        if let Some(handle) = state.app_handle.lock().await.clone() {
            let _ = handle.emit("auth:stateChange", json!({ "event": "SIGNED_IN" }));
        }
    }

    Ok(serde_json::to_value(result).unwrap_or(json!({ "success": false })))
}

#[tauri::command]
pub async fn supabase_sign_up(state: State<'_, AppState>, data: Value) -> Result<Value, String> {
    Ok(state
        .supabase
        .sign_up(
            data.get("email").and_then(|v| v.as_str()).unwrap_or(""),
            data.get("password").and_then(|v| v.as_str()).unwrap_or(""),
            data.get("displayName").and_then(|v| v.as_str()).unwrap_or(""),
            data.get("username").and_then(|v| v.as_str()).unwrap_or(""),
        )
        .await)
}

#[tauri::command]
pub async fn supabase_sign_out(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    state.supabase.sign_out().await?;
    let _ = app.emit("auth:stateChange", json!({ "event": "SIGNED_OUT" }));
    Ok(())
}

#[tauri::command]
pub async fn supabase_send_otp(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    let email = payload
        .get("email")
        .and_then(|v| v.as_str())
        .or_else(|| payload.as_str())
        .unwrap_or("");
    let purpose = payload.get("purpose").and_then(|v| v.as_str());
    Ok(state.supabase.send_otp(email, purpose).await)
}

#[tauri::command]
pub async fn supabase_verify_otp(
    state: State<'_, AppState>,
    data: Value,
) -> Result<Value, String> {
    let email = data.get("email").and_then(|v| v.as_str()).unwrap_or("");
    let code = data.get("code").and_then(|v| v.as_str()).unwrap_or("");
    Ok(state.supabase.verify_otp(email, code).await)
}

#[tauri::command]
pub async fn supabase_get_session(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(state
        .supabase
        .get_session(true, false)
        .await
        .map(|v| v.into())
        .unwrap_or(Value::Null))
}

#[tauri::command]
pub async fn supabase_get_profile(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(state
        .supabase
        .get_session(true, false)
        .await
        .map(|v| v.into())
        .unwrap_or(Value::Null))
}

#[tauri::command]
pub async fn supabase_get_profile_slim(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(state
        .supabase
        .get_session(false, true)
        .await
        .map(|v| v.into())
        .unwrap_or(Value::Null))
}

#[tauri::command]
pub async fn supabase_get_session_lite(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(state
        .supabase
        .get_session_lite()
        .await
        .map(|v| v.into())
        .unwrap_or(Value::Null))
}

#[tauri::command]
pub async fn supabase_update_profile(
    state: State<'_, AppState>,
    updates: Value,
) -> Result<Value, String> {
    Ok(state.supabase.update_profile(updates).await)
}

#[tauri::command]
pub async fn supabase_update_password_admin(
    state: State<'_, AppState>,
    data: Value,
) -> Result<Value, String> {
    Ok(state
        .supabase
        .update_password_admin(
            data.get("email").and_then(|v| v.as_str()).unwrap_or(""),
            data.get("password").and_then(|v| v.as_str()).unwrap_or(""),
        )
        .await)
}

/// Xác minh mật khẩu hiện tại bằng cách gọi /auth/v1/token với grant_type=password
/// nhưng KHÔNG ghi đè session đang đăng nhập của user.
/// Dùng cho luồng đổi mật khẩu trong trang hồ sơ.
#[tauri::command]
pub async fn supabase_verify_password(
    state: State<'_, AppState>,
    data: Value,
) -> Result<Value, String> {
    let email = data.get("email").and_then(|v| v.as_str()).unwrap_or("");
    let password = data.get("password").and_then(|v| v.as_str()).unwrap_or("");
    Ok(state.supabase.verify_password(email, password).await)
}

#[tauri::command]
pub async fn supabase_check_username(
    state: State<'_, AppState>,
    data: Value,
) -> Result<Value, String> {
    let username = data.get("username").and_then(|v| v.as_str()).unwrap_or("");
    Ok(state.supabase.check_username_available(username).await)
}

#[tauri::command]
pub async fn supabase_verify_device_session(_data: Value) -> Result<Value, String> {
    Ok(json!({ "valid": true }))
}

#[tauri::command]
pub async fn supabase_complete_device_verification_and_sign_in(_payload: Value) -> Result<Value, String> {
    Ok(json!({
        "success": false,
        "message": "Tính năng xác thực thiết bị mới đã bị tắt."
    }))
}

#[tauri::command]
pub async fn supabase_generate_totp_secret(_payload: Value) -> Result<Value, String> {
    Ok(json!({
        "success": false,
        "message": "Tính năng 2FA đã bị tắt."
    }))
}

#[tauri::command]
pub async fn supabase_enable_totp2fa(_payload: Value) -> Result<Value, String> {
    Ok(json!({
        "success": false,
        "message": "Tính năng 2FA đã bị tắt."
    }))
}

#[tauri::command]
pub async fn supabase_disable_totp2fa(_payload: Value) -> Result<Value, String> {
    Ok(json!({
        "success": false,
        "message": "Tính năng 2FA đã bị tắt."
    }))
}

#[tauri::command]
pub async fn supabase_get_local_profile_snapshot(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(state
        .supabase
        .get_local_profile_snapshot()
        .map(|v| v.into())
        .unwrap_or(Value::Null))
}

#[tauri::command]
pub async fn supabase_set_local_profile_snapshot(
    state: State<'_, AppState>,
    payload: Value,
) -> Result<Value, String> {
    Ok(state.supabase.set_local_profile_snapshot(payload))
}

// Internal TOTP helpers kept for future 2FA enablement
#[allow(dead_code)]
pub fn verify_totp_internal(secret: &str, code: &str) -> bool {
    verify_totp_code(secret, code, 1)
}

#[allow(dead_code)]
pub fn generate_totp_secret_internal() -> String {
    random_base32_secret(32)
}
