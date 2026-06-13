use std::env;
use std::fs;
use std::path::PathBuf;
use std::collections::HashMap;

fn main() {
    tauri_build::build();

    // Fix escaped single quotes in resource.rc for paths with apostrophes
    if cfg!(windows) {
        let out_dir = env::var("OUT_DIR").unwrap();
        let resource_rc = PathBuf::from(&out_dir).join("resource.rc");

        if resource_rc.exists() {
            let content = fs::read_to_string(&resource_rc).unwrap();
            let fixed = content.replace("\\'", "'");
            fs::write(&resource_rc, fixed).unwrap();
            println!("cargo:warning=Patched resource.rc to fix apostrophe escaping");
        }
    }

    // ─── Embed env vars vào binary tại compile time ──────────────────────────
    // Đọc .env từ launcher-tauri/.env (nơi chứa SUPABASE_URL, keys, etc.)
    // Rust code sẽ dùng env!("SUPABASE_URL") hoặc option_env!() ở runtime.
    //
    // Ưu tiên: env var thật > .env file
    // Chỉ set cargo:rustc-env nếu giá trị chưa tồn tại trong env process.

    let env_keys = [
        "SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_KEY",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SERVICE_KEY",
    ];

    // Tìm file .env ở các vị trí khác nhau (dev vs CI)
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let candidates = [
        manifest_dir.join("../.env"),           // launcher-tauri/.env
        manifest_dir.join(".env"),              // src-tauri/.env (fallback)
        manifest_dir.join("../../.env"),        // workspace root/.env
    ];

    let mut file_vars: HashMap<String, String> = HashMap::new();
    for candidate in &candidates {
        if candidate.exists() {
            if let Ok(content) = fs::read_to_string(candidate) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') { continue; }
                    if let Some((k, v)) = trimmed.split_once('=') {
                        let key = k.trim().to_string();
                        let mut value = v.trim().to_string();
                        if (value.starts_with('"') && value.ends_with('"'))
                            || (value.starts_with('\'') && value.ends_with('\'')) {
                            value = value[1..value.len()-1].to_string();
                        }
                        file_vars.entry(key).or_insert(value);
                    }
                }
                println!("cargo:warning=Loaded env from: {}", candidate.display());
                break; // dùng file đầu tiên tìm thấy
            }
        }
    }

    // Emit rustc-env cho mỗi key
    for key in &env_keys {
        // Ưu tiên env var thật (đã set trong shell/CI)
        let val = env::var(key).ok()
            .or_else(|| file_vars.get(*key).cloned());
        if let Some(v) = val {
            if !v.is_empty() {
                println!("cargo:rustc-env={key}={v}");
            }
        }
    }

    // Rerun nếu .env thay đổi
    for candidate in &candidates {
        println!("cargo:rerun-if-changed={}", candidate.display());
    }
}
