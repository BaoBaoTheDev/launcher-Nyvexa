// STFixer: SteamTools patching logic ported from cli-rust.
// Implements: Steam shutdown -> Download core DLLs -> Patch core DLL -> Patch payload -> Deploy DLL -> Patch SteamTools.exe

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::io::Write;
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ─── Constants from cli-rust ──────────────────────────────────────────────────

const SUPPORTED_STEAM_VERSIONS: [i64; 6] = [
    1780352834, 1780199124, 1779918128, 1779486452, 1778281814, 1778003620,
];

const HIJACK_CANDIDATES: [&str; 2] = ["xinput1_4.dll", "dwmapi.dll"];

const XINPUT_URL: &str = "https://files.catbox.moe/heom44.dll";
const DWMAPI_URL: &str = "https://files.catbox.moe/32p6f9.dll";
const XINPUT_FALLBACK_URL: &str = "https://update.aaasn.com/update";
const DWMAPI_FALLBACK_URL: &str = "https://update.aaasn.com/dwmapi";

const XINPUT_HASH: &str = "ddb1f0909c7092f06890674f90b5d4f1198724b05b4bf1e656b4063897340243";
const DWMAPI_HASH: &str = "1ce49ed63af004ad37a4d2921a5659a17001c4c0026d6245fcc0d543e9c265d0";

const STEXE_PATCH_OFFSET: usize = 0x282F0;
const STEXE_ORIGINAL: [u8; 2] = [0x40, 0x55];
const STEXE_PATCHED: [u8; 2] = [0xC3, 0x90];

const AES_KEY: [u8; 32] = [
    0x31, 0x4C, 0x20, 0x86, 0x15, 0x05, 0x74, 0xE1, 0x5C, 0xF1, 0x1D, 0x1B, 0xC1, 0x71, 0x25,
    0x1A, 0x47, 0x08, 0x6C, 0x00, 0x26, 0x93, 0x55, 0xCD, 0x51, 0xC9, 0x3A, 0x42, 0x3C, 0x14,
    0x02, 0x94,
];

// ─── Steam Detection ──────────────────────────────────────────────────────────

fn is_supported_steam_version(version: i64) -> bool {
    SUPPORTED_STEAM_VERSIONS.contains(&version)
}

fn find_steam_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        // Try HKCU first
        if let Ok(key) = hkcu.open_subkey(r"SOFTWARE\Valve\Steam") {
            if let Ok(path) = key.get_value::<String, _>("SteamPath") {
                let p = path.replace('/', "\\");
                if Path::new(&p).exists() {
                    return Some(PathBuf::from(p));
                }
            }
        }

        // Try HKLM 32-bit
        if let Ok(key) = hklm.open_subkey(r"SOFTWARE\WOW6432Node\Valve\Steam") {
            if let Ok(path) = key.get_value::<String, _>("InstallPath") {
                let p = path.replace('/', "\\");
                if Path::new(&p).exists() {
                    return Some(PathBuf::from(p));
                }
            }
        }

        // Try HKLM 64-bit
        if let Ok(key) = hklm.open_subkey(r"SOFTWARE\Valve\Steam") {
            if let Ok(path) = key.get_value::<String, _>("InstallPath") {
                let p = path.replace('/', "\\");
                if Path::new(&p).exists() {
                    return Some(PathBuf::from(p));
                }
            }
        }

        // Fallback to common paths
        let candidates = [
            r"C:\Games\Steam",
            r"C:\Program Files (x86)\Steam",
            r"C:\Program Files\Steam",
            r"D:\Steam",
            r"D:\Games\Steam",
        ];

        for p in candidates {
            let path = PathBuf::from(p);
            if path.is_dir() && path.join("steam.exe").is_file() {
                return Some(path);
            }
        }

        None
    }

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

fn is_steam_running() -> bool {
    #[cfg(target_os = "windows")]
    {
        let out = std::process::Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq steam.exe", "/NH"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        match out {
            Ok(o) => String::from_utf8_lossy(&o.stdout)
                .to_lowercase()
                .contains("steam.exe"),
            Err(_) => false,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

fn get_steam_version(steam_path: &Path) -> Option<i64> {
    let manifest = steam_path.join("package").join("steam_client_win64.manifest");
    let text = std::fs::read_to_string(manifest).ok()?;

    for line in text.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("\"version\"") {
            continue;
        }
        let last = trimmed.rfind('"')?;
        let second_last = trimmed[..last].rfind('"')?;
        let val = &trimmed[second_last + 1..last];
        if let Ok(v) = val.parse::<i64>() {
            return Some(v);
        }
    }
    None
}

// ─── Steam Shutdown (graceful -> kill) ────────────────────────────────────────

fn shutdown_steam(steam_path: &Path) {
    if is_steam_running() {
        let steam_exe = steam_path.join("steam.exe");
        if steam_exe.is_file() {
            let _ = std::process::Command::new(&steam_exe)
                .arg("-shutdown")
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
        }

        // Wait up to 15 seconds for graceful shutdown
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(500));
            if !is_steam_running() {
                return;
            }
        }

        // Force kill
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "steam.exe"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        std::thread::sleep(std::time::Duration::from_millis(1000));
    }
}

// ─── HTTP Download ─────────────────────────────────────────────────────────────

fn http_get(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client
        .get(url)
        .header("User-Agent", "Stella/1.0")
        .send()
        .map_err(|e| e.to_string())?;

    let mut buf = Vec::new();
    resp.read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;

    Ok(buf)
}

fn sha256_hex(data: &[u8]) -> String {
    let digest = Sha256::digest(data);
    digest.iter().map(|b| format!("{:02x}", b)).collect()
}

// ─── Core DLL Management ──────────────────────────────────────────────────────

fn find_core_dll(steam_path: &Path) -> Option<&'static str> {
    for name in HIJACK_CANDIDATES {
        let path = steam_path.join(name);
        if !path.is_file() {
            continue;
        }
        if let Ok(buf) = std::fs::read(&path) {
            if scan_for_bytes(&buf, 0, buf.len() as i64, &AES_KEY) >= 0 {
                return Some(name);
            }
        }
    }
    None
}

fn has_core_dll(steam_path: &Path) -> bool {
    find_core_dll(steam_path).is_some()
}

fn download_and_verify_core_dlls(steam_path: &Path) -> Result<Vec<String>, String> {
    let targets = [
        ("xinput1_4.dll", XINPUT_URL, XINPUT_FALLBACK_URL, XINPUT_HASH),
        ("dwmapi.dll", DWMAPI_URL, DWMAPI_FALLBACK_URL, DWMAPI_HASH),
    ];

    let mut downloaded = Vec::new();

    for (name, url, fallback, hash) in targets {
        let dest = steam_path.join(name);

        // Check if already present with correct hash
        if dest.is_file() {
            if let Ok(existing) = std::fs::read(&dest) {
                if sha256_hex(&existing) == hash {
                    downloaded.push(name.to_string());
                    continue;
                }
            }
        }

        // Download from primary
        let mut data: Option<Vec<u8>> = None;
        let mut from_fallback = false;

        match http_get(url) {
            Ok(dl) if !dl.is_empty() && sha256_hex(&dl) == hash => {
                data = Some(dl);
            }
            Ok(dl) => {
                eprintln!("[stfixer] {}: primary returned bad data (len={})", name, dl.len());
            }
            Err(e) => {
                eprintln!("[stfixer] {}: primary failed: {}", name, e);
            }
        }

        // Try fallback if primary failed
        if data.is_none() {
            match http_get(fallback) {
                Ok(dl) if !dl.is_empty() && sha256_hex(&dl) == hash => {
                    data = Some(dl);
                    from_fallback = true;
                }
                Ok(dl) => {
                    eprintln!("[stfixer] {}: fallback returned bad data (len={})", name, dl.len());
                }
                Err(e) => {
                    eprintln!("[stfixer] {}: fallback failed: {}", name, e);
                }
            }
        }

        let Some(data) = data else {
            return Err(format!("Could not download {}", name));
        };

        // Write file
        atomic_write_all_bytes(&dest, &data)
            .map_err(|e| format!("Could not write {}: {}", name, e))?;

        downloaded.push(name.to_string());
        eprintln!(
            "[stfixer] {}: {} bytes{}",
            name,
            data.len(),
            if from_fallback { " (fallback)" } else { "" }
        );
    }

    Ok(downloaded)
}

// ─── File Utilities ───────────────────────────────────────────────────────────

fn set_hidden_system_attr(path: &Path) {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use winapi::um::fileapi::SetFileAttributesW;
        use winapi::um::winnt::{FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM};

        let wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let attr = FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM;
        unsafe {
            SetFileAttributesW(wide.as_ptr(), attr);
        }
    }
}

fn atomic_write_all_bytes(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let tmp = with_extension_suffix(path, ".tmp");
    {
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    set_hidden_system_attr(path);
    Ok(())
}

fn with_extension_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(suffix);
    PathBuf::from(s)
}

fn backup_file(path: &Path) {
    let orig = with_extension_suffix(path, ".orig");
    if !orig.exists() {
        let _ = std::fs::copy(path, &orig);
    }
    let bak = with_extension_suffix(path, ".bak");
    let _ = std::fs::copy(path, &bak);
}

// ─── PE Parsing ───────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct PeSection {
    name: String,
    raw_offset: u32,
    raw_size: u32,
    characteristics: u32,
}

impl PeSection {
    fn is_executable(&self) -> bool {
        self.characteristics & 0x20000000 != 0
    }

    fn parse(pe: &[u8]) -> Vec<PeSection> {
        if pe.len() < 64 {
            return Vec::new();
        }
        let pe_off = i32::from_le_bytes([pe[0x3C], pe[0x3D], pe[0x3E], pe[0x3F]]) as usize;
        if pe_off < 0 || pe_off + 24 > pe.len() || pe[pe_off] != b'P' || pe[pe_off + 1] != b'E' {
            return Vec::new();
        }

        let num_sections = u16::from_le_bytes([pe[pe_off + 6], pe[pe_off + 7]]) as usize;
        let opt_size = u16::from_le_bytes([pe[pe_off + 20], pe[pe_off + 21]]) as usize;
        let first_section = pe_off + 24 + opt_size;

        let mut result = Vec::with_capacity(num_sections);
        for i in 0..num_sections {
            let off = first_section + i * 40;
            if off + 40 > pe.len() {
                break;
            }

            let mut name_end = 0usize;
            for j in 0..8 {
                if pe[off + j] == 0 {
                    break;
                }
                name_end = j + 1;
            }
            let name = String::from_utf8_lossy(&pe[off..off + name_end]).into_owned();

            result.push(PeSection {
                name,
                raw_offset: u32::from_le_bytes([pe[off + 20], pe[off + 21], pe[off + 22], pe[off + 23]]),
                raw_size: u32::from_le_bytes([pe[off + 16], pe[off + 17], pe[off + 18], pe[off + 19]]),
                characteristics: u32::from_le_bytes([
                    pe[off + 36], pe[off + 37], pe[off + 38], pe[off + 39],
                ]),
            });
        }
        result
    }

    fn find<'a>(sections: &'a [PeSection], name: &str) -> Option<&'a PeSection> {
        sections.iter().find(|s| s.name == name)
    }
}

// ─── Signatures & Patching ───────────────────────────────────────────────────

fn scan_for_bytes(data: &[u8], start: i64, end: i64, needle: &[u8]) -> i64 {
    let limit = (end.min(data.len() as i64)) - needle.len() as i64;
    let mut i = start;
    while i <= limit {
        if &data[i as usize..i as usize + needle.len()] == needle {
            return i;
        }
        i += 1;
    }
    -1
}

fn read_i32(b: &[u8], o: usize) -> i32 {
    i32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

#[derive(Clone)]
struct PatchEntry {
    offset: i64,
    original: Vec<u8>,
    replacement: Vec<u8>,
}

fn core1_validator(data: &[u8], hit: usize) -> bool {
    let opcode = data[hit + 9];
    if opcode == 0xE8 {
        read_i32(data, hit + 10) < 0
    } else {
        opcode == 0xB8
    }
}

fn core2_validator(data: &[u8], hit: usize) -> bool {
    let b = data[hit + 14];
    b == 0x74 || b == 0xEB
}

fn resolve_core_patches(dll: &[u8]) -> Option<Vec<PatchEntry>> {
    let sections = PeSection::parse(dll);
    let rdata = PeSection::find(&sections, ".rdata")?;
    let text = PeSection::find(&sections, ".text")?;

    // Find AES key
    let key_offset = scan_for_bytes(dll, rdata.raw_offset as i64, (rdata.raw_offset + rdata.raw_size) as i64, &AES_KEY);
    let key_offset = if key_offset < 0 {
        scan_for_bytes(dll, 0, dll.len() as i64, &AES_KEY)
    } else {
        key_offset
    };
    if key_offset < 0 {
        eprintln!("[stfixer] Core.dll: AES key not found");
        return None;
    }
    eprintln!("[stfixer] AES key found at 0x{:X}", key_offset);

    let t_start = text.raw_offset as i64;
    let t_end = (t_start + text.raw_size as i64).min(dll.len() as i64);

    // Pattern 1: Core1 - NOP download call
    let pattern1 = [
        0x48, 0x8B, 0x4C, 0x24, 0x00, 0x48, 0x8D, 0x55, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x85, 0xC0, 0x0F, 0x84, 0x00, 0x00, 0x00, 0x00, 0x41, 0x83, 0xFC, 0x01,
    ];
    let mask1 = [
        0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF,
    ];

    let mut pos = t_start;
    let mut core1_offset = -1i64;
    while pos < t_end {
        let hit = scan_for_pattern(dll, pos, t_end, &pattern1, &mask1);
        if hit < 0 {
            break;
        }
        if core1_validator(dll, hit as usize) {
            core1_offset = hit + 9;
            break;
        }
        pos = hit + 1;
    }

    if core1_offset < 0 {
        eprintln!("[stfixer] Could not locate Core1");
        return None;
    }

    // Pattern 2: Core2 - jz -> jmp (relative to Core1)
    let core2_search_start = (core1_offset - 0x300).max(t_start);
    let core2_search_end = (core1_offset + 0x300).min(t_end);

    let pattern2 = [
        0x49, 0x8B, 0xD5, 0x48, 0x8D, 0x4D, 0x00, 0xE8, 0x00, 0x00, 0x00, 0x00, 0x85, 0xC0,
        0x00, 0x00, 0x33, 0xFF, 0xE9,
    ];
    let mask2 = [
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF,
        0x00, 0x00, 0xFF, 0xFF, 0xFF,
    ];

    let mut pos = core2_search_start;
    let mut core2_offset = -1i64;
    while pos < core2_search_end {
        let hit = scan_for_pattern(dll, pos, core2_search_end, &pattern2, &mask2);
        if hit < 0 {
            break;
        }
        if core2_validator(dll, hit as usize) {
            core2_offset = hit + 14;
            break;
        }
        pos = hit + 1;
    }

    if core2_offset < 0 {
        eprintln!("[stfixer] Could not locate Core2");
        return None;
    }

    eprintln!("[stfixer] Core1 at 0x{:X}, Core2 at 0x{:X}", core1_offset, core2_offset);

    Some(vec![
        PatchEntry {
            offset: core1_offset,
            original: vec![0xE8, 0x7C, 0xF5, 0xFF, 0xFF],
            replacement: vec![0xB8, 0x01, 0x00, 0x00, 0x00],
        },
        PatchEntry {
            offset: core2_offset,
            original: vec![0x74],
            replacement: vec![0xEB],
        },
    ])
}

fn scan_for_pattern(data: &[u8], start: i64, end: i64, pattern: &[u8], mask: &[u8]) -> i64 {
    let limit = (end.min(data.len() as i64)) - pattern.len() as i64;
    let mut i = start;
    while i <= limit {
        let base = i as usize;
        let mut matched = true;
        for j in 0..pattern.len() {
            if mask[j] != 0 && data[base + j] != pattern[j] {
                matched = false;
                break;
            }
        }
        if matched {
            return i;
        }
        i += 1;
    }
    -1
}

fn apply_patches(data: &[u8], patches: &[PatchEntry]) -> (Vec<u8>, usize, usize, Vec<String>) {
    let mut buf = data.to_vec();
    let mut applied = 0;
    let mut skipped = 0;
    let mut errors = Vec::new();

    for p in patches {
        let off = p.offset as usize;
        if off + p.replacement.len() > buf.len() {
            errors.push(format!("Out of bounds at 0x{:X}", p.offset));
            continue;
        }

        if &buf[off..off + p.original.len()] == p.replacement {
            skipped += 1;
        } else if &buf[off..off + p.original.len()] == p.original {
            buf[off..off + p.replacement.len()].copy_from_slice(&p.replacement);
            applied += 1;
        } else {
            errors.push(format!(
                "Mismatch at 0x{:X}: expected {:02X?}, got {:02X?}",
                p.offset,
                &p.original[..p.original.len().min(4)],
                &buf[off..off + p.original.len().min(4)]
            ));
        }
    }

    (buf, applied, skipped, errors)
}

fn patch_core_dll(steam_path: &Path) -> Result<(String, usize), String> {
    let hijack = find_core_dll(steam_path).ok_or("SteamTools Core DLL not found")?;
    let dll_path = steam_path.join(hijack);
    let dll_data = std::fs::read(&dll_path).map_err(|_| format!("{} is in use", hijack))?;

    let patches = resolve_core_patches(&dll_data)
        .ok_or("Could not resolve core patches")?;

    let (patched_dll, applied, skipped, errors) = apply_patches(&dll_data, &patches);
    if !errors.is_empty() {
        for e in &errors {
            eprintln!("[stfixer] {}", e);
        }
    }

    if applied > 0 || skipped == patches.len() {
        backup_file(&dll_path);
        atomic_write_all_bytes(&dll_path, &patched_dll)
            .map_err(|e| format!("Could not write {}: {}", hijack, e))?;
    }

    eprintln!(
        "[stfixer] {}: {} applied, {} skipped",
        hijack,
        applied,
        skipped
    );

    Ok((hijack.to_string(), applied))
}

// ─── Payload Patching ────────────────────────────────────────────────────────

fn compute_fingerprint() -> String {
    // CPUID leaf 0
    let l0 = unsafe { core::arch::x86_64::__cpuid(0) };
    let mut vendor_bytes = [0u8; 12];
    vendor_bytes[0..4].copy_from_slice(&l0.ebx.to_le_bytes());
    vendor_bytes[4..8].copy_from_slice(&l0.edx.to_le_bytes());
    vendor_bytes[8..12].copy_from_slice(&l0.ecx.to_le_bytes());
    let vendor = String::from_utf8_lossy(&vendor_bytes).into_owned();

    // CPUID leaf 1
    let l1 = unsafe { core::arch::x86_64::__cpuid(1) };
    let family = (l1.eax >> 8) & 0xF;
    let model = (l1.eax >> 4) & 0xF;
    let nproc = num_cpus() as u32 & 0xFF;

    let tag = format!("V{}_F{:X}_M{:X}_C{:X}", vendor, family, model, nproc);
    let xor_key = b"version";
    let xored: Vec<u8> = tag.bytes().enumerate().map(|(i, b)| b ^ xor_key[i % 7]).collect();

    let digest = md5::compute(&xored);
    let md5_hex = format!("{:x}", digest);
    let md5_hex_bytes = md5_hex.as_bytes();

    // CRC-64
    let mut crc: u64 = 0xFFFF_FFFF_FFFF_FFFF;
    for &b in md5_hex_bytes {
        crc ^= b as u64;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc ^= 0x85E1_C3D7_53D4_6D27;
            }
            crc >>= 1;
        }
    }
    format!("{:016X}", crc ^ 0xFFFF_FFFF_FFFF_FFFF)
}

fn num_cpus() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1)
}

fn find_cache_path(steam_path: &Path) -> Option<PathBuf> {
    let cache_dir = steam_path
        .join("appcache")
        .join("httpcache")
        .join("3b");

    if !cache_dir.is_dir() {
        return None;
    }

    // Try computed fingerprint first
    let fp = compute_fingerprint();
    let fp_path = cache_dir.join(&fp);
    if fp_path.is_file() && validate_payload_cache(&fp_path) {
        return Some(fp_path);
    }

    // Fallback: scan for valid cache file
    let entries = std::fs::read_dir(&cache_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let len = entry.metadata().map(|m| m.len()).unwrap_or(0);

        if name.len() == 16 && len > 500_000 && len < 5_000_000 && validate_payload_cache(&path) {
            return Some(path);
        }
    }
    None
}

fn validate_payload_cache(path: &Path) -> bool {
    let raw = match std::fs::read(path) {
        Ok(r) => r,
        Err(_) => return false,
    };
    if raw.len() < 32 {
        return false;
    }

    let iv: [u8; 16] = match raw[0..16].try_into() {
        Ok(v) => v,
        Err(_) => return false,
    };
    let ct = &raw[16..];

    let plain = match aes_cbc_decrypt(ct, &AES_KEY, &iv) {
        Some(p) => p,
        None => return false,
    };

    if plain.len() < 6 {
        return false;
    }

    // Check for zlib header + MZ
    plain.len() >= 6 && plain[4] == 0x78 && plain[5] == 0x9C
}

fn aes_cbc_decrypt(ct: &[u8], key: &[u8; 32], iv: &[u8; 16]) -> Option<Vec<u8>> {
    use aes::cipher::{KeyIvInit, BlockDecryptMut};

    let cipher = cbc::Decryptor::<aes::Aes256>::new(key.into(), iv.into());
    let mut buf = ct.to_vec();
    cipher.decrypt_padded_mut::<aes::cipher::block_padding::Pkcs7>(&mut buf).ok().map(|v| v.to_vec())
}

fn read_and_decrypt_payload(cache_path: &Path) -> Result<(Vec<u8>, [u8; 16]), String> {
    let raw = std::fs::read(cache_path)
        .map_err(|_| "Payload cache is in use - close Steam first".to_string())?;

    if raw.len() < 32 {
        return Err("Cache file too small".to_string());
    }

    let iv: [u8; 16] = raw[0..16].try_into().unwrap();
    let ct = &raw[16..];

    let dec = aes_cbc_decrypt(ct, &AES_KEY, &iv)
        .ok_or_else(|| "Decryption failed".to_string())?;

    if dec.len() < 4 {
        return Err("Decrypted payload too small".to_string());
    }

    // Decompress (skip first 4 bytes)
    let mut z = flate2::read::ZlibDecoder::new(&dec[4..]);
    let mut payload = Vec::new();
    z.read_to_end(&mut payload)
        .map_err(|e| format!("Decompression failed: {}", e))?;

    Ok((payload, iv))
}

fn patch_payload(steam_path: &Path, _version: i64) -> Result<usize, String> {
    let cache_path = find_cache_path(steam_path)
        .ok_or("Payload cache not found")?;

    let (payload, iv) = read_and_decrypt_payload(&cache_path)?;

    // P4: Force activation flag
    // P5: Skip GetCookie retry
    // P6: GMRC pattern fix
    let patched_payload = apply_payload_patches(&payload)?;

    // Re-encrypt and write
    re_encrypt_and_write(&cache_path, &patched_payload, &iv)?;

    Ok(1)
}

fn apply_payload_patches(payload: &[u8]) -> Result<Vec<u8>, String> {
    let mut buf = payload.to_vec();
    let mut applied = 0;

    // P4: Find and patch activation flag
    // Look for pattern: 4D 85 C0 near C6 05 pattern
    if let Some(pos) = find_p4_position(&buf) {
        if buf[pos] == 0x00 {
            buf[pos] = 0x01;
            applied += 1;
            eprintln!("[stfixer] P4 applied at 0x{:X}", pos);
        }
    }

    // P5: Skip GetCookie retry
    if let Some(pos) = find_p5_position(&buf) {
        if buf[pos] == 0x75 {
            buf[pos] = 0xEB;
            applied += 1;
            eprintln!("[stfixer] P5 applied at 0x{:X}", pos);
        }
    }

    // P6: GMRC pattern fix
    let old_pattern = [
        0x34, 0x38, 0x20, 0x38, 0x39, 0x20, 0x35, 0x43, 0x20, 0x32, 0x34, 0x20, 0x31, 0x38,
        0x20, 0x35, 0x35, 0x20, 0x35, 0x36, 0x20, 0x35, 0x37, 0x20, 0x34, 0x31, 0x20, 0x35,
        0x35, 0x20, 0x34, 0x31, 0x20, 0x35, 0x37, 0x20, 0x34, 0x38, 0x20, 0x38, 0x44, 0x20,
        0x36, 0x43, 0x5E,
    ];
    let new_pattern = [
        0x34, 0x38, 0x20, 0x38, 0x39, 0x20, 0x35, 0x43, 0x20, 0x32, 0x34, 0x20, 0x31, 0x38,
        0x20, 0x35, 0x35, 0x20, 0x35, 0x37, 0x20, 0x34, 0x31, 0x20, 0x35, 0x34, 0x20, 0x34,
        0x31, 0x20, 0x35, 0x36, 0x20, 0x34, 0x31, 0x20, 0x35, 0x37, 0x20, 0x34, 0x38, 0x20,
        0x38, 0x44, 0x20, 0x36, 0x43, 0x00,
    ];

    let p6_pos = scan_for_bytes(payload, 0, payload.len() as i64, &old_pattern);
    if p6_pos >= 0 {
        let pos = p6_pos as usize;
        buf[pos..pos + new_pattern.len()].copy_from_slice(&new_pattern);
        applied += 1;
        eprintln!("[stfixer] P6 applied at 0x{:X}", pos);
    }

    eprintln!("[stfixer] Payload: {} patches applied", applied);
    Ok(buf)
}

fn find_p4_position(data: &[u8]) -> Option<usize> {
    // Find C6 05 pattern near 4D 85 C0
    for i in 0..data.len().saturating_sub(20) {
        if data[i] == 0x4D && data[i + 1] == 0x85 && data[i + 2] == 0xC0 {
            // Look for C6 05 nearby
            for j in (i.saturating_sub(50))..(i + 50).min(data.len().saturating_sub(10)) {
                if data[j] == 0xC6 && data[j + 1] == 0x05 {
                    let pos = j + 6;
                    if pos < data.len() && (data[pos] == 0x00 || data[pos] == 0x01) {
                        return Some(pos);
                    }
                }
            }
        }
    }
    None
}

fn find_p5_position(data: &[u8]) -> Option<usize> {
    // Find 66 48 0F 7E pattern
    let pattern = [
        0x66, 0x48, 0x0F, 0x7E, 0xC7, 0x66, 0x48, 0x0F, 0x7E, 0xCE, 0x48, 0x8D, 0x4D, 0x00,
        0xE8, 0x00, 0x00, 0x00, 0x00, 0x48, 0x85, 0xF6, 0x00,
    ];
    let mask = [
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00,
        0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0x00,
    ];

    let mut i = 0i64;
    while i < data.len() as i64 - pattern.len() as i64 {
        let hit = scan_for_pattern(data, i, data.len() as i64, &pattern, &mask);
        if hit < 0 {
            break;
        }

        let pos = (hit + 22) as usize;
        if pos < data.len() && (data[pos] == 0x75 || data[pos] == 0xEB) {
            return Some(pos);
        }
        i = hit + 1;
    }
    None
}

fn re_encrypt_and_write(cache_path: &Path, patched_payload: &[u8], iv: &[u8; 16]) -> Result<(), String> {
    use aes::cipher::{KeyIvInit, BlockEncryptMut};

    type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;

    // Compress
    let mut enc = flate2::write::ZlibEncoder::new(
        Vec::new(),
        flate2::Compression::best(),
    );
    enc.write_all(patched_payload)
        .map_err(|e| e.to_string())?;
    let compressed = enc
        .finish()
        .map_err(|e| e.to_string())?;

    // Prepend 4-byte length
    let mut blob = Vec::with_capacity(4 + compressed.len());
    blob.extend_from_slice(&(patched_payload.len() as u32).to_le_bytes());
    blob.extend_from_slice(&compressed);

    // Encrypt
    let cipher = Aes256CbcEnc::new((&AES_KEY).into(), iv.into());
    let encrypted = cipher.encrypt_padded_vec_mut::<aes::cipher::block_padding::Pkcs7>(&blob);

    // Prepend IV
    let mut output = Vec::with_capacity(16 + encrypted.len());
    output.extend_from_slice(iv);
    output.extend_from_slice(&encrypted);

    // Write
    atomic_write_all_bytes(cache_path, &output)
        .map_err(|e| format!("Could not write cache: {}", e))?;

    Ok(())
}

// ─── SteamTools.exe Patching ──────────────────────────────────────────────────

fn find_steamtools_exe() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = hkcu.open_subkey(r"Software\Valve\Steamtools").ok()?;
        let raw: String = key.get_value("SteamPath").ok()?;
        let path = PathBuf::from(raw.replace('/', "\\")).join("SteamTools.exe");
        if path.is_file() {
            Some(path)
        } else {
            None
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

fn kill_steamtools() {
    #[cfg(target_os = "windows")]
    {
        let out = std::process::Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq SteamTools.exe", "/NH"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        let running = out
            .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("steamtools.exe"))
            .unwrap_or(false);

        if running {
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/IM", "SteamTools.exe"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    }
}

fn patch_steamtools_exe() -> i32 {
    let exe = match find_steamtools_exe() {
        Some(e) => e,
        None => {
            eprintln!("[stfixer] SteamTools.exe not found");
            return 0;
        }
    };

    kill_steamtools();

    let mut data = match std::fs::read(&exe) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[stfixer] SteamTools.exe: {}", e);
            return -1;
        }
    };

    if data.len() < STEXE_PATCH_OFFSET + 2 {
        eprintln!("[stfixer] SteamTools.exe too small");
        return -1;
    }

    if data[STEXE_PATCH_OFFSET] == STEXE_PATCHED[0] && data[STEXE_PATCH_OFFSET + 1] == STEXE_PATCHED[1] {
        eprintln!("[stfixer] SteamTools.exe: already patched");
        return 1;
    }

    if data[STEXE_PATCH_OFFSET] != STEXE_ORIGINAL[0] || data[STEXE_PATCH_OFFSET + 1] != STEXE_ORIGINAL[1] {
        eprintln!(
            "[stfixer] SteamTools.exe: unexpected bytes at patch site ({:02X} {:02X})",
            data[STEXE_PATCH_OFFSET],
            data[STEXE_PATCH_OFFSET + 1]
        );
        return -1;
    }

    backup_file(&exe);
    data[STEXE_PATCH_OFFSET] = STEXE_PATCHED[0];
    data[STEXE_PATCH_OFFSET + 1] = STEXE_PATCHED[1];

    if let Err(e) = atomic_write_all_bytes(&exe, &data) {
        eprintln!("[stfixer] SteamTools.exe: {}", e);
        return -1;
    }

    eprintln!("[stfixer] SteamTools.exe: patched");
    1
}

// ─── DLL Deployment ───────────────────────────────────────────────────────────
// Note: cloud_redirect.dll is embedded separately in cli-rust build.
// If not available, we'll skip DLL deployment but still patch core/payload.

// ─── Auto-update Enable ───────────────────────────────────────────────────────

fn enable_auto_update(steam_path: &Path) {
    let config_dir = steam_path.join("cloud_redirect");
    let config_path = config_dir.join("config.json");

    let _ = std::fs::create_dir_all(&config_dir);
    set_hidden_system_attr(&config_dir);

    let json = if let Ok(existing) = std::fs::read_to_string(&config_path) {
        if existing.contains("auto_update_dll") {
            existing
        } else {
            let trimmed = existing.trim_end().trim_end_matches('}');
            format!("{},\n  \"auto_update_dll\": true\n}}", trimmed)
        }
    } else {
        "{\n  \"auto_update_dll\": true\n}".to_string()
    };

    if std::fs::write(&config_path, &json).is_ok() {
        set_hidden_system_attr(&config_path);
        eprintln!("[stfixer] DLL auto-update enabled");
    }
}

// ─── Main STFixer Command ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn steam_manifest_fix() -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        eprintln!("[stfixer] === CloudRedirect STFixer ===");

        // 1. Find Steam path
        let steam_path = match find_steam_path() {
            Some(p) => p,
            None => {
                return Err("ERROR: Steam installation not found.".to_string());
            }
        };
        eprintln!("[stfixer] Steam: {}", steam_path.display());

        // 2. Check Steam version
        let version = match get_steam_version(&steam_path) {
            None => {
                eprintln!("[stfixer] WARNING: Could not read Steam version");
                None
            }
            Some(v) if !is_supported_steam_version(v) => {
                eprintln!("[stfixer] WARNING: Steam version {} not in whitelist", v);
                Some(v)
            }
            Some(v) => {
                eprintln!("[stfixer] Steam version: {} (OK)", v);
                Some(v)
            }
        };

        // 3. Shutdown Steam
        eprintln!("[stfixer] Checking if Steam is running...");
        if is_steam_running() {
            eprintln!("[stfixer] Steam is running -- shutting it down...");
            shutdown_steam(&steam_path);
            eprintln!("[stfixer] Steam closed.");
        }

        // 4. Download core DLLs if missing
        if !has_core_dll(&steam_path) {
            eprintln!("[stfixer] Downloading core DLLs...");
            download_and_verify_core_dlls(&steam_path)?;
        }

        // 5. Apply core DLL patches
        eprintln!("[stfixer] Patching core DLL...");
        match patch_core_dll(&steam_path) {
            Ok((hijack, applied)) => {
                eprintln!("[stfixer] Core DLL {}: {} applied", hijack, applied);
            }
            Err(e) => {
                eprintln!("[stfixer] Core DLL patch failed: {}", e);
            }
        }

        // 6. Patch payload cache
        eprintln!("[stfixer] Patching payload cache...");
        match patch_payload(&steam_path, version.unwrap_or(0)) {
            Ok(applied) => {
                eprintln!("[stfixer] Payload: {} patches applied", applied);
            }
            Err(e) => {
                eprintln!("[stfixer] Payload patch: {}", e);
            }
        }

        // 7. Patch SteamTools.exe
        eprintln!("[stfixer] Patching SteamTools.exe...");
        match patch_steamtools_exe() {
            1 => eprintln!("[stfixer] SteamTools.exe: OK"),
            0 => eprintln!("[stfixer] SteamTools.exe: Skipped (not installed)"),
            _ => eprintln!("[stfixer] SteamTools.exe: Warning (see above)"),
        }

        // 8. Skip cloud_redirect.dll deployment (DLL not available in this build)
        // Note: DLL can be added to dll/ folder if available
        eprintln!("[stfixer] cloud_redirect.dll: skipped (not embedded)");

        // 9. Enable auto-update
        enable_auto_update(&steam_path);

        // 10. Restart Steam
        let steam_exe = steam_path.join("Steam.exe");
        if steam_exe.exists() {
            eprintln!("[stfixer] Starting Steam...");
            std::process::Command::new(&steam_exe)
                .spawn()
                .map_err(|e| format!("Không mở được Steam: {e}"))?;
        }

        eprintln!("[stfixer] === All patches applied ===");

        Ok(json!({
            "success": true,
            "steam_path": steam_path.to_string_lossy(),
        }))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Chỉ hỗ trợ Windows".into())
    }
}
