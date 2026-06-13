/// Steam API fetch - multi-source parallel (SteamSpy + Store API)
use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration;

const PRICE_MULTIPLIER: f64 = 0.35;
const USD_TO_VND: f64 = 25_500.0;
/// Giá trần: sau khi nhân 35% nếu vượt 229.000đ thì mặc định lấy 229.000đ
const PRICE_CAP_VND: i64 = 229_000;

fn make_client(timeout_secs: u64) -> Client {
    Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) nyvexa-launcher/2")
        .build()
        .unwrap_or_default()
}

async fn get_json(client: &Client, url: &str) -> Option<Value> {
    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() { return None; }
    resp.json().await.ok()
}

// ─── SteamSpy ────────────────────────────────────────────────────────────────
// Nhanh (~200ms), không bị region lock, không cần API key

async fn fetch_steamspy(appid: &str) -> Option<SteamData> {
    let client = make_client(6);
    let url = format!("https://steamspy.com/api.php?request=appdetails&appid={appid}");
    let v = get_json(&client, &url).await?;

    let name = v.get("name").and_then(|n| n.as_str())?.to_string();
    if name.is_empty() || name == "0" { return None; }

    let header_image = format!(
        "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg"
    );

    // SteamSpy price = cents USD
    let parse_cents = |key: &str| -> u64 {
        v.get(key).and_then(|p| {
            p.as_u64().or_else(|| p.as_str().and_then(|s| s.parse::<u64>().ok()))
        }).unwrap_or(0)
    };

    let price_cents = parse_cents("price");
    let initial_cents = parse_cents("initialprice").max(price_cents);
    let is_free = price_cents == 0;

    let price_vnd = if is_free { 0 } else {
        ((price_cents as f64 / 100.0) * USD_TO_VND).round() as i64
    };
    let original_price_vnd = if initial_cents > price_cents {
        ((initial_cents as f64 / 100.0) * USD_TO_VND).round() as i64
    } else { 0 };

    let developer = v.get("developer").and_then(|d| d.as_str()).filter(|s| !s.is_empty()).map(String::from);
    let publisher = v.get("publisher").and_then(|p| p.as_str()).filter(|s| !s.is_empty()).map(String::from);

    // SteamSpy: genre (string) + tags (object keys)
    let mut genres: Vec<String> = Vec::new();
    if let Some(genre_str) = v.get("genre").and_then(|g| g.as_str()) {
        genre_str.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).for_each(|s| genres.push(s.to_string()));
    }
    // Luôn bổ sung thêm các tag phổ biến nhất từ SteamSpy (nguồn thể loại phong phú)
    if let Some(tags) = v.get("tags").and_then(|t| t.as_object()) {
        tags.keys().take(8).for_each(|k| {
            if !genres.iter().any(|x| x.eq_ignore_ascii_case(k)) {
                genres.push(k.clone());
            }
        });
    }

    Some(SteamData {
        name, header_image, is_free, price_vnd, original_price_vnd,
        developer, publisher,
        drm_text: String::new(), categories: vec![], legal_notice: String::new(),
        genres,
        source: "steamspy",
    })
}

// ─── Steam Store API ─────────────────────────────────────────────────────────
// Thử US/GB/SG/TH song song (không thử VN vì hay bị region lock)

async fn fetch_store_api(appid: &str) -> Option<SteamData> {
    let ccs = ["us", "gb", "sg", "th", "vn"];
    let client = make_client(8);
    let aid = appid.to_string();

    let futs: Vec<_> = ccs.iter().map(|cc| {
        let url = format!(
            "https://store.steampowered.com/api/appdetails?appids={}&cc={}&l=english",
            appid, cc
        );
        let c = client.clone();
        let id = aid.clone();
        async move {
            let payload = get_json(&c, &url).await?;
            let data = payload.get(id.as_str())
                .or_else(|| payload.as_object().and_then(|m| m.values().next()))?;
            if data.get("success").and_then(|v| v.as_bool()) != Some(true) { return None; }
            let details = data.get("data")?.clone();
            details_to_steam_data(details, &id)
        }
    }).collect();

    futures::future::join_all(futs).await.into_iter().flatten().next()
}

/// Fallback nhẹ: chỉ lấy name + ảnh từ store API (không cần price_overview).
/// Dùng cho game coming-soon mà fetch_store_api trả None.
async fn fetch_store_api_minimal(appid: &str) -> Option<SteamData> {
    let ccs = ["us", "vn", "gb", "sg"];
    let client = make_client(8);
    let aid = appid.to_string();

    let futs: Vec<_> = ccs.iter().map(|cc| {
        let url = format!(
            "https://store.steampowered.com/api/appdetails?appids={}&cc={}&l=english&filters=basic",
            appid, cc
        );
        let c = client.clone();
        let id = aid.clone();
        async move {
            let payload = get_json(&c, &url).await?;
            let data = payload.get(id.as_str())
                .or_else(|| payload.as_object().and_then(|m| m.values().next()))?;
            if data.get("success").and_then(|v| v.as_bool()) != Some(true) { return None; }
            let details = data.get("data")?;
            let name = details.get("name").and_then(|v| v.as_str())?.to_string();
            if name.is_empty() { return None; }
            let header_image = details.get("header_image")
                .and_then(|v| v.as_str()).map(String::from)
                .unwrap_or_else(|| format!(
                    "https://cdn.cloudflare.steamstatic.com/steam/apps/{id}/header.jpg"
                ));
            let genres: Vec<String> = details.get("genres").and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|g| g.get("description").and_then(|v| v.as_str()).map(String::from)).collect())
                .unwrap_or_default();
            Some(SteamData {
                name, header_image, is_free: false, price_vnd: 0, original_price_vnd: 0,
                developer: details.get("developers").and_then(|v| v.as_array())
                    .and_then(|a| a.first()).and_then(|v| v.as_str()).map(String::from),
                publisher: details.get("publishers").and_then(|v| v.as_array())
                    .and_then(|a| a.first()).and_then(|v| v.as_str()).map(String::from),
                drm_text: String::new(), categories: vec![], legal_notice: String::new(),
                genres, source: "store_api_minimal",
            })
        }
    }).collect();

    futures::future::join_all(futs).await.into_iter().flatten().next()
}

fn details_to_steam_data(details: Value, appid: &str) -> Option<SteamData> {
    let name = details.get("name").and_then(|v| v.as_str())?.to_string();
    if name.is_empty() { return None; }

    let header_image = details.get("header_image")
        .and_then(|v| v.as_str()).map(String::from)
        .unwrap_or_else(|| format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg"
        ));

    let is_free = details.get("is_free").and_then(|v| v.as_bool()).unwrap_or(false);

    let (price_vnd, original_price_vnd) = if is_free {
        (0i64, 0i64)
    } else if let Some(po) = details.get("price_overview") {
        let final_c = po.get("final").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let initial_c = po.get("initial").and_then(|v| v.as_f64()).unwrap_or(final_c);
        let currency = po.get("currency").and_then(|v| v.as_str()).unwrap_or("USD");
        let rate = if currency == "VND" { 1.0 / 100.0 } else { USD_TO_VND / 100.0 };
        let pv = (final_c * rate).round() as i64;
        let ov = if initial_c > final_c { (initial_c * rate).round() as i64 } else { 0 };
        (pv, ov)
    } else {
        // Game preorder / chưa ra mắt (coming_soon) → chưa có price_overview.
        // Vẫn cho phép thêm với giá = 0 (admin sẽ tự set giá sau).
        (0i64, 0i64)
    };

    let categories: Vec<i64> = details.get("categories").and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|c| c.get("id").and_then(|v| v.as_i64())).collect())
        .unwrap_or_default();

    let legal_notice = details.get("legal_notice").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let drm_text = details.get("drm_notice").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let developer = details.get("developers").and_then(|v| v.as_array())
        .and_then(|a| a.first()).and_then(|v| v.as_str()).map(String::from);
    let publisher = details.get("publishers").and_then(|v| v.as_array())
        .and_then(|a| a.first()).and_then(|v| v.as_str()).map(String::from);

    // Genres từ Steam (description)
    let genres: Vec<String> = details.get("genres").and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|g| g.get("description").and_then(|v| v.as_str()).map(String::from)).collect())
        .unwrap_or_default();

    Some(SteamData {
        name, header_image, is_free, price_vnd, original_price_vnd,
        developer, publisher, drm_text, categories, legal_notice, genres,
        source: "store_api",
    })
}

// ─── Data ─────────────────────────────────────────────────────────────────────

struct SteamData {
    name: String,
    header_image: String,
    is_free: bool,
    price_vnd: i64,
    original_price_vnd: i64,
    developer: Option<String>,
    publisher: Option<String>,
    drm_text: String,
    categories: Vec<i64>,
    legal_notice: String,
    genres: Vec<String>,
    source: &'static str,
}

// ─── DRM ─────────────────────────────────────────────────────────────────────

fn detect_drm(data: &SteamData) -> Vec<String> {
    let mut drms: Vec<String> = Vec::new();
    let dev = data.developer.as_deref().unwrap_or("").to_lowercase();
    let pub_ = data.publisher.as_deref().unwrap_or("").to_lowercase();
    let scan = format!("{} {} {}", data.drm_text, data.legal_notice, dev).to_lowercase();
    let has_3p = data.categories.contains(&29);

    if has_3p && scan.contains("denuvo") { drms.push("Denuvo".into()); }
    if scan.contains("ubisoft") || dev.contains("ubisoft") || pub_.contains("ubisoft") { drms.push("Ubisoft Connect".into()); }
    if scan.contains("ea app") || scan.contains("origin") || pub_.contains("electronic arts") || pub_ == "ea games" { drms.push("EA App".into()); }
    if scan.contains("battle.net") || dev.contains("blizzard") || pub_.contains("blizzard") || pub_.contains("activision") { drms.push("Battle.net".into()); }
    if scan.contains("rockstar") || dev.contains("rockstar") || pub_.contains("rockstar") { drms.push("Rockstar Launcher".into()); }
    if scan.contains("bethesda") || dev.contains("bethesda") || pub_.contains("bethesda") { drms.push("Bethesda.net".into()); }
    if has_3p && drms.is_empty() { drms.push("Third-Party DRM".into()); }

    if !drms.is_empty() || !data.is_free { drms.insert(0, "Steam".into()); }

    let mut seen = std::collections::HashSet::new();
    drms.retain(|d| seen.insert(d.clone()));
    if drms.is_empty() { drms.push("Steam".into()); }
    drms
}

// ─── Entry point ─────────────────────────────────────────────────────────────

pub async fn fetch_steam_game_data(appid: &str) -> Result<Value, String> {
    // SteamSpy và Store API chạy song song
    let (spy_res, store_res) = tokio::join!(
        tokio::time::timeout(Duration::from_secs(7), fetch_steamspy(appid)),
        tokio::time::timeout(Duration::from_secs(10), fetch_store_api(appid)),
    );

    let spy = spy_res.ok().flatten();
    let store = store_res.ok().flatten();

    let data = match (store, spy) {
        (Some(s), Some(spy_d)) => {
            // Store có giá → dùng store, gộp genres từ CẢ HAI nguồn (union)
            let mut merged = if s.price_vnd > 0 || s.is_free { s }
                else if spy_d.price_vnd > 0 || spy_d.is_free {
                    SteamData { price_vnd: spy_d.price_vnd, original_price_vnd: spy_d.original_price_vnd, ..s }
                } else { s };
            // Hợp nhất genres: giữ thứ tự store trước, thêm các genre mới từ spy
            for g in spy_d.genres.into_iter() {
                if !merged.genres.iter().any(|x| x.eq_ignore_ascii_case(&g)) {
                    merged.genres.push(g);
                }
            }
            merged
        }
        (Some(s), None) => s,
        (None, Some(spy_d)) => spy_d,
        (None, None) => {
            // Fallback cuối: game coming-soon/preorder không có price_overview.
            // Thử lấy name + ảnh tối thiểu từ store API.
            match tokio::time::timeout(Duration::from_secs(8), fetch_store_api_minimal(appid)).await.ok().flatten() {
                Some(m) => m,
                None => return Err(format!("Không tìm được thông tin cho AppID {appid}")),
            }
        }
    };

    let drm_list = detect_drm(&data);
    let drm_primary = drm_list.first().cloned().unwrap_or_else(|| "Steam".into());
    let drm_all = drm_list.join(", ");

    let launch_price = if data.is_free { 0 } else {
        let p = (data.price_vnd as f64 * PRICE_MULTIPLIER).round() as i64;
        p.min(PRICE_CAP_VND)
    };

    let genres_csv = data.genres.join(", ");

    Ok(json!({
        "name": data.name,
        "header_image": data.header_image,
        "drm": drm_primary,
        "drm_all": drm_all,
        "drm_list": drm_list,
        "price": launch_price,
        "steam_price_vnd": data.price_vnd,
        "original_price_vnd": data.original_price_vnd,
        "is_free": data.is_free,
        "genres": genres_csv,
        "source": data.source,
    }))
}

#[tauri::command]
pub async fn admin_fetch_steam_game(appid: String) -> Result<Value, String> {
    let id = appid.trim().to_string();
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err("AppID không hợp lệ".into());
    }
    fetch_steam_game_data(&id).await
}

/// Fetch FULL Steam app details cho trang Game Detail.
/// Trả về raw `data` object từ Steam API (đã chọn CC có data).
#[tauri::command]
pub async fn fetch_steam_app_full(appid: String) -> Result<Value, String> {
    let id = appid.trim().to_string();
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err("AppID không hợp lệ".into());
    }

    // Thử nhiều CC + ngôn ngữ tiếng Anh, song song
    let ccs = ["us", "sg", "th", "gb", "vn"];
    let client = make_client(10);

    let futs: Vec<_> = ccs.iter().map(|cc| {
        let url = format!(
            "https://store.steampowered.com/api/appdetails?appids={}&cc={}&l=english",
            id, cc
        );
        let c = client.clone();
        let aid = id.clone();
        async move {
            let payload = get_json(&c, &url).await?;
            let data = payload.get(aid.as_str())
                .or_else(|| payload.as_object().and_then(|m| m.values().next()))?;
            if data.get("success").and_then(|v| v.as_bool()) != Some(true) { return None; }
            data.get("data").cloned()
        }
    }).collect();

    let results = futures::future::join_all(futs).await;

    // Ưu tiên kết quả có price_overview, fallback bất kỳ kết quả nào
    let mut fallback: Option<Value> = None;
    for r in results.into_iter().flatten() {
        if r.get("price_overview").is_some() {
            return Ok(r);
        }
        if fallback.is_none() {
            fallback = Some(r);
        }
    }

    fallback.ok_or_else(|| format!("Không tải được thông tin cho AppID {id}"))
}

// ─── Steam icon hash (ICommunityService/GetApps) ─────────────────────────────

/// Lấy icon_hash của app từ ICommunityService/GetApps để dựng URL icon thư viện.
/// Trả về { appid, icon_hash, icon_url } hoặc lỗi.
#[tauri::command]
pub async fn steam_get_app_icon(appid: String) -> Result<Value, String> {
    let id = appid.trim().to_string();
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err("AppID không hợp lệ".into());
    }
    let client = make_client(8);
    let url = format!(
        "https://api.steampowered.com/ICommunityService/GetApps/v1/?appids[0]={id}"
    );
    let payload = get_json(&client, &url).await
        .ok_or_else(|| format!("Không tải được icon cho AppID {id}"))?;

    // Cấu trúc: { response: { apps: [ { appid, name, icon, ... } ] } }
    let apps = payload
        .get("response")
        .and_then(|r| r.get("apps"))
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();

    let app = apps.into_iter().next()
        .ok_or_else(|| format!("Không có dữ liệu icon cho AppID {id}"))?;

    let icon_hash = app.get("icon").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if icon_hash.is_empty() {
        return Err(format!("AppID {id} không có icon_hash"));
    }

    let icon_url = format!(
        "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/{id}/{icon_hash}.jpg"
    );

    Ok(json!({
        "appid": id,
        "icon_hash": icon_hash,
        "icon_url": icon_url,
    }))
}

/// Batch fetch tên + icon cho nhiều appids cùng lúc (tối đa 100/lần do giới hạn URL).
/// Dùng cho DLC list để tránh rate limit khi có hàng trăm DLCs.
/// Trả về: { success: bool, apps: [ { appid, name, icon_url } ] }
#[tauri::command]
pub async fn steam_get_apps_batch(appids: Vec<String>) -> Result<Value, String> {
    if appids.is_empty() {
        return Ok(json!({ "success": true, "apps": [] }));
    }

    // Validate appids
    let valid_ids: Vec<String> = appids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()))
        .collect();

    if valid_ids.is_empty() {
        return Ok(json!({ "success": true, "apps": [] }));
    }

    // ICommunityService/GetApps chấp nhận nhiều appids qua query params: appids[0]=xxx&appids[1]=yyy
    // Giới hạn 100 appids/request để tránh URL quá dài
    const BATCH_SIZE: usize = 100;
    let client = make_client(10);
    let mut all_results: Vec<Value> = Vec::new();

    for chunk in valid_ids.chunks(BATCH_SIZE) {
        let params: Vec<String> = chunk
            .iter()
            .enumerate()
            .map(|(i, id)| format!("appids[{i}]={id}"))
            .collect();
        let url = format!(
            "https://api.steampowered.com/ICommunityService/GetApps/v1/?{}",
            params.join("&")
        );

        match get_json(&client, &url).await {
            Some(payload) => {
                let apps = payload
                    .get("response")
                    .and_then(|r| r.get("apps"))
                    .and_then(|a| a.as_array())
                    .cloned()
                    .unwrap_or_default();

                for app in apps {
                    let appid = app.get("appid")
                        .and_then(|v| v.as_u64().map(|n| n.to_string()))
                        .unwrap_or_default();
                    let name = app.get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let icon_hash = app.get("icon")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let icon_url = if !icon_hash.is_empty() {
                        format!(
                            "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/{appid}/{icon_hash}.jpg"
                        )
                    } else {
                        String::new()
                    };

                    let header_image = format!(
                        "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg"
                    );

                    all_results.push(json!({
                        "appid": appid,
                        "name": name,
                        "icon_url": icon_url,
                        "header_image": header_image,
                    }));
                }
            }
            None => {
                // API call failed for this chunk — skip
                continue;
            }
        }
    }

    Ok(json!({
        "success": true,
        "apps": all_results,
    }))
}
