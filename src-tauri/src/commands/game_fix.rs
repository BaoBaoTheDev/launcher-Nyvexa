/// Game Fix activation: tải file zip bypass, giải nén, set hidden+system, merge vào folder game
///
/// Workflow:
///   1. Đọc SteamPath từ registry (HKCU\SOFTWARE\Valve\Steam)
///   2. Tự dò folder game tại: <SteamPath>\steamapps\common\<fix_folder_name>
///   3. Verify folder game (có file <fix_exe_name> + steam_api64.dll)
///   4. Verify <SteamPath>\steamapps\appmanifest_<appid>.acf
///   5. Nếu thiếu → trả NeedsManualPath để frontend mở dialog browse
///   6. Tải zip về temp launcher → giải nén → set hidden+system attrib → merge vào folder game
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::State;

use crate::state::AppState;

#[cfg(target_os = "windows")]
use crate::commands::steam_integration::set_hidden_system_attr;

#[cfg(not(target_os = "windows"))]
fn set_hidden_system_attr(_path: &Path) -> std::io::Result<()> { Ok(()) }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArchiveKind {
    Zip,
    Rar,
}

/// Đọc SteamPath từ registry. Trả về None nếu không tìm thấy.
fn read_steam_path() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = hkcu.open_subkey("SOFTWARE\\Valve\\Steam").ok()?;
        let path: String = key.get_value("SteamPath").ok()?;
        Some(path)
    }
    #[cfg(not(target_os = "windows"))]
    { None }
}

#[derive(Debug)]
struct VerifyResult {
    has_exe: bool,
    has_steam_api: bool,
    missing: Vec<String>,
}

fn verify_game_folder(folder: &Path, exe_name: &str, dll_name: &str) -> VerifyResult {
    let exe_path = folder.join(exe_name);
    let api_path = folder.join(dll_name);
    let mut missing = Vec::new();
    let has_exe = exe_path.is_file();
    let has_steam_api = api_path.is_file();
    if !has_exe { missing.push(exe_name.to_string()); }
    if !has_steam_api { missing.push(dll_name.to_string()); }
    VerifyResult { has_exe, has_steam_api, missing }
}

/// Đệ quy tìm folder chứa CẢ <exe_name> VÀ <dll_name> trong root.
/// Trả về đường dẫn đầu tiên match (BFS — folder ở mức nông sẽ được kiểm tra trước).
/// Bỏ qua các folder hệ thống / quá sâu để tránh stack overflow & quét quá lâu.
fn find_game_folder_recursive(root: &Path, exe_name: &str, dll_name: &str, max_depth: usize) -> Option<PathBuf> {
    use std::collections::VecDeque;
    let mut queue: VecDeque<(PathBuf, usize)> = VecDeque::new();
    queue.push_back((root.to_path_buf(), 0));

    // Skip-list cho các folder bloat (engine cache, etc.) — không bắt buộc nhưng tăng tốc
    let skip_names = ["$RECYCLE.BIN", "System Volume Information", ".git", "node_modules"];

    while let Some((dir, depth)) = queue.pop_front() {
        if !dir.is_dir() { continue; }

        // 1. Check ngay tại dir hiện tại
        let v = verify_game_folder(&dir, exe_name, dll_name);
        if v.has_exe && v.has_steam_api {
            return Some(dir);
        }

        if depth >= max_depth { continue; }

        // 2. Đẩy subdirs vào queue
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() { continue; }
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if skip_names.contains(&name) { continue; }
            }
            queue.push_back((p, depth + 1));
        }
    }
    None
}

fn appmanifest_path(steam_path: &str, appid: &str) -> PathBuf {
    PathBuf::from(steam_path)
        .join("steamapps")
        .join(format!("appmanifest_{appid}.acf"))
}

/// Tải file archive (zip/rar) về temp dir của launcher.
/// Validate magic bytes để xác định kiểu archive.
async fn download_archive(url: &str, dest: &Path) -> Result<ArchiveKind, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("Nyvexa-Launcher/1.0")
        .build()
        .map_err(|e| format!("Lỗi tạo HTTP client: {e}"))?;

    let resp = client.get(url).send().await
        .map_err(|e| format!("Không tải được file: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("Tải thất bại: HTTP {status}"));
    }

    let content_type = resp.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Không tạo được temp dir: {e}"))?;
    }

    let bytes = resp.bytes().await.map_err(|e| format!("Lỗi đọc body: {e}"))?;

    if bytes.len() < 8 {
        return Err(format!(
            "File tải về quá nhỏ ({} bytes). URL có thể không trả về file thực. Content-Type: {}",
            bytes.len(),
            if content_type.is_empty() { "không có" } else { &content_type }
        ));
    }

    // Magic bytes:
    //   ZIP: 50 4B 03 04 (local file) hoặc 50 4B 05 06 (empty)
    //   RAR v4: 52 61 72 21 1A 07 00       ("Rar!\x1A\x07\x00")
    //   RAR v5: 52 61 72 21 1A 07 01 00    ("Rar!\x1A\x07\x01\x00")
    let head = &bytes[..8.min(bytes.len())];
    let is_zip = head.len() >= 4
        && head[0] == 0x50 && head[1] == 0x4B
        && (head[2] == 0x03 || head[2] == 0x05 || head[2] == 0x07);
    let is_rar = head.len() >= 7
        && head[0] == 0x52 && head[1] == 0x61 && head[2] == 0x72 && head[3] == 0x21
        && head[4] == 0x1A && head[5] == 0x07;

    if !is_zip && !is_rar {
        let preview: String = bytes.iter().take(120)
            .map(|b| if b.is_ascii_graphic() || *b == b' ' { *b as char } else { '·' })
            .collect();
        let is_html = bytes.len() > 5 && (
            bytes.starts_with(b"<!DOC")
            || bytes.starts_with(b"<html")
            || bytes.starts_with(b"<!doc")
            || bytes.starts_with(b"<HTML")
            || bytes.starts_with(b"<?xml")
            || preview.to_lowercase().contains("<html")
        );

        let hint = if is_html {
            "URL trả về trang HTML chứ không phải file. \
             Hãy kiểm tra link trực tiếp tới file zip/rar."
        } else {
            "File tải về không phải định dạng zip/rar hợp lệ. Hỗ trợ: .zip, .rar"
        };

        return Err(format!(
            "{hint}\nContent-Type: {ct}\nKích thước: {sz} bytes\nMagic bytes (hex): {hex}\nPreview: {prev}",
            hint = hint,
            ct = if content_type.is_empty() { "không có" } else { &content_type },
            sz = bytes.len(),
            hex = head.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" "),
            prev = preview,
        ));
    }

    let kind = if is_zip { ArchiveKind::Zip } else { ArchiveKind::Rar };

    let mut f = fs::File::create(dest).map_err(|e| format!("Không tạo được file archive: {e}"))?;
    f.write_all(&bytes).map_err(|e| format!("Lỗi ghi archive: {e}"))?;
    Ok(kind)
}

/// Giải nén archive (zip hoặc rar) vào dest_dir.
fn extract_archive(archive_path: &Path, dest_dir: &Path, kind: ArchiveKind) -> Result<(), String> {
    fs::create_dir_all(dest_dir).map_err(|e| format!("Không tạo được dest dir: {e}"))?;
    match kind {
        ArchiveKind::Zip => extract_zip(archive_path, dest_dir),
        ArchiveKind::Rar => extract_rar(archive_path, dest_dir),
    }
}

/// Giải nén zip vào dest_dir (preserve cấu trúc thư mục).
fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("Không mở được zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Không đọc được zip: {e}"))?;

    fs::create_dir_all(dest_dir).map_err(|e| format!("Không tạo được dest dir: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Lỗi đọc entry {i}: {e}"))?;
        let rel_path = match entry.enclosed_name() {
            Some(p) => p.to_path_buf(),
            None => continue,
        };
        let out_path = dest_dir.join(&rel_path);
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| format!("Lỗi mkdir: {e}"))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Lỗi mkdir parent: {e}"))?;
            }
            let mut out_file = fs::File::create(&out_path).map_err(|e| format!("Lỗi tạo file: {e}"))?;
            let mut buf = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut buf).map_err(|e| format!("Lỗi đọc entry: {e}"))?;
            out_file.write_all(&buf).map_err(|e| format!("Lỗi ghi: {e}"))?;
        }
    }
    Ok(())
}

/// Giải nén RAR vào dest_dir bằng crate `unrar` (tự xử lý cấu trúc thư mục).
fn extract_rar(rar_path: &Path, dest_dir: &Path) -> Result<(), String> {
    use unrar::Archive;

    fs::create_dir_all(dest_dir).map_err(|e| format!("Không tạo được dest dir: {e}"))?;

    // Mở rar, lặp qua từng entry và giải nén từng cái
    let mut archive = Archive::new(rar_path)
        .open_for_processing()
        .map_err(|e| format!("Không mở được RAR: {e}"))?;

    while let Some(header) = archive.read_header().map_err(|e| format!("Lỗi đọc header RAR: {e}"))? {
        let entry = header.entry();
        let rel_path = entry.filename.clone();
        let out_path = dest_dir.join(&rel_path);

        if entry.is_directory() {
            fs::create_dir_all(&out_path).map_err(|e| format!("Lỗi mkdir: {e}"))?;
            archive = header.skip().map_err(|e| format!("Lỗi skip RAR dir: {e}"))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Lỗi mkdir parent: {e}"))?;
            }
            archive = header.extract_to(&out_path)
                .map_err(|e| format!("Lỗi giải nén {} từ RAR: {e}", rel_path.display()))?;
        }
    }
    Ok(())
}

/// Đặt hidden+system cho mọi file/folder trong dir (recursive).
fn mark_hidden_recursive(dir: &Path) {
    let _ = set_hidden_system_attr(dir);
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            mark_hidden_recursive(&p);
        } else {
            let _ = set_hidden_system_attr(&p);
        }
    }
}

/// Copy đệ quy: source_dir → dest_dir (overwrite nếu file đã tồn tại).
fn copy_dir_recursive(source: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("Lỗi mkdir dest: {e}"))?;
    for entry in fs::read_dir(source).map_err(|e| format!("Lỗi đọc {}: {e}", source.display()))? {
        let entry = entry.map_err(|e| format!("Lỗi entry: {e}"))?;
        let from = entry.path();
        let file_name = entry.file_name();
        let to = dest.join(&file_name);
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            // Bỏ qua nếu source rỗng path
            fs::copy(&from, &to).map_err(|e| format!("Lỗi copy {} → {}: {e}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

/// Folder temp riêng của launcher cho gamefix.
fn launcher_temp_dir() -> PathBuf {
    let mut d = std::env::temp_dir();
    d.push("nyvexa-launcher");
    d.push("gamefix");
    d
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

/// Kiểm tra trước khi Kích hoạt:
///   - Trả về SteamPath (nếu có)
///   - Nếu folder auto-dò OK + appmanifest OK → ready=true, game_path = auto path
///   - Nếu thiếu → ready=false, hint phù hợp; FE sẽ yêu cầu user chọn folder
#[tauri::command]
pub async fn game_fix_precheck(
    _state: State<'_, AppState>,
    appid: String,
    fix_folder_name: String,
    fix_exe_name: String,
    fix_dll_name: Option<String>,
) -> Result<Value, String> {
    let dll_name = fix_dll_name.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()).unwrap_or("steam_api64.dll").to_string();
    if appid.trim().is_empty() || fix_folder_name.trim().is_empty() || fix_exe_name.trim().is_empty() {
        return Ok(json!({
            "success": false,
            "ready": false,
            "reason": "config_missing",
            "message": "Game này chưa được cấu hình kích hoạt. Vui lòng liên hệ admin.",
        }));
    }

    let steam_path = match read_steam_path() {
        Some(p) => p,
        None => {
            return Ok(json!({
                "success": false,
                "ready": false,
                "reason": "no_steam",
                "message": "Không tìm thấy Steam trên máy. Vui lòng cài Steam trước.",
            }));
        }
    };

    let auto_path = PathBuf::from(&steam_path)
        .join("steamapps")
        .join("common")
        .join(&fix_folder_name);

    let manifest = appmanifest_path(&steam_path, &appid);
    let manifest_ok = manifest.is_file();

    if auto_path.is_dir() {
        // Dò đệ quy trong auto_path để tìm folder thật chứa exe + dll
        if let Some(real_folder) = find_game_folder_recursive(&auto_path, &fix_exe_name, &dll_name, 6) {
            if manifest_ok {
                return Ok(json!({
                    "success": true,
                    "ready": true,
                    "steam_path": steam_path,
                    "game_path": real_folder.to_string_lossy().to_string(),
                    "manifest_path": manifest.to_string_lossy().to_string(),
                }));
            }
        }
        // Folder tồn tại nhưng dò không ra hoặc thiếu manifest → cần user can thiệp
        return Ok(json!({
            "success": true,
            "ready": false,
            "reason": "missing_files",
            "steam_path": steam_path,
            "auto_path_tried": auto_path.to_string_lossy().to_string(),
            "manifest_ok": manifest_ok,
            "message": if !manifest_ok {
                format!("Tìm thấy folder game nhưng thiếu file appmanifest_{appid}.acf trong steamapps/. Vui lòng cài game này qua Steam trước.")
            } else {
                format!("Không tìm thấy file {fix_exe_name} + {dll_name} trong {}. Vui lòng chọn folder game đúng.", auto_path.to_string_lossy())
            },
        }));
    }

    // Folder không tồn tại → cần user chọn
    Ok(json!({
        "success": true,
        "ready": false,
        "reason": "folder_not_found",
        "steam_path": steam_path,
        "auto_path_tried": auto_path.to_string_lossy().to_string(),
        "manifest_ok": manifest_ok,
        "message": if !manifest_ok {
            format!("Không tìm thấy folder game. Vui lòng cài game qua Steam (cần file appmanifest_{appid}.acf trong steamapps/).")
        } else {
            "Không tìm thấy folder game ở đường dẫn mặc định. Vui lòng chọn folder cài đặt thực tế.".to_string()
        },
    }))
}

/// Verify lại folder do user chọn thủ công (sau khi precheck fail).
#[tauri::command]
pub async fn game_fix_verify_path(
    _state: State<'_, AppState>,
    appid: String,
    fix_exe_name: String,
    fix_dll_name: Option<String>,
    chosen_path: String,
) -> Result<Value, String> {
    let dll_name = fix_dll_name.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()).unwrap_or("steam_api64.dll").to_string();
    if chosen_path.trim().is_empty() {
        return Ok(json!({ "success": false, "message": "Đường dẫn rỗng" }));
    }
    let folder = PathBuf::from(&chosen_path);
    if !folder.is_dir() {
        return Ok(json!({ "success": false, "message": "Đường dẫn không phải thư mục" }));
    }

    // Dò đệ quy trong folder user chọn để tìm subfolder thật chứa exe + dll
    let real_folder = match find_game_folder_recursive(&folder, &fix_exe_name, &dll_name, 8) {
        Some(p) => p,
        None => {
            return Ok(json!({
                "success": false,
                "message": format!(
                    "Không tìm thấy file {fix_exe_name} và {dll_name} bên trong folder bạn chọn (đã quét đệ quy). Vui lòng chọn folder cài đặt gốc của game."
                ),
            }));
        }
    };

    // Tìm appmanifest:
    //   1. Suy ra Steam root từ chosen_path: leo lên 1-3 cấp parent để tìm folder
    //      có tên "Steam" hoặc chứa "steamapps". Cấu trúc chuẩn:
    //        <SteamRoot>\steamapps\common\<GameFolder>[\subdir...]
    //   2. Fallback: SteamPath đọc từ registry
    let manifest_filename = format!("appmanifest_{appid}.acf");

    let mut candidates: Vec<PathBuf> = Vec::new();

    // Leo lên parent chain từ real_folder lẫn chosen folder để tìm steamapps
    let mut probe: Option<&Path> = Some(&real_folder);
    let mut depth = 0;
    while let Some(p) = probe {
        // Nếu p là <root>\steamapps\common\... thì <root> chính là root cần tìm
        if p.file_name().and_then(|n| n.to_str()) == Some("common") {
            if let Some(steamapps) = p.parent() {
                candidates.push(steamapps.join(&manifest_filename));
            }
        }
        if p.file_name().and_then(|n| n.to_str()) == Some("steamapps") {
            candidates.push(p.join(&manifest_filename));
        }
        depth += 1;
        if depth > 8 { break; }
        probe = p.parent();
    }

    if let Some(reg_path) = read_steam_path() {
        candidates.push(PathBuf::from(&reg_path).join("steamapps").join(&manifest_filename));
    }

    let manifest_found: Option<PathBuf> = candidates.into_iter().find(|p| p.is_file());

    if manifest_found.is_none() {
        return Ok(json!({
            "success": false,
            "manifest_ok": false,
            "message": format!("Không tìm thấy file {} trong steamapps/. Game cần được cài qua Steam ít nhất một lần để có file appmanifest.", manifest_filename),
        }));
    }

    let steam_root_str = manifest_found
        .as_ref()
        .and_then(|m| m.parent())     // …\steamapps
        .and_then(|p| p.parent())     // …\<SteamRoot>
        .map(|p| p.to_string_lossy().to_string());

    Ok(json!({
        "success": true,
        "game_path": real_folder.to_string_lossy().to_string(),
        "steam_path": steam_root_str,
        "manifest_path": manifest_found.map(|p| p.to_string_lossy().to_string()),
        "manifest_ok": true,
    }))
}

/// Thực hiện Kích hoạt: tải zip → giải nén → set hidden+system → copy vào game folder.
/// game_path: folder game đã verify (truyền từ FE — kết quả của precheck/verify_path)
#[tauri::command]
pub async fn game_fix_activate(
    _state: State<'_, AppState>,
    appid: String,
    fix_zip_url: String,
    fix_exe_name: String,
    fix_dll_name: Option<String>,
    game_path: String,
) -> Result<Value, String> {
    let dll_name = fix_dll_name.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()).unwrap_or("steam_api64.dll").to_string();
    if fix_zip_url.trim().is_empty() {
        return Err("Thiếu URL file fix".into());
    }
    let game_folder_input = PathBuf::from(&game_path);
    if !game_folder_input.is_dir() {
        return Err("Folder game không hợp lệ".into());
    }

    // Dò đệ quy lần cuối — nếu game_path không có exe + dll trực tiếp,
    // tìm subfolder chứa cả 2 file. Đảm bảo file fix sẽ được copy đúng vào
    // folder thật (vd: ACC -> AC2\Binaries\Win64\)
    let direct_check = verify_game_folder(&game_folder_input, &fix_exe_name, &dll_name);
    let game_folder = if direct_check.has_exe && direct_check.has_steam_api {
        game_folder_input
    } else {
        match find_game_folder_recursive(&game_folder_input, &fix_exe_name, &dll_name, 8) {
            Some(p) => p,
            None => {
                return Err(format!(
                    "Không tìm thấy {fix_exe_name} + {dll_name} trong folder. Thiếu: {}",
                    direct_check.missing.join(", ")
                ));
            }
        }
    };

    // Tạo workspace temp riêng cho lần kích hoạt này
    let tmp_root = launcher_temp_dir();
    let _ = fs::remove_dir_all(&tmp_root); // cleanup từ lần trước
    fs::create_dir_all(&tmp_root).map_err(|e| format!("Không tạo được temp dir: {e}"))?;

    let archive_path = tmp_root.join(format!("fix_{appid}.archive"));
    let extract_dir = tmp_root.join(format!("extract_{appid}"));

    // 1. Download archive (zip hoặc rar)
    let kind = download_archive(&fix_zip_url, &archive_path).await?;

    // 2. Extract
    extract_archive(&archive_path, &extract_dir, kind)?;

    // 3. Set hidden+system attr trên tất cả file/folder vừa giải nén
    mark_hidden_recursive(&extract_dir);

    // 4. Merge vào folder game (preserve attributes)
    copy_dir_recursive(&extract_dir, &game_folder)?;

    // Đảm bảo file fix sau khi copy vào game folder cũng giữ thuộc tính ẩn.
    if let Ok(entries) = fs::read_dir(&extract_dir) {
        for entry in entries.flatten() {
            let rel = entry.file_name();
            let dest = game_folder.join(&rel);
            if dest.exists() {
                if dest.is_dir() {
                    mark_hidden_recursive(&dest);
                } else {
                    let _ = set_hidden_system_attr(&dest);
                }
            }
        }
    }

    // 5. Cleanup temp
    let _ = fs::remove_file(&archive_path);
    let _ = fs::remove_dir_all(&extract_dir);

    Ok(json!({
        "success": true,
        "game_path": game_folder.to_string_lossy().to_string(),
        "message": "Đã kích hoạt thành công. Bạn có thể chạy game qua Steam.",
    }))
}
