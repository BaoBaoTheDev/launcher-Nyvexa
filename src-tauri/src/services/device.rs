use super::crypto::sha256_hex;

pub fn generate_device_id() -> String {
    let hostname = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "unknown".into());
    let platform = std::env::consts::OS;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();
    let hash = sha256_hex(&format!("{hostname}{platform}{timestamp}"));
    hash.chars().take(16).collect()
}

pub fn ensure_device_id(raw: Option<&str>) -> String {
    if let Some(id) = raw {
        let trimmed = id.trim();
        let len = trimmed.len();
        if (8..=64).contains(&len)
            && trimmed
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return trimmed.to_string();
        }
    }
    generate_device_id()
}

mod hostname {
    pub fn get() -> Result<std::ffi::OsString, ()> {
        #[cfg(windows)]
        {
            std::env::var("COMPUTERNAME")
                .map(std::ffi::OsString::from)
                .map_err(|_| ())
        }
        #[cfg(not(windows))]
        {
            std::env::var("HOSTNAME")
                .map(std::ffi::OsString::from)
                .map_err(|_| ())
        }
    }
}
