use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::crypto::{decrypt_env_buffer, encrypt_env_text};

const ENV_SECRET_DEFAULT: &str = "nestg-launcher-env-secret-v1";

pub struct EnvConfig {
    pub vars: HashMap<String, String>,
    pub loaded_from: Option<PathBuf>,
}

impl EnvConfig {
    pub fn get(&self, key: &str) -> Option<String> {
        self.vars.get(key).cloned()
    }
}

fn parse_dotenv(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            let key = k.trim().to_string();
            let mut value = v.trim().to_string();
            if (value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\''))
            {
                value = value[1..value.len() - 1].to_string();
            }
            map.insert(key, value);
        }
    }
    map
}

fn load_encrypted(path: &Path, secret: &str) -> Result<HashMap<String, String>, String> {
    let raw = fs::read(path).map_err(|e| e.to_string())?;
    let text = decrypt_env_buffer(&raw, secret)?;
    Ok(parse_dotenv(&text))
}

fn secure_plain_env(path: &Path, secret: &str) {
    if let Ok(plain) = fs::read_to_string(path) {
        if plain.trim().is_empty() {
            return;
        }
        let enc_path = PathBuf::from(format!("{}.enc", path.display()));
        if let Ok(enc) = encrypt_env_text(&plain, secret) {
            let _ = fs::write(&enc_path, enc);
            let _ = fs::remove_file(path);
        }
    }
}

pub fn candidate_env_paths(app_data_dir: Option<&Path>, resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut add = |p: PathBuf| {
        if !paths.contains(&p) {
            paths.push(p);
        }
    };

    if let Ok(cwd) = std::env::current_dir() {
        add(cwd.join(".env.enc"));
        add(cwd.join("app.env.enc"));
        add(cwd.join(".env"));
        add(cwd.join("app.env"));
        // Lên 1 cấp (src-tauri → launcher-tauri)
        add(cwd.join("..").join(".env.enc"));
        add(cwd.join("..").join(".env"));
        // Lên 2 cấp (src-tauri → launcher-tauri → launcher)
        add(cwd.join("..").join("..").join(".env.enc"));
        add(cwd.join("..").join("..").join(".env"));
    }

    // Tìm theo vị trí executable (dev: target/debug/, prod: bên cạnh .exe)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            add(exe_dir.join(".env.enc"));
            add(exe_dir.join(".env"));
            // target/debug → src-tauri
            if let Some(p) = exe_dir.parent() {
                if let Some(p2) = p.parent() {
                    // src-tauri/target/debug → src-tauri → launcher-tauri
                    add(p2.join(".env.enc"));
                    add(p2.join(".env"));
                    if let Some(p3) = p2.parent() {
                        add(p3.join(".env.enc"));
                        add(p3.join(".env"));
                    }
                }
            }
        }
    }

    if let Some(res) = resource_dir {
        add(res.join(".env.enc"));
        add(res.join(".env"));
        // Thư mục cha của resource dir
        if let Some(parent) = res.parent() {
            add(parent.join(".env.enc"));
            add(parent.join(".env"));
        }
    }

    if let Some(data) = app_data_dir {
        add(data.join(".env.enc"));
        add(data.join(".env"));
    }

    if let Ok(appdata) = std::env::var("APPDATA") {
        add(PathBuf::from(appdata.clone()).join("Nyvexa Launcher").join(".env.enc"));
        add(PathBuf::from(appdata.clone()).join("Nyvexa Launcher").join(".env"));
        // Hỗ trợ tên cũ
        add(PathBuf::from(appdata.clone()).join("NestG Launcher").join(".env.enc"));
        add(PathBuf::from(appdata).join("NestG Launcher").join(".env"));
    }

    if let Ok(program_data) = std::env::var("ProgramData") {
        add(PathBuf::from(program_data.clone()).join("Nyvexa Launcher").join(".env.enc"));
        add(PathBuf::from(program_data).join("Nyvexa Launcher").join(".env"));
    }

    paths
}

pub fn load_env_config(app_data_dir: Option<&Path>, resource_dir: Option<&Path>) -> EnvConfig {
    // Hỗ trợ cả key cũ (NESTG_ENV_SECRET) và key mới (NYVEXA_ENV_SECRET)
    let secret = std::env::var("NYVEXA_ENV_SECRET")
        .or_else(|_| std::env::var("NESTG_ENV_SECRET"))
        .unwrap_or_else(|_| ENV_SECRET_DEFAULT.to_string());

    for path in candidate_env_paths(app_data_dir, resource_dir) {
        if !path.exists() {
            continue;
        }

        let lower = path.to_string_lossy().to_lowercase();
        if lower.ends_with(".enc") {
            match load_encrypted(&path, &secret) {
                Ok(vars) => {
                    eprintln!("[env] Loaded encrypted env from: {}", path.display());
                    return EnvConfig { vars, loaded_from: Some(path) };
                }
                Err(e) => {
                    eprintln!("[env] Failed to decrypt {}: {}", path.display(), e);
                    continue;
                }
            }
        }

        if let Ok(content) = fs::read_to_string(&path) {
            eprintln!("[env] Loaded plain env from: {}", path.display());
            let vars = parse_dotenv(&content);
            secure_plain_env(&path, &secret);
            return EnvConfig { vars, loaded_from: Some(path) };
        }
    }

    eprintln!("[env] No env file found, falling back to environment variables");
    let _ = dotenvy::dotenv();
    let mut vars = HashMap::new();
    for (k, v) in std::env::vars() {
        vars.insert(k, v);
    }

    EnvConfig {
        vars,
        loaded_from: None,
    }
}

pub fn supabase_config_from_env(env: &EnvConfig) -> (String, String, String) {
    let url = env
        .get("SUPABASE_URL")
        .or_else(|| env.get("NEXT_PUBLIC_SUPABASE_URL"))
        // Fallback: giá trị embed vào binary lúc compile (build.rs)
        .or_else(|| option_env!("SUPABASE_URL").map(String::from))
        .or_else(|| option_env!("NEXT_PUBLIC_SUPABASE_URL").map(String::from))
        .unwrap_or_default();
    let anon = env
        .get("SUPABASE_ANON_KEY")
        .or_else(|| env.get("SUPABASE_KEY"))
        .or_else(|| env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY"))
        .or_else(|| option_env!("SUPABASE_ANON_KEY").map(String::from))
        .or_else(|| option_env!("SUPABASE_KEY").map(String::from))
        .or_else(|| option_env!("NEXT_PUBLIC_SUPABASE_ANON_KEY").map(String::from))
        .unwrap_or_default();
    let service = env
        .get("SUPABASE_SERVICE_ROLE_KEY")
        .or_else(|| env.get("SUPABASE_SERVICE_KEY"))
        .or_else(|| option_env!("SUPABASE_SERVICE_ROLE_KEY").map(String::from))
        .or_else(|| option_env!("SUPABASE_SERVICE_KEY").map(String::from))
        .unwrap_or_default();
    (url, anon, service)
}
