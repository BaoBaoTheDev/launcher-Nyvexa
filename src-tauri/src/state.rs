use std::sync::Arc;

use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::services::supabase::SupabaseService;

pub struct AppState {
    pub supabase: Arc<SupabaseService>,
    pub app_handle: Arc<Mutex<Option<AppHandle>>>,
    /// SteamPath được cache sau lần đọc registry đầu tiên (dùng khi quit từ tray)
    pub steam_path: Arc<Mutex<Option<String>>>,
}
