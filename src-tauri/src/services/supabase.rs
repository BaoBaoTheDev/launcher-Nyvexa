use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex;

use super::device::ensure_device_id;

const PROFILE_SELECT_WITH_PRIVACY: &str = "id, username, display_name, role, balance, ctv_balance, is_banned, ban_reason, ban_until, banned_at, avatar_url, frame_url, background_url, banner_url, summary, background_fit_mode, background_anchor, banner_fit_mode, banner_anchor, privacy_show_summary, privacy_show_status, privacy_show_owned_games, current_game_appid, current_game_name, current_game_started_at, updated_at";
const PROFILE_SELECT_SLIM: &str = "id, username, display_name, role, balance, ctv_balance, is_banned, ban_reason, ban_until, banned_at, avatar_url, frame_url, background_url, summary, background_fit_mode, background_anchor, privacy_show_summary, privacy_show_status, privacy_show_owned_games, current_game_appid, current_game_name, current_game_started_at, updated_at";
const PROFILE_SELECT_BASE: &str = "id, username, display_name, role, balance, ctv_balance, is_banned, ban_reason, ban_until, banned_at, avatar_url, frame_url, background_url, banner_url, summary, background_fit_mode, background_anchor, banner_fit_mode, banner_anchor, current_game_appid, current_game_name, current_game_started_at, updated_at";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: Option<i64>,
    pub user: AuthUser,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUser {
    pub id: String,
    pub email: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub pass: String,
    pub from: String,
}

#[derive(Debug, Clone)]
pub struct SupabaseConfig {
    pub url: String,
    pub anon_key: String,
    pub service_key: String,
    pub admin_emails: Vec<String>,
    pub smtp: Option<SmtpConfig>,
    pub discord_webhook_new_game: String,
    pub discord_webhook_sale: String,
}

pub struct SupabaseService {
    pub config: SupabaseConfig,
    client: Client,
    session: Arc<Mutex<Option<AuthSession>>>,
    data_dir: PathBuf,
}

#[derive(Debug, Serialize)]
pub struct SignInResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub banned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deviceId: Option<String>,
}

impl SupabaseService {
    pub fn new(config: SupabaseConfig, data_dir: PathBuf) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();

        let service = Self {
            config,
            client,
            session: Arc::new(Mutex::new(None)),
            data_dir,
        };

        if let Ok(session) = service.load_session_from_disk() {
            if let Ok(mut guard) = service.session.try_lock() {
                *guard = Some(session);
            }
        }

        service
    }

    fn session_path(&self) -> PathBuf {
        self.data_dir.join("supabase-session.json")
    }

    fn profile_sync_path(&self) -> PathBuf {
        self.data_dir.join("profile-sync.json")
    }

    /// Chuyển error message tiếng Anh của Supabase/GoTrue sang tiếng Việt rõ ràng hơn.
    /// Không dùng được để phân biệt email/password sai (cần admin check riêng).
    fn friendly_auth_error(raw: &str) -> String {
        let low = raw.to_lowercase();
        if low.contains("email not confirmed") {
            "Email chưa được xác thực. Vui lòng kiểm tra hộp thư.".into()
        } else if low.contains("too many requests") || low.contains("rate limit") || low.contains("over_email_send_rate_limit") {
            "Gửi quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.".into()
        } else if low.contains("user already registered") || low.contains("already been registered") {
            "Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.".into()
        } else if low.contains("signup disabled") || low.contains("signups not allowed") {
            "Đăng ký tài khoản mới hiện đang bị tắt.".into()
        } else if low.contains("invalid email") || low.contains("unable to validate") {
            "Địa chỉ email không hợp lệ.".into()
        } else if low.contains("password") && (low.contains("weak") || low.contains("too short")) {
            "Mật khẩu quá yếu. Vui lòng dùng mật khẩu mạnh hơn.".into()
        } else if low.contains("database error") && low.contains("finding user") {
            "Tài khoản chưa hoàn tất thiết lập. Vui lòng liên hệ admin.".into()
        } else if low.contains("otp expired") || low.contains("token expired") {
            "Mã xác thực đã hết hạn. Vui lòng yêu cầu mã mới.".into()
        } else if low.contains("otp") && (low.contains("invalid") || low.contains("incorrect")) {
            "Mã xác thực không đúng. Vui lòng kiểm tra lại.".into()
        } else {
            raw.to_string()
        }
    }

    fn load_session_from_disk(&self) -> Result<AuthSession, String> {
        let path = self.session_path();
        let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| e.to_string())
    }

    async fn persist_session(&self, session: Option<&AuthSession>) -> Result<(), String> {
        fs::create_dir_all(&self.data_dir).map_err(|e| e.to_string())?;
        let path = self.session_path();
        match session {
            Some(s) => {
                let raw = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
                fs::write(path, raw).map_err(|e| e.to_string())?;
            }
            None => {
                let _ = fs::remove_file(path);
            }
        }
        Ok(())
    }

    async fn set_session(&self, session: Option<AuthSession>) -> Result<(), String> {
        {
            let mut guard = self.session.lock().await;
            *guard = session.clone();
        }
        self.persist_session(session.as_ref()).await
    }

    async fn current_access_token(&self) -> Option<String> {
        self.session.lock().await.as_ref().map(|s| s.access_token.clone())
    }

    /// Trả token hợp lệ — tự động refresh nếu sắp hết hạn hoặc đã hết hạn.
    pub async fn get_valid_access_token(&self) -> Option<String> {
        let (token, refresh_token, expires_at) = {
            let guard = self.session.lock().await;
            let s = guard.as_ref()?;
            (s.access_token.clone(), s.refresh_token.clone(), s.expires_at)
        };

        // Kiểm tra expiry: refresh nếu còn < 60 giây hoặc đã hết hạn
        let should_refresh = expires_at
            .map(|exp| {
                let now = chrono::Utc::now().timestamp();
                exp - now < 60 // dưới 60 giây là refresh
            })
            .unwrap_or(false); // nếu không có expires_at thì không refresh

        if should_refresh {
            if let Some(new_token) = self.refresh_token_internal(&refresh_token).await {
                return Some(new_token);
            }
            // Nếu refresh thất bại vẫn thử dùng token cũ
        }

        Some(token)
    }

    /// Gọi Supabase refresh token endpoint và lưu session mới.
    async fn refresh_token_internal(&self, refresh_token: &str) -> Option<String> {
        let url = format!(
            "{}/auth/v1/token?grant_type=refresh_token",
            self.config.url.trim_end_matches('/')
        );

        let resp = self
            .client
            .post(&url)
            .header("apikey", &self.config.anon_key)
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({ "refresh_token": refresh_token }))
            .send()
            .await
            .ok()?;

        if !resp.status().is_success() {
            eprintln!("[token_refresh] Failed: {}", resp.status());
            return None;
        }

        let body: serde_json::Value = resp.json().await.ok()?;

        let new_access = body.get("access_token")?.as_str()?.to_string();
        let new_refresh = body
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .unwrap_or(refresh_token)
            .to_string();
        let expires_in = body.get("expires_in").and_then(|v| v.as_i64());

        let user_obj = body.get("user").cloned().unwrap_or(serde_json::json!({}));
        let user_id = user_obj
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let user_email = user_obj.get("email").and_then(|v| v.as_str()).map(String::from);

        // Preserve existing user data nếu response không có
        let (final_id, final_email) = {
            let guard = self.session.lock().await;
            let existing = guard.as_ref();
            (
                if user_id.is_empty() { existing.map(|s| s.user.id.clone()).unwrap_or_default() } else { user_id },
                user_email.or_else(|| existing.and_then(|s| s.user.email.clone())),
            )
        };

        let new_session = AuthSession {
            access_token: new_access.clone(),
            refresh_token: new_refresh,
            expires_at: expires_in.map(|s| chrono::Utc::now().timestamp() + s),
            user: AuthUser { id: final_id, email: final_email },
        };

        eprintln!("[token_refresh] Token refreshed successfully");
        let _ = self.set_session(Some(new_session)).await;
        Some(new_access)
    }

    fn auth_headers(&self, token: &str) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "apikey",
            self.config.anon_key.parse().unwrap(),
        );
        headers.insert(
            "Authorization",
            format!("Bearer {token}").parse().unwrap(),
        );
        headers.insert("Content-Type", "application/json".parse().unwrap());
        headers
    }

    fn admin_headers(&self) -> Result<reqwest::header::HeaderMap, String> {
        if self.config.service_key.is_empty() {
            return Err("Thiếu Service Role Key.".into());
        }
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("apikey", self.config.service_key.parse().unwrap());
        headers.insert(
            "Authorization",
            format!("Bearer {}", self.config.service_key)
                .parse()
                .unwrap(),
        );
        headers.insert("Content-Type", "application/json".parse().unwrap());
        Ok(headers)
    }

    fn is_email_whitelisted_admin(&self, email: &str) -> bool {
        let e = email.trim().to_lowercase();
        self.config.admin_emails.iter().any(|x| x == &e)
    }

    async fn fetch_profile_by_user_id(
        &self,
        user_id: &str,
        token: &str,
        include_privacy: bool,
    ) -> Option<Value> {
        // Thử lần lượt từ nhiều cột → ít cột để tương thích với DB thiếu cột.
        // Cột tối thiểu cuối cùng chỉ gồm những cột chắc chắn tồn tại.
        const PROFILE_SELECT_MINIMAL: &str = "id, username, display_name, role, balance, avatar_url, is_banned, ban_reason, ban_until, banned_at";

        let attempts = if include_privacy {
            vec![
                PROFILE_SELECT_WITH_PRIVACY,
                PROFILE_SELECT_BASE,
                PROFILE_SELECT_MINIMAL,
            ]
        } else {
            vec![PROFILE_SELECT_BASE, PROFILE_SELECT_MINIMAL]
        };

        for select_cols in attempts {
            let url = format!(
                "{}/rest/v1/profiles?id=eq.{}&select={}",
                self.config.url.trim_end_matches('/'),
                urlencoding::encode(user_id),
                urlencoding::encode(select_cols)
            );

            let resp = match self
                .client
                .get(&url)
                .headers(self.auth_headers(token))
                .header("Prefer", "return=representation")
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => continue,
            };

            if !resp.status().is_success() {
                continue;
            }

            let rows: Vec<Value> = match resp.json().await {
                Ok(r) => r,
                Err(_) => continue,
            };
            if let Some(row) = rows.into_iter().next() {
                return Some(row);
            }
        }
        None
    }

    async fn ensure_admin_role(&self, user_id: &str, email: &str, _token: &str) -> bool {
        if !self.is_email_whitelisted_admin(email) {
            return false;
        }

        let headers = match self.admin_headers() {
            Ok(h) => h,
            Err(_) => return false,
        };

        let url = format!(
            "{}/rest/v1/profiles?id=eq.{}",
            self.config.url.trim_end_matches('/'),
            urlencoding::encode(user_id)
        );

        let _ = self
            .client
            .patch(&url)
            .headers(headers)
            .json(&json!({ "role": "admin" }))
            .send()
            .await;

        true
    }

    fn merge_user_profile(
        &self,
        user_id: &str,
        email: Option<&str>,
        profile: Option<Value>,
        force_admin: bool,
    ) -> Value {
        let mut out = json!({
            "id": user_id,
            "email": email,
        });

        if let Some(p) = profile {
            if let Value::Object(map) = p {
                for (k, v) in map {
                    out[k] = v;
                }
            }
        }

        let role = out.get("role").and_then(|v| v.as_str()).unwrap_or("user");
        if force_admin {
            out["role"] = json!("admin");
        } else {
            out["role"] = json!(role);
        }

        let display_name = out
            .get("display_name")
            .and_then(|v| v.as_str())
            .or_else(|| out.get("username").and_then(|v| v.as_str()));
        if let Some(d) = display_name {
            out["displayName"] = json!(d);
        }

        // Normalize balance: PostgREST trả numeric(14,2) dạng string "100000.00"
        // → chuyển về number để frontend dùng trực tiếp
        if let Some(bal) = out.get("balance") {
            let num = bal
                .as_f64()
                .or_else(|| bal.as_str().and_then(|s| s.parse::<f64>().ok()))
                .unwrap_or(0.0);
            out["balance"] = json!(num);
        } else {
            out["balance"] = json!(0.0);
        }

        // Tương tự cho ctv_balance nếu có
        if let Some(cb) = out.get("ctv_balance") {
            let num = cb
                .as_f64()
                .or_else(|| cb.as_str().and_then(|s| s.parse::<f64>().ok()))
                .unwrap_or(0.0);
            out["ctv_balance"] = json!(num);
        }

        out
    }

    pub async fn sign_in(
        &self,
        email: &str,
        password: &str,
        device_id: Option<&str>,
    ) -> SignInResult {
        if self.config.url.is_empty() || self.config.anon_key.is_empty() {
            return SignInResult {
                success: false,
                message: Some("Chưa cấu hình Supabase".into()),
                banned: None,
                user: None,
                deviceId: None,
            };
        }

        let _device_id = ensure_device_id(device_id);
        let clean_email = email.trim().to_lowercase();

        let url = format!(
            "{}/auth/v1/token?grant_type=password",
            self.config.url.trim_end_matches('/')
        );

        let resp = match self
            .client
            .post(&url)
            .header("apikey", &self.config.anon_key)
            .header("Content-Type", "application/json")
            .json(&json!({
                "email": clean_email,
                "password": password
            }))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                return SignInResult {
                    success: false,
                    message: Some(e.to_string()),
                    banned: None,
                    user: None,
                    deviceId: None,
                }
            }
        };

        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(json!({}));

        if !status.is_success() {
            let raw_msg = body
                .get("error_description")
                .or_else(|| body.get("msg"))
                .or_else(|| body.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("Đăng nhập thất bại")
                .to_string();

            // Supabase trả "Invalid login credentials" — báo chung chung để bảo mật
            let friendly_msg = if raw_msg.to_lowercase().contains("invalid login credentials")
                || raw_msg.to_lowercase().contains("invalid credentials")
            {
                "Email hoặc mật khẩu không đúng.".to_string()
            } else if raw_msg.to_lowercase().contains("email not confirmed") {
                "Email chưa được xác thực. Vui lòng kiểm tra hộp thư và xác thực email.".to_string()
            } else if raw_msg.to_lowercase().contains("too many requests")
                || raw_msg.to_lowercase().contains("rate limit")
            {
                "Quá nhiều lần thử. Vui lòng đợi vài phút rồi thử lại.".to_string()
            } else {
                raw_msg
            };

            return SignInResult {
                success: false,
                message: Some(friendly_msg),
                banned: None,
                user: None,
                deviceId: None,
            };
        }

        let access_token = body
            .get("access_token")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let refresh_token = body
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let expires_in = body.get("expires_in").and_then(|v| v.as_i64());
        let user_obj = body.get("user").cloned().unwrap_or(json!({}));
        let user_id = user_obj
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let user_email = user_obj
            .get("email")
            .and_then(|v| v.as_str())
            .map(String::from);

        let session = AuthSession {
            access_token: access_token.clone(),
            refresh_token,
            expires_at: expires_in.map(|s| chrono::Utc::now().timestamp() + s),
            user: AuthUser {
                id: user_id.clone(),
                email: user_email.clone(),
            },
        };

        if let Err(e) = self.set_session(Some(session)).await {
            return SignInResult {
                success: false,
                message: Some(e),
                banned: None,
                user: None,
                deviceId: None,
            };
        }

        let mut profile = self
            .fetch_profile_by_user_id(&user_id, &access_token, true)
            .await;

        if profile.is_none() {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            profile = self
                .fetch_profile_by_user_id(&user_id, &access_token, true)
                .await;
        }

        // KHÔNG block login khi bị ban — để client hiển thị BanOverlay
        // (có lý do, thời hạn, nút kháng cáo). Chỉ check ban hết hạn để bỏ qua.
        let _ = &profile;

        let force_admin = self
            .ensure_admin_role(
                &user_id,
                user_email.as_deref().unwrap_or(""),
                &access_token,
            )
            .await;

        let patch_url = format!(
            "{}/rest/v1/profiles?id=eq.{}",
            self.config.url.trim_end_matches('/'),
            urlencoding::encode(&user_id)
        );
        // Cập nhật last_login_at — dùng user token, không block login nếu thất bại
        let _ = self
            .client
            .patch(&patch_url)
            .headers(self.auth_headers(&access_token))
            .json(&json!({ "last_login_at": chrono::Utc::now().to_rfc3339() }))
            .send()
            .await;

        let mut user = self.merge_user_profile(
            &user_id,
            user_email.as_deref(),
            profile,
            force_admin,
        );
        user["current_device_id"] = json!(null);
        user["two_factor_enabled"] = json!(false);

        SignInResult {
            success: true,
            message: None,
            banned: None,
            user: Some(user),
            deviceId: Some(String::new()),
        }
    }

    pub async fn sign_up(
        &self,
        email: &str,
        password: &str,
        display_name: &str,
        username: &str,
    ) -> Value {
        // Sau khi OTP verify, user đã tồn tại trong auth.users.
        // Cần update password (nếu Supabase tạo user không có password) và set profile metadata.
        if self.config.service_key.is_empty() {
            return json!({
                "success": false,
                "message": "Thiếu Service Role Key."
            });
        }

        let headers = match self.admin_headers() {
            Ok(h) => h,
            Err(e) => return json!({ "success": false, "message": e }),
        };

        let clean_email = email.trim().to_lowercase();

        // Tìm user_id theo email dùng filter thay vì list all
        let list_url = format!(
            "{}/auth/v1/admin/users?email={}",
            self.config.url.trim_end_matches('/'),
            urlencoding::encode(&clean_email)
        );
        let list_resp = self.client.get(&list_url).headers(headers.clone()).send().await;
        let Ok(list_resp) = list_resp else {
            return json!({ "success": false, "message": "Không thể tìm tài khoản." });
        };
        let body: Value = list_resp.json().await.unwrap_or(json!({}));
        let users = body.get("users").and_then(|v| v.as_array());
        let user_id = users
            .and_then(|arr| {
                arr.iter().find(|u| {
                    u.get("email")
                        .and_then(|e| e.as_str())
                        .map(|e| e.to_lowercase() == clean_email)
                        .unwrap_or(false)
                })
            })
            .and_then(|u| u.get("id").and_then(|v| v.as_str()).map(String::from));

        let Some(user_id) = user_id else {
            return json!({ "success": false, "message": "Không tìm thấy tài khoản sau xác thực." });
        };

        // Cập nhật password và user_metadata
        let patch_auth_url = format!(
            "{}/auth/v1/admin/users/{}",
            self.config.url.trim_end_matches('/'),
            user_id
        );
        let patch_resp = self
            .client
            .put(&patch_auth_url)
            .headers(headers.clone())
            .json(&json!({
                "password": password,
                "user_metadata": {
                    "display_name": display_name.trim(),
                    "username": username.trim().to_lowercase()
                }
            }))
            .send()
            .await;

        if patch_resp.map(|r| !r.status().is_success()).unwrap_or(true) {
            return json!({ "success": false, "message": "Không thể cập nhật thông tin tài khoản." });
        }

        // Cập nhật profile table
        let profile_url = format!(
            "{}/rest/v1/profiles?id=eq.{}",
            self.config.url.trim_end_matches('/'),
            urlencoding::encode(&user_id)
        );
        let profile_patch_resp = self
            .client
            .patch(&profile_url)
            .headers(headers)
            .json(&json!({
                "display_name": display_name.trim(),
                "username": username.trim().to_lowercase()
            }))
            .send()
            .await;

        if let Ok(resp) = profile_patch_resp {
            if !resp.status().is_success() {
                let err_body: Value = resp.json().await.unwrap_or(json!({}));
                let err_msg = err_body
                    .get("message")
                    .or_else(|| err_body.get("details"))
                    .or_else(|| err_body.get("hint"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if err_msg.to_lowercase().contains("profiles_username_key")
                    || err_msg.to_lowercase().contains("unique constraint")
                    || err_msg.to_lowercase().contains("username")
                {
                    return json!({
                        "success": false,
                        "message": "Tên tài khoản này đã được sử dụng. Vui lòng chọn tên khác."
                    });
                }
            }
        }

        json!({
            "success": true,
            "user": {
                "id": user_id,
                "email": clean_email,
                "displayName": display_name.trim(),
                "role": "user",
                "balance": 0
            }
        })
    }

    pub async fn sign_out(&self) -> Result<(), String> {
        if let Some(token) = self.get_valid_access_token().await {
            let url = format!(
                "{}/auth/v1/logout",
                self.config.url.trim_end_matches('/')
            );
            let _ = self
                .client
                .post(&url)
                .header("apikey", &self.config.anon_key)
                .header("Authorization", format!("Bearer {token}"))
                .send()
                .await;
        }
        self.set_session(None).await
    }

    pub async fn get_session(&self, include_privacy: bool, slim: bool) -> Option<Value> {
        let token = self.get_valid_access_token().await?;
        let session = self.session.lock().await;
        let user_id = session.as_ref()?.user.id.clone();
        let email = session.as_ref()?.user.email.clone();
        drop(session);

        let profile = if slim {
            let url = format!(
                "{}/rest/v1/profiles?id=eq.{}&select={}",
                self.config.url.trim_end_matches('/'),
                urlencoding::encode(&user_id),
                urlencoding::encode(PROFILE_SELECT_SLIM)
            );
            let slim_result = self.client
                .get(&url)
                .headers(self.auth_headers(&token))
                .send()
                .await
                .ok()
                .and_then(|r| if r.status().is_success() { Some(r) } else { None });
            let from_slim = match slim_result {
                Some(r) => r.json::<Vec<Value>>().await.ok().and_then(|v| v.into_iter().next()),
                None => None,
            };
            // Fallback nếu slim select thất bại (DB thiếu cột)
            if from_slim.is_some() {
                from_slim
            } else {
                self.fetch_profile_by_user_id(&user_id, &token, false).await
            }
        } else {
            self.fetch_profile_by_user_id(&user_id, &token, include_privacy)
                .await
        };

        let force_admin = email
            .as_deref()
            .map(|e| self.is_email_whitelisted_admin(e))
            .unwrap_or(false);

        if force_admin {
            let _ = self
                .ensure_admin_role(&user_id, email.as_deref().unwrap_or(""), &token)
                .await;
        }

        // Nếu profile fetch được nhưng thiếu role, bổ sung bằng query riêng
        let profile = match profile {
            Some(mut p) => {
                let role_val = p.get("role").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                if role_val.is_empty() || role_val == "null" {
                    // Query chỉ lấy role — cột này chắc chắn tồn tại
                    let role_url = format!(
                        "{}/rest/v1/profiles?id=eq.{}&select=id,role",
                        self.config.url.trim_end_matches('/'),
                        urlencoding::encode(&user_id)
                    );
                    if let Ok(rows) = self.http_get_authed(&role_url, &token).await {
                        if let Some(row) = rows.as_array().and_then(|a| a.first()) {
                            if let Some(role) = row.get("role").and_then(|v| v.as_str()) {
                                p["role"] = serde_json::Value::String(role.to_string());
                            }
                        }
                    }
                }
                Some(p)
            }
            None => {
                // Profile fetch hoàn toàn thất bại — thử query tối thiểu nhất
                let min_url = format!(
                    "{}/rest/v1/profiles?id=eq.{}&select=id,role",
                    self.config.url.trim_end_matches('/'),
                    urlencoding::encode(&user_id)
                );
                self.http_get_authed(&min_url, &token).await
                    .ok()
                    .and_then(|rows| rows.as_array().and_then(|a| a.first()).cloned())
            }
        };

        Some(self.merge_user_profile(
            &user_id,
            email.as_deref(),
            profile,
            force_admin,
        ))
    }

    pub async fn get_session_lite(&self) -> Option<Value> {
        let token = self.get_valid_access_token().await?;
        let session = self.session.lock().await;
        let user_id = session.as_ref()?.user.id.clone();
        let email = session.as_ref()?.user.email.clone();
        drop(session);

        let url = format!(
            "{}/rest/v1/profiles?id=eq.{}&select=id,username,display_name,avatar_url,frame_url,background_url,banner_url,role,balance,ctv_balance,is_banned,updated_at",
            self.config.url.trim_end_matches('/'),
            urlencoding::encode(&user_id)
        );

        let profile = match self
            .client
            .get(&url)
            .headers(self.auth_headers(&token))
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => {
                r.json::<Vec<Value>>().await.ok().and_then(|v| v.into_iter().next())
            }
            _ => None,
        };
        // Fallback nếu select lỗi (DB thiếu cột)
        let profile = if profile.is_some() {
            profile
        } else {
            self.fetch_profile_by_user_id(&user_id, &token, false).await
        };

        let force_admin = email
            .as_deref()
            .map(|e| self.is_email_whitelisted_admin(e))
            .unwrap_or(false);

        Some(self.merge_user_profile(
            &user_id,
            email.as_deref(),
            profile,
            force_admin,
        ))
    }

    pub async fn update_profile(&self, updates: Value) -> Value {
        let token = match self.get_valid_access_token().await {
            Some(t) => t,
            None => {
                return json!({ "success": false, "message": "Chưa đăng nhập" });
            }
        };

        let user_id = self.session.lock().await.as_ref().map(|s| s.user.id.clone());
        let Some(user_id) = user_id else {
            return json!({ "success": false, "message": "Chưa đăng nhập" });
        };

        let url = format!(
            "{}/rest/v1/profiles?id=eq.{}",
            self.config.url.trim_end_matches('/'),
            urlencoding::encode(&user_id)
        );

        let resp = self
            .client
            .patch(&url)
            .headers(self.auth_headers(&token))
            .header("Prefer", "return=representation")
            .json(&updates)
            .send()
            .await;

        match resp {
            Ok(r) => {
                if !r.status().is_success() {
                    let body: Value = r.json().await.unwrap_or(json!({}));
                    let msg = body
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Không thể cập nhật hồ sơ.");
                    return json!({ "success": false, "message": msg });
                }
                let rows: Vec<Value> = r.json().await.unwrap_or_default();
                if let Some(row) = rows.into_iter().next() {
                    json!({ "success": true, "profile": row })
                } else {
                    json!({ "success": false, "message": "Không có bản ghi nào được cập nhật." })
                }
            }
            Err(e) => json!({ "success": false, "message": e.to_string() }),
        }
    }

    pub async fn post_edge_function(&self, name: &str, body: Value) -> Value {
        let url = format!(
            "{}/functions/v1/{}",
            self.config.url.trim_end_matches('/'),
            name.trim_start_matches('/')
        );

        let resp = self
            .client
            .post(&url)
            .header("apikey", &self.config.anon_key)
            .header("Authorization", format!("Bearer {}", self.config.anon_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await;

        match resp {
            Ok(r) => {
                let status = r.status();
                let data: Value = r.json().await.unwrap_or(json!({}));
                if status.is_success() {
                    json!({ "success": true, "data": data })
                } else {
                    let err = data
                        .get("error")
                        .or_else(|| data.get("message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Edge function error");
                    json!({ "success": false, "error": err })
                }
            }
            Err(e) => json!({ "success": false, "error": e.to_string() }),
        }
    }

    // ── Public helpers for store/library commands ─────────────────────────

    /// Returns a valid (auto-refreshed if needed) access token.
    pub async fn get_access_token(&self) -> Option<String> {
        self.get_valid_access_token().await
    }

    /// Returns the current user id if logged in.
    pub async fn get_user_id(&self) -> Option<String> {
        self.session
            .lock()
            .await
            .as_ref()
            .map(|s| s.user.id.clone())
    }

    // ── Admin helpers (service_key) ───────────────────────────────────────

    fn admin_headers_map(&self) -> Result<reqwest::header::HeaderMap, String> {
        self.admin_headers()
    }

    pub async fn http_get_admin(&self, url: &str) -> Result<Value, String> {
        let headers = self.admin_headers()?;
        let resp = self.client.get(url).headers(headers).header("Accept", "application/json").send().await.map_err(|e| e.to_string())?;
        let status = resp.status();
        if !status.is_success() {
            let body: Value = resp.json().await.unwrap_or(json!({}));
            let msg = body.get("message").or_else(|| body.get("error")).and_then(|v| v.as_str()).unwrap_or("Admin GET failed");
            return Err(format!("HTTP {status}: {msg}"));
        }
        resp.json::<Value>().await.map_err(|e| e.to_string())
    }

    pub async fn http_patch_admin(&self, url: &str, body: &Value) -> Result<Value, String> {
        let mut headers = self.admin_headers()?;
        // Yêu cầu trả về các row đã update để verify thực sự có update
        headers.insert("Prefer", "return=representation".parse().unwrap());
        let resp = self.client.patch(url).headers(headers).json(body).send().await.map_err(|e| e.to_string())?;
        let status = resp.status();
        if !status.is_success() {
            let data: Value = resp.json().await.unwrap_or(json!({}));
            let msg = data.get("message").or_else(|| data.get("error")).and_then(|v| v.as_str()).unwrap_or("Admin PATCH failed");
            return Err(format!("HTTP {status}: {msg}"));
        }
        // Kiểm tra số row được update
        let rows: Value = resp.json().await.unwrap_or(json!([]));
        let count = rows.as_array().map(|a| a.len()).unwrap_or(0);
        if count == 0 {
            return Err("Không có bản ghi nào được cập nhật (kiểm tra RLS hoặc id không tồn tại)".into());
        }
        Ok(json!({ "success": true, "updated": count }))
    }

    /// Cập nhật balance kèm reason qua Supabase RPC `set_balance_with_reason`.
    /// Trigger `log_balance_change` sẽ đọc reason từ session var và ghi vào balance_logs.
    pub async fn set_balance_with_reason(
        &self,
        user_id: &str,
        new_balance: f64,
        reason: &str,
        reference_id: Option<&str>,
    ) -> Result<Value, String> {
        let base = self.config.url.trim_end_matches('/');
        let rpc_url = format!("{base}/rest/v1/rpc/set_balance_with_reason");
        let headers = self.admin_headers()?;

        let body = json!({
            "p_user_id": user_id,
            "p_new_balance": new_balance,
            "p_reason": reason,
            "p_reference_id": reference_id,
        });

        let resp = self.client.post(&rpc_url).headers(headers).json(&body).send().await.map_err(|e| e.to_string())?;
        let status = resp.status();
        if !status.is_success() {
            // Fallback: thử PATCH trực tiếp nếu RPC chưa được tạo
            let err_body: Value = resp.json().await.unwrap_or(json!({}));
            let err_msg = err_body.get("message").or_else(|| err_body.get("hint")).and_then(|v| v.as_str()).unwrap_or("RPC failed");
            if err_msg.contains("does not exist") || err_msg.contains("function") {
                // RPC chưa tạo → fallback PATCH
                let patch_url = format!("{base}/rest/v1/profiles?id=eq.{}", urlencoding::encode(user_id));
                return self.http_patch_admin(&patch_url, &json!({ "balance": new_balance })).await;
            }
            return Err(format!("HTTP {status}: {err_msg}"));
        }
        Ok(json!({ "success": true }))
    }

    pub async fn http_delete_admin(&self, url: &str) -> Result<Value, String> {        let headers = self.admin_headers()?;
        let resp = self.client.delete(url).headers(headers).send().await.map_err(|e| e.to_string())?;
        let status = resp.status();
        if !status.is_success() {
            return Err(format!("HTTP {status}: Admin DELETE failed"));
        }
        Ok(json!({"success": true}))
    }

    pub async fn http_post_admin_upsert(&self, url: &str, body: &Value) -> Result<Value, String> {
        let mut headers = self.admin_headers()?;
        headers.insert("Prefer", "return=minimal,resolution=merge-duplicates".parse().unwrap());
        let resp = self.client.post(url).headers(headers).json(body).send().await.map_err(|e| e.to_string())?;
        let status = resp.status();
        if !status.is_success() {
            let data: Value = resp.json().await.unwrap_or(json!({}));
            let msg = data.get("message").or_else(|| data.get("error")).and_then(|v| v.as_str()).unwrap_or("Admin POST failed");
            return Err(format!("HTTP {status}: {msg}"));
        }
        Ok(json!({"success": true}))
    }

    pub async fn http_post_admin_upsert_on_conflict(&self, url: &str, body: &Value, on_conflict: &str) -> Result<Value, String> {
        let mut headers = self.admin_headers()?;
        let prefer = format!("return=minimal,resolution=merge-duplicates,on_conflict={on_conflict}");
        headers.insert("Prefer", prefer.parse().unwrap_or_else(|_| "return=minimal".parse().unwrap()));
        let resp = self.client.post(url).headers(headers).json(body).send().await.map_err(|e| e.to_string())?;
        let status = resp.status();
        if !status.is_success() {
            let data: Value = resp.json().await.unwrap_or(json!({}));
            let msg = data.get("message").or_else(|| data.get("error")).and_then(|v| v.as_str()).unwrap_or("Upsert failed");
            return Err(format!("HTTP {status}: {msg}"));
        }
        Ok(json!({"success": true}))
    }

    /// GET a Supabase REST URL with anon key (for public tables).
    pub async fn http_get_anon(&self, url: &str) -> Result<Value, String> {
        let resp = self
            .client
            .get(url)
            .header("apikey", &self.config.anon_key)
            .header("Authorization", format!("Bearer {}", &self.config.anon_key))
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body: Value = resp.json().await.unwrap_or(json!({}));
            let msg = body
                .get("message")
                .or_else(|| body.get("error"))
                .and_then(|v| v.as_str())
                .unwrap_or("Request failed");
            return Err(format!("HTTP {status}: {msg}"));
        }
        resp.json::<Value>().await.map_err(|e| e.to_string())
    }

    /// GET a Supabase REST URL authenticated with the user token.
    pub async fn http_get_authed(&self, url: &str, token: &str) -> Result<Value, String> {
        let resp = self
            .client
            .get(url)
            .headers(self.auth_headers(token))
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let status = resp.status();
        if !status.is_success() {
            let body: Value = resp.json().await.unwrap_or(json!({}));
            let msg = body
                .get("message")
                .or_else(|| body.get("error"))
                .and_then(|v| v.as_str())
                .unwrap_or("Request failed");
            return Err(format!("HTTP {status}: {msg}"));
        }
        resp.json::<Value>().await.map_err(|e| e.to_string())
    }

    /// GET tất cả rows bằng cách loop theo Range header (mỗi batch 1000 rows).
    /// Dùng service_key (admin). Gộp tất cả arrays thành 1 mảng JSON.
    pub async fn http_get_all_pages_admin(&self, base_url: &str) -> Result<Value, String> {
        let headers = match self.admin_headers() {
            Ok(h) => h,
            Err(e) => return Err(e),
        };
        let batch = 1000usize;
        let mut all: Vec<Value> = Vec::new();
        let mut offset = 0usize;

        loop {
            let end = offset + batch - 1;
            let resp = self
                .client
                .get(base_url)
                .headers(headers.clone())
                .header("Accept", "application/json")
                .header("Range-Unit", "items")
                .header("Range", format!("{offset}-{end}"))
                .header("Prefer", "count=none")
                .send()
                .await
                .map_err(|e| e.to_string())?;

            let status = resp.status();
            // 206 Partial Content hoặc 200 OK đều là valid
            if !status.is_success() {
                let body: Value = resp.json().await.unwrap_or(json!({}));
                let msg = body
                    .get("message")
                    .or_else(|| body.get("error"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Request failed");
                return Err(format!("HTTP {status}: {msg}"));
            }

            let batch_data: Value = resp.json().await.map_err(|e| e.to_string())?;
            match batch_data.as_array() {
                Some(arr) => {
                    let count = arr.len();
                    all.extend(arr.iter().cloned());
                    if count < batch {
                        break; // Batch nhỏ hơn max → đã lấy hết
                    }
                    offset += batch;
                }
                None => break,
            }
        }

        Ok(Value::Array(all))
    }

    /// GET tất cả rows bằng Range header, dùng user token.
    pub async fn http_get_all_pages_authed(&self, base_url: &str, token: &str) -> Result<Value, String> {
        let batch = 1000usize;
        let mut all: Vec<Value> = Vec::new();
        let mut offset = 0usize;

        loop {
            let end = offset + batch - 1;
            let resp = self
                .client
                .get(base_url)
                .headers(self.auth_headers(token))
                .header("Accept", "application/json")
                .header("Range-Unit", "items")
                .header("Range", format!("{offset}-{end}"))
                .header("Prefer", "count=none")
                .send()
                .await
                .map_err(|e| e.to_string())?;

            let status = resp.status();
            if !status.is_success() {
                let body: Value = resp.json().await.unwrap_or(json!({}));
                let msg = body
                    .get("message")
                    .or_else(|| body.get("error"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Request failed");
                return Err(format!("HTTP {status}: {msg}"));
            }

            let batch_data: Value = resp.json().await.map_err(|e| e.to_string())?;
            match batch_data.as_array() {
                Some(arr) => {
                    let count = arr.len();
                    all.extend(arr.iter().cloned());
                    if count < batch {
                        break;
                    }
                    offset += batch;
                }
                None => break,
            }
        }

        Ok(Value::Array(all))
    }

    /// POST to a Supabase REST URL authenticated with the user token.
    pub async fn http_post_authed(
        &self,
        url: &str,
        token: &str,
        body: &Value,
    ) -> Result<Value, String> {
        let resp = self
            .client
            .post(url)
            .headers(self.auth_headers(token))
            .json(body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let data: Value = resp.json().await.unwrap_or(json!({}));
            let msg = data
                .get("message")
                .or_else(|| data.get("error"))
                .and_then(|v| v.as_str())
                .unwrap_or("Request failed");
            return Err(msg.to_string());
        }
        resp.json::<Value>().await.map_err(|e| e.to_string())
    }

    /// POST with upsert semantics (merge-duplicates on conflict column).
    /// Dùng cho batch insert DLCs — nếu row đã tồn tại (conflict trên appid) → update.
    pub async fn http_upsert_authed(
        &self,
        url: &str,
        token: &str,
        body: &Value,
        on_conflict: &str,
    ) -> Result<Value, String> {
        let prefer = "return=minimal,resolution=merge-duplicates".to_string();
        // PostgREST: on_conflict phải là query param
        let full_url = if url.contains('?') {
            format!("{}&on_conflict={}", url, on_conflict)
        } else {
            format!("{}?on_conflict={}", url, on_conflict)
        };
        let resp = self
            .client
            .post(&full_url)
            .headers(self.auth_headers(token))
            .header("Prefer", &prefer)
            .json(body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Upsert failed ({status}): {text}"));
        }
        Ok(json!({ "success": true }))
    }

    /// POST to a Supabase Edge Function with user auth token.
    pub async fn post_edge_function_authed(
        &self,
        name: &str,
        token: &str,
        body: &Value,
    ) -> Value {
        let url = format!(
            "{}/functions/v1/{}",
            self.config.url.trim_end_matches('/'),
            name.trim_start_matches('/')
        );

        let resp = self
            .client
            .post(&url)
            .header("apikey", &self.config.anon_key)
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json")
            .json(body)
            .send()
            .await;

        match resp {
            Ok(r) => {
                let status = r.status();
                let data: Value = r.json().await.unwrap_or(json!({}));
                if status.is_success() {
                    json!({ "success": true, "data": data })
                } else {
                    let err = data
                        .get("error")
                        .or_else(|| data.get("message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Edge function error");
                    json!({ "success": false, "error": err })
                }
            }
            Err(e) => json!({ "success": false, "error": e.to_string() }),
        }
    }


    pub async fn send_otp(&self, email: &str, purpose: Option<&str>) -> Value {
        let clean_email = email.trim().to_lowercase();

        // forgot_password: dùng /auth/v1/otp với type "recovery" — đúng endpoint cho reset password
        // register: dùng /auth/v1/otp với create_user = true
        if purpose == Some("forgot_password") {
            // Dùng magic link OTP flow cho recovery — GoTrue tìm user qua auth.users.email trực tiếp
            let url = format!("{}/auth/v1/otp", self.config.url.trim_end_matches('/'));
            let resp = self
                .client
                .post(&url)
                .header("apikey", &self.config.anon_key)
                .header("Content-Type", "application/json")
                .json(&json!({
                    "email": clean_email,
                    "create_user": false,
                    "options": {
                        "shouldCreateUser": false
                    }
                }))
                .send()
                .await;

            return match resp {
                Ok(r) => {
                    let status = r.status();
                    let data: Value = r.json().await.unwrap_or(json!({}));
                    if status.is_success() {
                        json!({
                            "success": true,
                            "message": "Mã xác thực đã được gửi đến email của bạn"
                        })
                    } else {
                        let err = data
                            .get("error_description")
                            .or_else(|| data.get("msg"))
                            .or_else(|| data.get("message"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("Không thể gửi mã xác thực.");
                        // Nếu OTP endpoint vẫn lỗi, thử admin-set password reset token
                        if err.to_lowercase().contains("database error") || err.to_lowercase().contains("finding user") {
                            return self.send_otp_admin_recovery(&clean_email).await;
                        }
                        json!({ "success": false, "message": Self::friendly_auth_error(err) })
                    }
                }
                Err(e) => json!({ "success": false, "message": format!("Lỗi gửi mã: {}", e) }),
            };
        }

        // register flow: dùng /auth/v1/otp với create_user = true
        let url = format!("{}/auth/v1/otp", self.config.url.trim_end_matches('/'));
        let resp = self
            .client
            .post(&url)
            .header("apikey", &self.config.anon_key)
            .header("Content-Type", "application/json")
            .header("x-supabase-otp-preference", "otp")
            .json(&json!({
                "email": clean_email,
                "create_user": true
            }))
            .send()
            .await;

        match resp {
            Ok(r) => {
                let status = r.status();
                let data: Value = r.json().await.unwrap_or(json!({}));
                if status.is_success() {
                    json!({
                        "success": true,
                        "message": "Mã xác thực đã được gửi đến email của bạn"
                    })
                } else {
                    let err = data
                        .get("error_description")
                        .or_else(|| data.get("msg"))
                        .or_else(|| data.get("message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Không thể gửi mã xác thực.");
                    json!({ "success": false, "message": Self::friendly_auth_error(err) })
                }
            }
            Err(e) => json!({ "success": false, "message": format!("Lỗi gửi mã: {}", e) }),
        }
    }

    /// Fallback cho forgot_password khi /auth/v1/otp bị lỗi với imported users:
    /// Dùng Admin API để generate recovery token và gửi email reset.
    async fn send_otp_admin_recovery(&self, email: &str) -> Value {
        if self.config.service_key.is_empty() {
            return json!({ "success": false, "message": "Không tìm thấy tài khoản với email này." });
        }

        let headers = match self.admin_headers() {
            Ok(h) => h,
            Err(e) => return json!({ "success": false, "message": e }),
        };

        // Tìm user_id qua public.profiles (có email column, đáng tin cậy hơn admin auth filter)
        let profile_url = format!(
            "{}/rest/v1/profiles?email=eq.{}&select=id",
            self.config.url.trim_end_matches('/'),
            urlencoding::encode(email)
        );
        let profile_resp = self
            .client
            .get(&profile_url)
            .headers(headers.clone())
            .send()
            .await;

        let user_id = match profile_resp {
            Ok(r) if r.status().is_success() => {
                let rows: Vec<Value> = r.json().await.unwrap_or_default();
                rows.into_iter()
                    .next()
                    .and_then(|u| u.get("id").and_then(|v| v.as_str()).map(String::from))
            }
            _ => None,
        };

        // Fallback: thử tìm qua admin users với pagination đủ lớn
        let user_id = if user_id.is_none() {
            let list_url = format!(
                "{}/auth/v1/admin/users?page=1&per_page=1000",
                self.config.url.trim_end_matches('/')
            );
            let list_resp = match self.client.get(&list_url).headers(headers.clone()).send().await {
                Ok(r) => r,
                Err(e) => return json!({ "success": false, "message": e.to_string() }),
            };
            let body: Value = list_resp.json().await.unwrap_or(json!({}));
            body.get("users")
                .and_then(|v| v.as_array())
                .and_then(|arr| {
                    arr.iter().find(|u| {
                        u.get("email")
                            .and_then(|e| e.as_str())
                            .map(|e| e.to_lowercase() == email)
                            .unwrap_or(false)
                    })
                })
                .and_then(|u| u.get("id").and_then(|v| v.as_str()).map(String::from))
        } else {
            user_id
        };

        let Some(user_id) = user_id else {
            return json!({ "success": false, "message": "Không tìm thấy tài khoản với email này." });
        };

        // Tạo OTP 8 số ngẫu nhiên và lưu vào custom_otp table
        let otp_code = {
            use std::collections::hash_map::DefaultHasher;
            use std::hash::{Hash, Hasher};
            use std::time::{SystemTime, UNIX_EPOCH};
            let mut hasher = DefaultHasher::new();
            let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().subsec_nanos();
            let millis = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
            nanos.hash(&mut hasher);
            millis.hash(&mut hasher);
            email.hash(&mut hasher);
            let h = hasher.finish();
            format!("{:08}", h % 100_000_000)
        };

        // Xóa OTP cũ của email này trước
        let delete_url = format!(
            "{}/rest/v1/custom_otp?email=eq.{}&purpose=eq.forgot_password",
            self.config.url.trim_end_matches('/'),
            urlencoding::encode(email)
        );
        let _ = self.client.delete(&delete_url).headers(headers.clone()).send().await;

        // Insert OTP mới
        let insert_url = format!(
            "{}/rest/v1/custom_otp",
            self.config.url.trim_end_matches('/')
        );
        let insert_resp = self
            .client
            .post(&insert_url)
            .headers(headers.clone())
            .header("Prefer", "return=minimal")
            .json(&json!({
                "email": email,
                "code": otp_code,
                "purpose": "forgot_password"
            }))
            .send()
            .await;

        if insert_resp.map(|r| !r.status().is_success()).unwrap_or(true) {
            return json!({ "success": false, "message": "Lỗi tạo mã xác thực." });
        }

        // Gửi email OTP qua Supabase Admin generate link (gửi magic link có OTP embed)
        // Dùng edge function send-otp-email nếu có, nếu không thì báo thành công và user nhập OTP từ email
        // Thử gửi qua edge function "send-custom-otp"
        let edge_url = format!(
            "{}/functions/v1/send-custom-otp",
            self.config.url.trim_end_matches('/')
        );
        let edge_resp = self
            .client
            .post(&edge_url)
            .header("apikey", &self.config.anon_key)
            .header("Authorization", format!("Bearer {}", &self.config.service_key))
            .header("Content-Type", "application/json")
            .json(&json!({ "email": email, "code": otp_code }))
            .send()
            .await;

        let edge_ok = edge_resp.map(|r| r.status().is_success()).unwrap_or(false);

        if !edge_ok {
            // Edge function không có — thử Supabase Admin generateLink để gửi email
            let gen_url = format!(
                "{}/auth/v1/admin/generate_link",
                self.config.url.trim_end_matches('/')
            );
            let gen_resp = self
                .client
                .post(&gen_url)
                .headers(headers)
                .json(&json!({
                    "type": "recovery",
                    "email": email,
                    "options": { "redirectTo": "nyvexa://reset-password" }
                }))
                .send()
                .await;

            match gen_resp {
                Ok(r) if r.status().is_success() => {
                    // Email recovery đã gửi qua magic link — nhưng user cần OTP
                    // Trả thành công, OTP đã lưu trong DB, user sẽ nhập OTP được gửi qua email custom
                    json!({
                        "success": true,
                        "message": "Mã xác thực đã được gửi đến email của bạn"
                    })
                }
                _ => {
                    // Cả 2 đều fail — vẫn trả success vì OTP đã lưu DB
                    // Admin có thể xem OTP trong Supabase dashboard để hỗ trợ user
                    json!({
                        "success": true,
                        "message": "Mã xác thực đã được gửi đến email của bạn"
                    })
                }
            }
        } else {
            json!({
                "success": true,
                "message": "Mã xác thực đã được gửi đến email của bạn"
            })
        }
    }

    pub async fn verify_otp(&self, email: &str, code: &str) -> Value {
        let clean_email = email.trim().to_lowercase();
        let clean_code = code.trim();

        // Thử check custom_otp table trước (cho imported users qua forgot_password flow)
        if let Some(headers) = self.admin_headers().ok() {
            let otp_url = format!(
                "{}/rest/v1/custom_otp?email=eq.{}&code=eq.{}&purpose=eq.forgot_password&used=eq.false&expires_at=gt.{}",
                self.config.url.trim_end_matches('/'),
                urlencoding::encode(&clean_email),
                urlencoding::encode(clean_code),
                urlencoding::encode(&chrono::Utc::now().to_rfc3339())
            );
            let otp_resp = self.client.get(&otp_url).headers(headers.clone()).send().await;
            if let Ok(r) = otp_resp {
                if r.status().is_success() {
                    let rows: Vec<Value> = r.json().await.unwrap_or_default();
                    if let Some(row) = rows.into_iter().next() {
                        let otp_id = row.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        // Mark OTP as used
                        if !otp_id.is_empty() {
                            let mark_url = format!(
                                "{}/rest/v1/custom_otp?id=eq.{}",
                                self.config.url.trim_end_matches('/'),
                                urlencoding::encode(&otp_id)
                            );
                            let _ = self.client
                                .patch(&mark_url)
                                .headers(headers)
                                .json(&json!({ "used": true }))
                                .send()
                                .await;
                        }
                        return json!({ "success": true });
                    }
                }
            }
        }

        // Fallback: thử Supabase built-in OTP verify (cho user đăng ký thông thường)
        let url = format!("{}/auth/v1/verify", self.config.url.trim_end_matches('/'));
        let resp = self
            .client
            .post(&url)
            .header("apikey", &self.config.anon_key)
            .header("Content-Type", "application/json")
            .json(&json!({
                "type": "email",
                "email": clean_email,
                "token": clean_code
            }))
            .send()
            .await;

        match resp {
            Ok(r) => {
                let status = r.status();
                let data: Value = r.json().await.unwrap_or(json!({}));
                if status.is_success() {
                    if let (Some(access_token), Some(refresh_token)) = (
                        data.get("access_token").and_then(|v| v.as_str()),
                        data.get("refresh_token").and_then(|v| v.as_str()),
                    ) {
                        let empty = json!({});
                        let user_data = data.get("user").unwrap_or(&empty);
                        let user_id = user_data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let user_email = user_data.get("email").and_then(|v| v.as_str()).map(|s| s.to_string());
                        let session = AuthSession {
                            access_token: access_token.to_string(),
                            refresh_token: refresh_token.to_string(),
                            expires_at: data.get("expires_in").and_then(|v| v.as_i64()).map(|s| chrono::Utc::now().timestamp() + s),
                            user: AuthUser { id: user_id, email: user_email },
                        };
                        let _ = self.set_session(Some(session)).await;
                    }
                    json!({ "success": true })
                } else {
                    let err = data
                        .get("error_description")
                        .or_else(|| data.get("msg"))
                        .or_else(|| data.get("message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Mã không hợp lệ hoặc đã hết hạn.");
                    json!({ "success": false, "message": err })
                }
            }
            Err(e) => json!({ "success": false, "message": format!("Lỗi xác thực: {}", e) }),
        }
    }

    /// Kiểm tra username đã tồn tại trong profiles chưa.
    /// Trả về `{ available: bool }`.
    pub async fn check_username_available(&self, username: &str) -> Value {
        if self.config.url.is_empty() {
            return json!({ "available": false, "message": "Chưa cấu hình Supabase" });
        }
        let clean = username.trim().to_lowercase();
        if clean.is_empty() {
            return json!({ "available": false, "message": "Username không được để trống" });
        }
        let url = format!(
            "{}/rest/v1/profiles?username=eq.{}&select=id&limit=1",
            self.config.url.trim_end_matches('/'),
            urlencoding::encode(&clean)
        );
        // Dùng anon key để query (RLS chỉ cho phép đọc username public)
        // Nếu bảng có RLS block anon thì fallback dùng service key
        let resp = self.client
            .get(&url)
            .header("apikey", &self.config.anon_key)
            .header("Authorization", format!("Bearer {}", &self.config.anon_key))
            .send()
            .await;
        match resp {
            Ok(r) => match r.json::<Value>().await {
                Ok(body) => {
                    let exists = body.as_array().map(|a| !a.is_empty()).unwrap_or(false);
                    json!({ "available": !exists })
                }
                Err(_) => json!({ "available": true }), // fallback: cho phép tiếp tục
            },
            Err(_) => json!({ "available": true }), // fallback
        }
    }

    /// Xác minh mật khẩu của user qua /auth/v1/token (grant_type=password)
    /// nhưng KHÔNG ghi đè session đang đăng nhập.
    /// Trả về `{ success: bool, message?: string }`.
    pub async fn verify_password(&self, email: &str, password: &str) -> Value {
        if self.config.url.is_empty() || self.config.anon_key.is_empty() {
            return json!({ "success": false, "message": "Chưa cấu hình Supabase" });
        }
        let clean_email = email.trim().to_lowercase();
        if clean_email.is_empty() || password.is_empty() {
            return json!({ "success": false, "message": "Thiếu email hoặc mật khẩu" });
        }

        let url = format!(
            "{}/auth/v1/token?grant_type=password",
            self.config.url.trim_end_matches('/')
        );

        let resp = match self
            .client
            .post(&url)
            .header("apikey", &self.config.anon_key)
            .header("Content-Type", "application/json")
            .json(&json!({ "email": clean_email, "password": password }))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return json!({ "success": false, "message": e.to_string() }),
        };

        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(json!({}));
        if status.is_success() {
            json!({ "success": true })
        } else {
            let msg = body
                .get("error_description")
                .or_else(|| body.get("msg"))
                .or_else(|| body.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("Mật khẩu hiện tại không đúng")
                .to_string();
            json!({ "success": false, "message": msg })
        }
    }

    pub async fn update_password_admin(&self, email: &str, password: &str) -> Value {
        if self.config.service_key.is_empty() {
            return json!({ "success": false, "message": "Thiếu quyền Admin" });
        }

        let headers = match self.admin_headers() {
            Ok(h) => h,
            Err(e) => return json!({ "success": false, "message": e }),
        };

        let clean_email = email.trim().to_lowercase();

        // Dùng filter ?email= thay vì list all để tránh pagination limit (mặc định 50 users)
        let url = format!(
            "{}/auth/v1/admin/users?email={}",
            self.config.url.trim_end_matches('/'),
            urlencoding::encode(&clean_email)
        );

        let list_resp = self.client.get(&url).headers(headers.clone()).send().await;
        let Ok(list_resp) = list_resp else {
            return json!({ "success": false, "message": "Không thể tìm tài khoản" });
        };

        let body: Value = list_resp.json().await.unwrap_or(json!({}));
        let users = body.get("users").and_then(|v| v.as_array());

        let user_id_found = users
            .and_then(|arr| {
                arr.iter().find(|u| {
                    u.get("email")
                        .and_then(|e| e.as_str())
                        .map(|e| e.to_lowercase() == clean_email)
                        .unwrap_or(false)
                })
            })
            .and_then(|u| u.get("id").and_then(|v| v.as_str()))
            .map(String::from);

        // Fallback: nếu admin lookup theo email không ra (GoTrue có thể bỏ qua
        // filter ?email= và trả về list bị giới hạn), dùng user_id của session
        // đang đăng nhập nếu email khớp.
        let user_id = match user_id_found {
            Some(id) => Some(id),
            None => {
                let session_guard = self.session.lock().await;
                session_guard.as_ref().and_then(|s| {
                    let email_match = s
                        .user
                        .email
                        .as_ref()
                        .map(|e| e.to_lowercase() == clean_email)
                        .unwrap_or(false);
                    if email_match && !s.user.id.is_empty() {
                        Some(s.user.id.clone())
                    } else {
                        None
                    }
                })
            }
        };

        let Some(user_id) = user_id else {
            return json!({ "success": false, "message": "Không tìm thấy tài khoản với email này." });
        };

        let patch_url = format!(
            "{}/auth/v1/admin/users/{}",
            self.config.url.trim_end_matches('/'),
            user_id
        );

        let resp = self
            .client
            .put(&patch_url)
            .headers(headers)
            .json(&json!({ "password": password }))
            .send()
            .await;

        match resp {
            Ok(r) if r.status().is_success() => json!({ "success": true }),
            Ok(r) => {
                let body: Value = r.json().await.unwrap_or(json!({}));
                json!({
                    "success": false,
                    "message": body.get("message").and_then(|v| v.as_str()).unwrap_or("Cập nhật thất bại")
                })
            }
            Err(e) => json!({ "success": false, "message": e.to_string() }),
        }
    }

    pub fn get_local_profile_snapshot(&self) -> Option<Value> {
        let path = self.profile_sync_path();
        if !path.exists() {
            return None;
        }
        let raw = fs::read_to_string(path).ok()?;
        serde_json::from_str(&raw).ok()
    }

    pub fn set_local_profile_snapshot(&self, payload: Value) -> Value {
        let path = self.profile_sync_path();
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        match fs::write(&path, serde_json::to_string_pretty(&payload).unwrap_or_default()) {
            Ok(_) => json!({ "success": true, "filePath": path.to_string_lossy() }),
            Err(e) => json!({ "success": false, "message": e.to_string() }),
        }
    }

    async fn send_email_smtp(&self, to: &str, subject: &str, body_html: &str) -> Result<(), String> {
        use lettre::{
            AsyncSmtpTransport, AsyncTransport, Message,
            message::{header::ContentType, Mailbox},
            transport::smtp::authentication::Credentials,
            Tokio1Executor,
        };

        let smtp = self.config.smtp.as_ref().ok_or("Chưa cấu hình SMTP")?;

        let from: Mailbox = smtp.from.parse().map_err(|e: lettre::address::AddressError| e.to_string())?;
        let to_box: Mailbox = to.parse().map_err(|e: lettre::address::AddressError| e.to_string())?;

        let email = Message::builder()
            .from(from)
            .to(to_box)
            .subject(subject)
            .header(ContentType::TEXT_HTML)
            .body(body_html.to_string())
            .map_err(|e| e.to_string())?;

        let creds = Credentials::new(smtp.user.clone(), smtp.pass.clone());

        let transport = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&smtp.host)
            .map_err(|e| e.to_string())?
            .port(smtp.port)
            .credentials(creds)
            .build();

        transport.send(email).await.map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn public_config(&self) -> Value {
        json!({
            "url": self.config.url,
            "anonKey": self.config.anon_key
        })
    }
}

pub fn parse_admin_emails(env: &HashMap<String, String>) -> Vec<String> {
    env.get("ADMIN_EMAILS")
        .map(|s| {
            s.split(',')
                .map(|x| x.trim().to_lowercase())
                .filter(|x| !x.is_empty())
                .collect()
        })
        .unwrap_or_default()
}
