use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha1::Sha1;
use sha2::{Digest, Sha256};

const ENV_ENCRYPTION_MAGIC: &[u8] = b"Nyvexa_ENV_V1";

pub fn env_encryption_key(secret: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.finalize().into()
}

pub fn decrypt_env_buffer(raw: &[u8], secret: &str) -> Result<String, String> {
    let magic_len = ENV_ENCRYPTION_MAGIC.len();
    if raw.len() < magic_len + 12 + 16 + 1 {
        return Err("Nội dung .env.enc không hợp lệ.".into());
    }
    if &raw[..magic_len] != ENV_ENCRYPTION_MAGIC {
        return Err("Sai định dạng file .env.enc.".into());
    }

    let iv = &raw[magic_len..magic_len + 12];
    let tag = &raw[magic_len + 12..magic_len + 28];
    let payload = &raw[magic_len + 28..];

    let key = env_encryption_key(secret);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let mut combined = payload.to_vec();
    combined.extend_from_slice(tag);

    let plain = cipher
        .decrypt(Nonce::from_slice(iv), combined.as_ref())
        .map_err(|_| "Không thể giải mã file .env.enc.".to_string())?;

    String::from_utf8(plain).map_err(|e| e.to_string())
}

pub fn encrypt_env_text(plain_text: &str, secret: &str) -> Result<Vec<u8>, String> {
    let key = env_encryption_key(secret);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let mut iv = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut iv);
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&iv),
            plain_text.as_bytes(),
        )
        .map_err(|e| e.to_string())?;
    let tag = &encrypted[encrypted.len() - 16..];
    let payload = &encrypted[..encrypted.len() - 16];

    let mut out = Vec::with_capacity(ENV_ENCRYPTION_MAGIC.len() + 12 + 16 + payload.len());
    out.extend_from_slice(ENV_ENCRYPTION_MAGIC);
    out.extend_from_slice(&iv);
    out.extend_from_slice(tag);
    out.extend_from_slice(payload);
    Ok(out)
}

const BASE32_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

pub fn random_base32_secret(length: usize) -> String {
    let mut bytes = vec![0u8; length];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes
        .iter()
        .map(|b| BASE32_ALPHABET[(*b as usize) % BASE32_ALPHABET.len()] as char)
        .collect()
}

fn decode_base32(secret: &str) -> Vec<u8> {
    let clean: String = secret
        .trim_end_matches('=')
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase();

    let mut bits = String::new();
    for ch in clean.chars() {
        if let Some(idx) = BASE32_ALPHABET.iter().position(|&b| b as char == ch) {
            bits.push_str(&format!("{:05b}", idx));
        }
    }

    let mut bytes = Vec::new();
    for chunk in bits.as_bytes().chunks(8) {
        if chunk.len() == 8 {
            if let Ok(s) = std::str::from_utf8(chunk) {
                if let Ok(v) = u8::from_str_radix(s, 2) {
                    bytes.push(v);
                }
            }
        }
    }
    bytes
}

pub fn generate_totp_code(secret: &str, step: u64, digits: u32, now_ms: u128) -> String {
    let key = decode_base32(secret);
    let counter = (now_ms / 1000 / step as u128) as u64;
    let mut buf = [0u8; 8];
    buf[..4].copy_from_slice(&((counter >> 32) as u32).to_be_bytes());
    buf[4..].copy_from_slice(&(counter as u32).to_be_bytes());

    type HmacSha1 = Hmac<Sha1>;
    let mut mac = <HmacSha1 as KeyInit>::new_from_slice(&key).expect("hmac key");
    mac.update(&buf);
    let hmac = mac.finalize().into_bytes();

    let offset = (hmac[hmac.len() - 1] & 0x0f) as usize;
    let code_int = (((hmac[offset] & 0x7f) as u32) << 24)
        | ((hmac[offset + 1] as u32) << 16)
        | ((hmac[offset + 2] as u32) << 8)
        | (hmac[offset + 3] as u32);
    let modulo = 10u32.pow(digits);
    format!("{:0width$}", code_int % modulo, width = digits as usize)
}

pub fn verify_totp_code(secret: &str, code: &str, window_steps: i32) -> bool {
    let input = code.trim();
    if input.len() != 6 || !input.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    for offset in -window_steps..=window_steps {
        let at = now + (offset as i128 * 30000) as u128;
        if generate_totp_code(secret, 30, 6, at) == input {
            return true;
        }
    }
    false
}

pub fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn totp_generates_six_digits() {
        let secret = random_base32_secret(32);
        let code = generate_totp_code(&secret, 30, 6, 1_700_000_000_000);
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn totp_verify_accepts_matching_code() {
        let secret = random_base32_secret(32);
        let now = 1_700_000_000_000u128;
        let code = generate_totp_code(&secret, 30, 6, now);
        assert!(verify_totp_code(&secret, &code, 1));
    }

    #[test]
    fn env_encrypt_decrypt_roundtrip() {
        let secret = "test-secret";
        let plain = "SUPABASE_URL=https://example.supabase.co\nSUPABASE_ANON_KEY=abc\n";
        let enc = encrypt_env_text(plain, secret).expect("encrypt");
        let out = decrypt_env_buffer(&enc, secret).expect("decrypt");
        assert_eq!(out, plain);
    }
}
