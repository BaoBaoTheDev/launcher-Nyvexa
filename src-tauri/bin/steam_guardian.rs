//! Nyvexa Steam Guardian - Helper Process
//! 
//! Monitors the Steam registry for ActiveUser changes and ensures
//! the logged-in Steam account matches the linked account in the database.
//!
//! Usage: steam_guardian.exe <pipe_name> <data_dir>
//!
//! Communication protocol:
//! - Reads commands from stdin (JSON lines)
//! - Writes status updates to stdout (JSON lines)
//! - IPC file: <data_dir>/steam_guardian_status.json

#![windows_subsystem = "windows"]

use std::os::windows::process::CommandExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use std::io::{BufRead, BufReader, Write};
use std::process;
use std::process::Command;
use winreg::enums::*;
use winreg::RegKey;

const STEAM_REGISTRY_PATH: &str = r"SOFTWARE\Valve\Steam\ActiveProcess";
const STEAM_STEAMID_OFFSET: u64 = 76561197960265728;

/// Steam account info derived from registry
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SteamAccountInfo {
    pub active_user: Option<u32>,
    pub steam_id: Option<u64>,
    pub persona_name: Option<String>,
    pub avatar_url: Option<String>,
    pub is_logged_in: bool,
}

/// Status file written for IPC with main app
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuardianStatus {
    pub running: bool,
    pub linked_steam_id: Option<u64>,
    pub current_steam_id: Option<u64>,
    pub is_mismatch: bool,
    pub last_error: Option<String>,
    pub last_update: String,
}

impl Default for GuardianStatus {
    fn default() -> Self {
        Self {
            running: true,
            linked_steam_id: None,
            current_steam_id: None,
            is_mismatch: false,
            last_error: None,
            last_update: chrono_now(),
        }
    }
}

fn chrono_now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Read ActiveUser from Steam registry
fn read_active_user_from_registry() -> Option<u32> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    
    match hkcu.open_subkey(STEAM_REGISTRY_PATH) {
        Ok(key) => {
            match key.get_value::<u32, _>("ActiveUser") {
                Ok(val) => Some(val),
                Err(_) => None,
            }
        }
        Err(_) => None,
    }
}

/// Calculate SteamID from Steam3 format (ActiveUser)
fn calculate_steam_id(active_user: u32) -> u64 {
    if active_user == 0 {
        0
    } else {
        u64::from(active_user) + STEAM_STEAMID_OFFSET
    }
}

/// Fetch Steam profile data from Steam Community API
#[allow(dead_code)]
async fn fetch_steam_profile(steam_id: u64) -> Result<SteamAccountInfo, String> {
    let url = format!("https://steamcommunity.com/profiles/{}/?xml=1", steam_id);
    
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    let body = response.text().await.map_err(|e| e.to_string())?;
    
    // Parse basic XML fields manually
    let persona_name = extract_xml_value(&body, "steamID");
    let avatar_small = extract_xml_value(&body, "avatarMedium");
    
    Ok(SteamAccountInfo {
        active_user: None,
        steam_id: Some(steam_id),
        persona_name,
        avatar_url: avatar_small,
        is_logged_in: true,
    })
}

fn extract_xml_value(xml: &str, tag: &str) -> Option<String> {
    let open_tag = format!("<{}>", tag);
    let close_tag = format!("</{}>", tag);
    
    if let Some(start) = xml.find(&open_tag) {
        let content_start = start + open_tag.len();
        if let Some(end) = xml[content_start..].find(&close_tag) {
            return Some(xml[content_start..content_start + end].trim().to_string());
        }
    }
    None
}

/// Force restart Steam by killing and restarting
#[allow(dead_code)]
fn force_restart_steam(steam_path: &str) -> Result<(), String> {
    // Kill all steam processes
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "steam.exe"])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output();
    
    // Wait for process to terminate
    std::thread::sleep(Duration::from_secs(2));
    
    // Delete the DLL files that our launcher created
    let steam_path = PathBuf::from(steam_path);
    for dll_file in ["xinput1_4.dll", "dwmapi.dll"] {
        let dll_path = steam_path.join(dll_file);
        if dll_path.exists() {
            let _ = remove_file_attributes(&dll_path);
            let _ = fs::remove_file(&dll_path);
        }
    }
    
    // Restart Steam
    let steam_exe = steam_path.join("Steam.exe");
    if !steam_exe.exists() {
        return Err("Steam.exe not found".to_string());
    }
    
    let _ = Command::new(&steam_exe)
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[cfg(windows)]
fn remove_file_attributes(path: &PathBuf) -> Result<(), String> {
    let _ = Command::new("attrib")
        .args(["-H", "-S", &path.to_string_lossy()])
        .creation_flags(0x08000000)
        .output();
    Ok(())
}

#[cfg(not(windows))]
#[allow(clippy::unnecessary_wraps)]
fn remove_file_attributes(_path: &PathBuf) -> Result<(), String> {
    Ok(())
}

/// Write status to IPC file
fn write_status_file(data_dir: &PathBuf, status: &GuardianStatus) {
    let status_file = data_dir.join("steam_guardian_status.json");
    
    if let Ok(json) = serde_json::to_string_pretty(status) {
        let _ = fs::write(&status_file, json);
    }
}

/// Main monitoring loop
fn run_guardian_loop(
    data_dir: PathBuf,
    linked_steam_id: Option<u64>,
    running: Arc<AtomicBool>,
) {
    let mut last_known_user: Option<u32> = None;
    
    while running.load(Ordering::SeqCst) {
        let active_user = read_active_user_from_registry();
        let current_steam_id = active_user.filter(|&u| u != 0).map(calculate_steam_id);
        
        // Check for mismatch if we have a linked account
        let is_mismatch = if let Some(linked) = linked_steam_id {
            if let Some(current) = current_steam_id {
                linked != current
            } else {
                // User logged out
                true
            }
        } else {
            false
        };
        
        // Update status file
        let status = GuardianStatus {
            running: true,
            linked_steam_id,
            current_steam_id,
            is_mismatch,
            last_error: None,
            last_update: chrono_now(),
        };
        
        write_status_file(&data_dir, &status);
        
        // If user logged in (changed from 0 to non-0) or changed account
        if let Some(user) = active_user {
            if user != 0 {
                if last_known_user != Some(user) {
                    // User changed - output to stdout for main app to pick up
                    let steam_id = calculate_steam_id(user);
                    let output = json!({
                        "event": "steam_user_changed",
                        "active_user": user,
                        "steam_id": steam_id,
                        "timestamp": chrono_now()
                    });
                    println!("{}", output.to_string());
                    let _ = std::io::stdout().flush();
                }
            } else if last_known_user != Some(0) && last_known_user.is_some() {
                // User logged out
                let output = json!({
                    "event": "steam_user_logged_out",
                    "timestamp": chrono_now()
                });
                println!("{}", output.to_string());
                let _ = std::io::stdout().flush();
            }
            
            last_known_user = Some(user);
        } else {
            last_known_user = None;
        }
        
        // Sleep before next check
        std::thread::sleep(Duration::from_secs(5));
    }
    
    // Write final status
    let final_status = GuardianStatus {
        running: false,
        linked_steam_id,
        current_steam_id: None,
        is_mismatch: false,
        last_error: None,
        last_update: chrono_now(),
    };
    write_status_file(&data_dir, &final_status);
}

/// Handle incoming commands from stdin
#[allow(dead_code)]
fn handle_command(
    cmd: &str,
    running: &Arc<AtomicBool>,
    linked_steam_id: &mut Option<u64>,
    data_dir: &PathBuf,
) -> Option<String> {
    #[derive(Deserialize)]
    #[serde(tag = "type")]
    enum Command {
        #[serde(rename = "start")]
        Start { linked_steam_id: Option<u64> },
        #[serde(rename = "stop")]
        Stop,
        #[serde(rename = "update_linked")]
        UpdateLinked { steam_id: u64 },
        #[serde(rename = "get_status")]
        GetStatus,
        #[serde(rename = "force_restart_steam")]
        ForceRestartSteam { steam_path: String },
        #[serde(rename = "check_now")]
        CheckNow,
    }
    
    if let Ok(cmd) = serde_json::from_str::<Command>(cmd) {
        match cmd {
            Command::Start { linked_steam_id: new_linked } => {
                *linked_steam_id = new_linked;
                running.store(true, Ordering::SeqCst);
                Some(json!({
                    "success": true,
                    "message": "Guardian started",
                    "linked_steam_id": *linked_steam_id
                }).to_string())
            }
            Command::Stop => {
                running.store(false, Ordering::SeqCst);
                Some(json!({
                    "success": true,
                    "message": "Guardian stopped"
                }).to_string())
            }
            Command::UpdateLinked { steam_id } => {
                *linked_steam_id = Some(steam_id);
                Some(json!({
                    "success": true,
                    "message": "Linked Steam ID updated",
                    "linked_steam_id": steam_id
                }).to_string())
            }
            Command::GetStatus => {
                let status_file = data_dir.join("steam_guardian_status.json");
                if let Ok(content) = fs::read_to_string(&status_file) {
                    if let Ok(status) = serde_json::from_str::<GuardianStatus>(&content) {
                        return Some(json!({
                            "success": true,
                            "status": status
                        }).to_string());
                    }
                }
                Some(json!({
                    "success": true,
                    "status": GuardianStatus::default()
                }).to_string())
            }
            Command::ForceRestartSteam { steam_path } => {
                match force_restart_steam(&steam_path) {
                    Ok(_) => Some(json!({
                        "success": true,
                        "message": "Steam restarted and files cleaned"
                    }).to_string()),
                    Err(e) => Some(json!({
                        "success": false,
                        "error": e
                    }).to_string()),
                }
            }
            Command::CheckNow => {
                let active_user = read_active_user_from_registry();
                let steam_id = active_user.filter(|&u| u != 0).map(calculate_steam_id);
                Some(json!({
                    "success": true,
                    "active_user": active_user,
                    "steam_id": steam_id,
                    "is_mismatch": linked_steam_id.map(|l| {
                        steam_id.map(|s| l != s).unwrap_or(true)
                    }).unwrap_or(false)
                }).to_string())
            }
        }
    } else {
        Some(json!({
            "success": false,
            "error": "Invalid command format"
        }).to_string())
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    
    if args.len() < 2 {
        eprintln!(
            "{}",
            serde_json::to_string(&json!({
                "error": "Usage: steam_guardian.exe <data_dir>"
            }))
            .unwrap_or_default()
        );
        process::exit(1);
    }
    
    let data_dir = PathBuf::from(&args[1]);
    
    // Ensure data directory exists
    if let Err(e) = fs::create_dir_all(&data_dir) {
        eprintln!("Failed to create data directory: {}", e);
        process::exit(1);
    }
    
    let running = Arc::new(AtomicBool::new(false));
    let linked_steam_id: std::sync::Mutex<Option<u64>> = std::sync::Mutex::new(None);
    
    // Read from stdin line by line
    let stdin = std::io::stdin();
    let reader = BufReader::new(stdin.lock());
    
    for line in reader.lines().map_while(Result::ok) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        
        // Check if we need to start the guardian loop
        if let Ok(cmd) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(cmd_type) = cmd.get("type").and_then(|v| v.as_str()) {
                match cmd_type {
                    "start" => {
                        let new_linked = cmd.get("linked_steam_id")
                            .and_then(|v| v.as_u64());
                        
                        {
                            let mut linked = linked_steam_id.lock().unwrap();
                            *linked = new_linked;
                        }
                        
                        running.store(true, Ordering::SeqCst);
                        
                        // Spawn the monitoring loop in a separate thread
                        let running_clone = running.clone();
                        let data_dir_clone = data_dir.clone();
                        let linked_clone = {
                            let linked = linked_steam_id.lock().unwrap();
                            *linked
                        };
                        
                        std::thread::spawn(move || {
                            run_guardian_loop(data_dir_clone, linked_clone, running_clone);
                        });
                        
                        let output = json!({
                            "success": true,
                            "event": "guardian_started",
                            "linked_steam_id": linked_clone
                        });
                        println!("{}", output.to_string());
                        let _ = std::io::stdout().flush();
                    }
                    "stop" => {
                        running.store(false, Ordering::SeqCst);
                        let output = json!({
                            "success": true,
                            "event": "guardian_stopped"
                        });
                        println!("{}", output.to_string());
                        let _ = std::io::stdout().flush();
                    }
                    _ => {
                        // Handle other commands
                        let mut linked = linked_steam_id.lock().unwrap();
                        let result = handle_command(
                            &line,
                            &running,
                            &mut linked,
                            &data_dir,
                        );
                        
                        if let Some(response) = result {
                            println!("{}", response);
                            let _ = std::io::stdout().flush();
                        }
                    }
                }
            }
        }
    }
}
