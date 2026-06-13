import { useCallback, useEffect, useRef, useState } from "react";
import { tauriAPI, UserProfile, GameItem, DlcItem, StoreAsset, AdminAnalytics, HubcapKey, HubcapKeyStats } from "../../lib/tauri-api";
import { steamAppAssetUrl, DEFAULT_STEAM_BACKGROUND_URL } from "../../lib/runtimeUrls";
import { formatMoney } from "../../lib/utils";
import "../../styles/admin.css";
import { BalanceLogDetailBody } from "../../components/BalanceLogDetailBody";

// ─── Types ──────────────────────────────────────────────────────────────────

type AdminTab = "analytics" | "games" | "dlcs" | "users" | "store" | "settings" | "sale" | "hubcap" | "discounts" | "avatars" | "balance_logs" | "referral";

interface SteamFetchResult {
  name: string;
  header_image: string;
  drm: string;
  drm_all?: string;
  drm_list?: string[];
  price: number;
  steam_price_vnd?: number;
  is_free: boolean;
  genres?: string;
}

const ALL_DRMS = ["Steam", "Epic Games", "GOG", "Ubisoft Connect", "EA App", "Battle.net", "Rockstar Launcher", "Bethesda.net", "Denuvo", "Third-Party DRM", "Other"];

// Multi-DRM selector — hiện tags, click để toggle
function DrmMultiSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const selected = new Set(value.split(",").map(s => s.trim()).filter(Boolean));
  const toggle = (drm: string) => {
    const next = new Set(selected);
    next.has(drm) ? next.delete(drm) : next.add(drm);
    onChange(Array.from(next).join(", "));
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 220 }}>
      {ALL_DRMS.map(d => (
        <button
          key={d}
          type="button"
          onClick={() => toggle(d)}
          style={{
            padding: "2px 7px", borderRadius: 4, fontSize: 11, cursor: "pointer",
            fontFamily: "inherit", border: "1px solid",
            background: selected.has(d) ? "rgba(102,192,244,0.2)" : "transparent",
            borderColor: selected.has(d) ? "rgba(102,192,244,0.6)" : "rgba(255,255,255,0.15)",
            color: selected.has(d) ? "#66c0f4" : "#8f98a0",
            fontWeight: selected.has(d) ? 700 : 400,
          }}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

// ─── Analytics Tab ───────────────────────────────────────────────────────────
function AnalyticsTab() {
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsV2, setAnalyticsV2] = useState<{ revenue_this_month: number; revenue_total: number; total_referral_earned: number; deposit_count_this_month: number } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setData(await tauriAPI.adminApi.getAnalytics()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    tauriAPI.adminApi.getAnalyticsV2().then(res => {
      if (res.success) setAnalyticsV2(res);
    }).catch(() => {});
  }, []);

  if (loading) return <div className="admin-empty">Đang tải...</div>;
  const d = data?.data;
  if (!d) return <div className="admin-empty">Không có dữ liệu</div>;

  return (
    <div>
      <div className="admin-stats-grid">
        <div className="admin-stat-card"><div className="admin-stat-label">Tổng người dùng</div><div className="admin-stat-value blue">{d.total_users}</div></div>
        <div className="admin-stat-card"><div className="admin-stat-label">Bị ban</div><div className="admin-stat-value red">{d.banned_users}</div></div>
        <div className="admin-stat-card"><div className="admin-stat-label">Tổng game</div><div className="admin-stat-value green">{d.total_games}</div></div>
      </div>
      <div className="admin-section">
        <div className="admin-section-title">Top game được mua nhiều nhất</div>
        {d.top_games.length === 0 ? <div className="admin-empty">Chưa có dữ liệu</div> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>#</th><th>Tên game</th><th>AppID</th><th>Lượt mua</th></tr></thead>
              <tbody>
                {d.top_games.map((g, i) => (
                  <tr key={g.id}>
                    <td style={{ color: "#8f98a0" }}>{i + 1}</td>
                    <td style={{ color: "#fff", fontWeight: 600 }}>{g.name || `Game ${g.appid}`}</td>
                    <td style={{ fontFamily: "monospace", color: "#66c0f4" }}>{g.appid}</td>
                    <td style={{ color: "#a4d007", fontWeight: 700 }}>{g.purchase_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {analyticsV2 && (
        <div className="admin-section" style={{ marginTop: 16 }}>
          <div className="admin-section-title">💰 Doanh thu & Hoa hồng</div>
          <div className="admin-stats-grid">
            <div className="admin-stat-card">
              <div className="admin-stat-label">Doanh thu tháng này</div>
              <div className="admin-stat-value green">{formatMoney(analyticsV2.revenue_this_month)}</div>
              <div style={{ fontSize: 11, color: "#8f98a0", marginTop: 4 }}>{analyticsV2.deposit_count_this_month} lượt nạp</div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-label">Tổng doanh thu</div>
              <div className="admin-stat-value blue">{formatMoney(analyticsV2.revenue_total)}</div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-label">Tổng hoa hồng giới thiệu</div>
              <div className="admin-stat-value" style={{ color: "#a4d007" }}>{formatMoney(analyticsV2.total_referral_earned)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add Single Game Modal ───────────────────────────────────────────────────

interface AddGameModalProps { allGames: GameItem[]; onClose: () => void; onSaved: () => void; }

function AddGameModal({ allGames, onClose, onSaved }: AddGameModalProps) {
  const [appid, setAppid] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetched, setFetched] = useState<SteamFetchResult | null>(null);
  const [price, setPrice] = useState("");
  const [drm, setDrm] = useState("Steam");
  const [baseAppid, setBaseAppid] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-fetch khi AppID hợp lệ, debounce 600ms
  const triggerFetch = useCallback(async (id: string) => {
    const clean = id.trim();
    if (!clean || !/^\d+$/.test(clean)) {
      setFetched(null); setError(""); return;
    }
    if (allGames.some(g => String(g.appid) === clean)) {
      setFetched(null); setError("Game này đã tồn tại trong store."); return;
    }
    setFetching(true); setError(""); setFetched(null);
    try {
      const res = await tauriAPI.adminApi.fetchSteamGame(clean);
      setFetched(res);
      setPrice(String(res.price));
      // Dùng drm_all nếu có (nhiều DRM), fallback về drm đơn
      setDrm(res.drm_all || res.drm || "Steam");
    } catch (e) {
      setError(typeof e === "string" ? e : "Không fetch được dữ liệu Steam.");
    } finally {
      setFetching(false);
    }
  }, [allGames]);

  const handleAppidChange = (val: string) => {
    setAppid(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => triggerFetch(val), 600);
  };

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const handleSave = async () => {
    if (!fetched) { setError("Chờ fetch xong hoặc kiểm tra AppID."); return; }
    setSaving(true); setError("");
    try {
      await tauriAPI.adminApi.gamesAdd({
        appid: appid.trim(),
        name: fetched.name,
        price: Number(price) || 0,
        drm: drm || "Steam",
        header_image: fetched.header_image,
        genres: fetched.genres || undefined,
        base_appid: baseAppid.trim() || undefined,
      });
      // Thông báo Discord (chỉ cho game gốc, không phải DLC)
      if (!baseAppid.trim()) {
        tauriAPI.adminApi.discordNotifyNewGame({
          gameName: fetched.name,
          appid: appid.trim(),
          price: Number(price) || 0,
          headerImage: fetched.header_image,
        }).catch(() => {});
      }
      onSaved(); onClose();
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error)?.message ?? "Lỗi lưu game");
    } finally { setSaving(false); }
  };

  const isReady = !!fetched && !fetching && !error;

  return (
    <div className="admin-modal-overlay" onClick={ev => ev.target === ev.currentTarget && onClose()}>
      <div className="admin-modal" style={{ width: "min(520px, 100%)" }}>
        <div className="admin-modal-head">
          <span className="admin-modal-title">Thêm game từ Steam</span>
          <button className="admin-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="admin-modal-body">
          {/* AppID input — auto-fetch */}
          <div className="admin-field" style={{ marginBottom: 16 }}>
            <label>Steam AppID</label>
            <input
              className="admin-input"
              placeholder="Nhập AppID rồi chờ tự động tìm..."
              value={appid}
              onChange={e => handleAppidChange(e.target.value)}
              autoFocus
              style={{ fontSize: 16 }}
            />
          </div>

          {/* States */}
          {fetching && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 0", color: "#66c0f4" }}>
              <div style={{ width: 18, height: 18, border: "2px solid #66c0f4", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
              Đang tìm kiếm trên Steam...
            </div>
          )}

          {error && !fetching && (
            <div className="auth-error" style={{ margin: "0 0 12px" }}>{error}</div>
          )}

          {/* Preview card */}
          {fetched && !fetching && (
            <div style={{
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid rgba(102,192,244,0.25)",
              background: "rgba(22,27,34,0.9)",
              marginBottom: 16,
            }}>
              {/* Hero image */}
              <div style={{ position: "relative", width: "100%", aspectRatio: "460/215", background: "#000" }}>
                <img
                  src={fetched.header_image}
                  alt={fetched.name}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  onError={e => { (e.target as HTMLImageElement).src = DEFAULT_STEAM_BACKGROUND_URL; }}
                />
                {/* DRM badge */}
                <div style={{
                  position: "absolute", top: 8, right: 8,
                  background: "rgba(0,0,0,0.75)", color: "#66c0f4",
                  fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                  border: "1px solid rgba(102,192,244,0.35)"
                }}>
                  {fetched.drm}
                </div>
              </div>

              {/* Info */}
              <div style={{ padding: "14px 16px" }}>
                <div style={{ color: "#fff", fontWeight: 700, fontSize: 17, marginBottom: 10 }}>
                  {fetched.name}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10 }}>
                  <div>
                    {fetched.is_free ? (
                      <div style={{ color: "#a4d007", fontWeight: 700, fontSize: 20 }}>Miễn phí</div>
                    ) : (
                      <>
                        <div style={{ color: "#8f98a0", fontSize: 11, marginBottom: 3 }}>
                          Steam VND: {formatMoney(fetched.steam_price_vnd ?? 0)}
                        </div>
                        <div style={{ color: "#fff", fontSize: 13, marginBottom: 2 }}>
                          Giá bán (× 0.35):
                        </div>
                        <input
                          className="admin-input"
                          type="number"
                          min={0}
                          value={price}
                          onChange={e => setPrice(e.target.value)}
                          style={{ width: 140, fontSize: 18, fontWeight: 700, color: "#66c0f4", textAlign: "right" }}
                        />
                        <span style={{ color: "#8f98a0", fontSize: 12, marginLeft: 6 }}>₫</span>
                      </>
                    )}
                  </div>
                  <div>
                    <div style={{ color: "#8f98a0", fontSize: 11, marginBottom: 4 }}>DRM (tự động detect)</div>
                    {fetched.drm_list && fetched.drm_list.length > 1 ? (
                      // Nhiều DRM — hiện tags
                      <div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
                          {fetched.drm_list.map(d => (
                            <span key={d} style={{
                              background: "rgba(102,192,244,0.15)", border: "1px solid rgba(102,192,244,0.3)",
                              color: "#66c0f4", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4
                            }}>{d}</span>
                          ))}
                        </div>
                        <input
                          className="admin-input"
                          value={drm}
                          onChange={e => setDrm(e.target.value)}
                          style={{ fontSize: 12, width: "100%" }}
                          title="Có thể chỉnh lại giá trị lưu vào DB"
                        />
                      </div>
                    ) : (
                      // 1 DRM — select
                      <select
                        className="admin-select"
                        value={drm}
                        onChange={e => setDrm(e.target.value)}
                        style={{ fontSize: 13 }}
                      >
                        {["Steam","Ubisoft Connect","EA App","Battle.net","Rockstar Launcher","Epic Games","Bethesda.net","Denuvo","Third-Party DRM","GOG Galaxy","Other"].map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Empty hint */}
          {!appid && !fetching && !fetched && (
            <div style={{ textAlign: "center", padding: "20px 0", color: "#8f98a0", fontSize: 13 }}>
              Nhập AppID Steam (ví dụ: <span style={{ color: "#66c0f4" }}>570</span> = Dota 2)
            </div>
          )}

          {/* Base AppID — điền nếu đây là DLC */}
          <div className="admin-field" style={{ marginTop: 12 }}>
            <label>Base AppID — nếu đây là DLC (để trống nếu là game gốc)</label>
            <input
              className="admin-input"
              placeholder="VD: 570 (DLC của Dota 2)"
              value={baseAppid}
              onChange={e => setBaseAppid(e.target.value.replace(/[^\d]/g, ""))}
            />
          </div>
        </div>

        <div className="admin-modal-foot">
          <button className="admin-btn" onClick={onClose}>Hủy</button>
          <button
            className="admin-btn primary"
            onClick={handleSave}
            disabled={saving || !isReady}
            style={{ minWidth: 120 }}
          >
            {saving ? "Đang lưu..." : isReady ? `Thêm "${fetched?.name?.slice(0, 20)}${(fetched?.name?.length ?? 0) > 20 ? "..." : ""}"` : "Thêm game"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bulk Add Modal ──────────────────────────────────────────────────────────

interface BulkAddModalProps { allGames: GameItem[]; onClose: () => void; onSaved: () => void; }

interface BulkResult {
  appid: string;
  name: string;
  price: number;
  drm: string;
  drm_list: string[];
  genres: string;
  header_image: string;
  status: "ready" | "error" | "duplicate";
  error?: string;
  editPrice: string;
  editDrm: string; // comma-separated final DRM string
}

function BulkAddModal({ allGames, onClose, onSaved }: BulkAddModalProps) {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<"input" | "processing" | "review">("input");
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [results, setResults] = useState<BulkResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [bulkSearch, setBulkSearch] = useState("");
  const cancelRef = useRef(false);

  const existingAppids = new Set(allGames.map(g => String(g.appid)));

  const handleProcess = async () => {
    const lines = input.split(/\n/).map(l => l.trim()).filter(l => /^\d+$/.test(l));
    if (lines.length === 0) return;

    const unique = Array.from(new Set(lines));
    setPhase("processing");
    cancelRef.current = false;
    setBulkSearch("");
    setProgress({ done: 0, total: unique.length, current: "" });
    const collected: BulkResult[] = [];

    for (let i = 0; i < unique.length; i++) {
      if (cancelRef.current) break;
      const appid = unique[i];
      setProgress({ done: i + 1, total: unique.length, current: appid });

      if (existingAppids.has(appid)) {
        collected.push({ appid, name: "", price: 0, drm: "Steam", drm_list: ["Steam"], genres: "", header_image: "", status: "duplicate", editPrice: "0", editDrm: "Steam" });
        continue;
      }

      try {
        const res = await tauriAPI.adminApi.fetchSteamGame(appid);
        collected.push({
          appid, name: res.name, price: res.price,
          drm: res.drm || "Steam",
          drm_list: res.drm_list ?? [res.drm || "Steam"],
          genres: res.genres || "",
          header_image: res.header_image,
          status: "ready",
          editPrice: String(res.price),
          editDrm: res.drm_all || res.drm || "Steam",
        });
      } catch (e) {
        const reason = typeof e === "string" ? e : (e as Error)?.message ?? "Lỗi fetch";
        collected.push({ appid, name: "", price: 0, drm: "Steam", drm_list: [], genres: "", header_image: "", status: "error", error: reason, editPrice: "0", editDrm: "Steam" });
      }
    }
    setResults(collected);
    setPhase("review");
  };

  // Game không có giá (price=0 và không free) lên đầu, rồi sort theo tên
  const readyItems = results
    .filter(r => r.status === "ready")
    .sort((a, b) => {
      const aNoPrice = Number(a.editPrice) === 0;
      const bNoPrice = Number(b.editPrice) === 0;
      if (aNoPrice && !bNoPrice) return -1;
      if (!aNoPrice && bNoPrice) return 1;
      return a.name.localeCompare(b.name);
    });

  const errorItems = results.filter(r => r.status === "error");
  const dupItems = results.filter(r => r.status === "duplicate");

  // Filter readyItems bằng searchbar
  const filteredReady = bulkSearch.trim()
    ? readyItems.filter(r =>
        r.name.toLowerCase().includes(bulkSearch.toLowerCase()) ||
        r.appid.includes(bulkSearch)
      )
    : readyItems;

  const handleSave = async () => {
    setSaving(true);
    let saved = 0;
    for (const r of readyItems) {
      try {
        await tauriAPI.adminApi.gamesAdd({
          appid: r.appid, name: r.name,
          price: Number(r.editPrice) || 0,
          drm: r.editDrm || "Steam",
          header_image: r.header_image,
          genres: r.genres || undefined,
        });
        // Thông báo Discord cho từng game mới
        tauriAPI.adminApi.discordNotifyNewGame({
          gameName: r.name,
          appid: r.appid,
          price: Number(r.editPrice) || 0,
          headerImage: r.header_image,
        }).catch(() => {});
        saved++;
      } catch (_) {}
    }
    setSaving(false);
    if (saved > 0) { onSaved(); onClose(); }
  };

  const updateResult = (appid: string, field: "editPrice" | "editDrm", val: string) => {
    setResults(prev => prev.map(r => r.appid === appid ? { ...r, [field]: val } : r));
  };

  return (
    <div className="admin-modal-overlay" onClick={ev => ev.target === ev.currentTarget && onClose()}>
      <div className="admin-modal" style={{ width: "min(780px, 100%)", maxHeight: "90vh" }}>
        <div className="admin-modal-head">
          <span className="admin-modal-title">Thêm hàng loạt game</span>
          <button className="admin-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="admin-modal-body" style={{ overflowY: "auto" }}>

          {phase === "input" && (
            <div className="admin-form-grid cols-1" style={{ gap: 12 }}>
              <div className="admin-field">
                <label>Nhập AppID — mỗi dòng 1 AppID</label>
                <textarea
                  className="admin-input"
                  style={{ minHeight: 180, resize: "vertical", fontFamily: "monospace" }}
                  placeholder={"570\n730\n440\n252490"}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                />
              </div>
              <div style={{ fontSize: 12, color: "#8f98a0" }}>
                Game trùng hoặc lỗi sẽ bỏ qua. Bạn sẽ review trước khi lưu.
              </div>
            </div>
          )}

          {phase === "processing" && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 16 }}>⏳</div>
              <div style={{ color: "#fff", fontWeight: 700, marginBottom: 8 }}>
                Đang xử lý {progress.done} / {progress.total}
              </div>
              <div style={{ color: "#66c0f4", fontSize: 13 }}>AppID: {progress.current}</div>
              <div style={{ margin: "20px auto", maxWidth: 300, height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", background: "var(--accent-blue)", width: `${(progress.done / progress.total) * 100}%`, transition: "width 0.2s" }} />
              </div>
              <button className="admin-btn danger" onClick={() => { cancelRef.current = true; }}>Dừng</button>
            </div>
          )}

          {phase === "review" && (
            <div>
              {/* Summary */}
              <div className="admin-stats-grid" style={{ marginBottom: 16 }}>
                <div className="admin-stat-card"><div className="admin-stat-label">Sẵn sàng thêm</div><div className="admin-stat-value green">{readyItems.length}</div></div>
                <div className="admin-stat-card"><div className="admin-stat-label">Lỗi / bỏ qua</div><div className="admin-stat-value red">{errorItems.length}</div></div>
                <div className="admin-stat-card"><div className="admin-stat-label">Trùng (bỏ qua)</div><div className="admin-stat-value" style={{ color: "#8f98a0" }}>{dupItems.length}</div></div>
              </div>

              {/* Ready games — editable */}
              {readyItems.length > 0 && (
                <div className="admin-section" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
                  {/* Header + searchbar */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="admin-section-title" style={{ margin: 0, padding: 0, border: 0 }}>
                      ✅ Sẽ được thêm ({readyItems.length})
                      {bulkSearch && filteredReady.length !== readyItems.length && (
                        <span style={{ color: "#8f98a0", fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
                          — hiển thị {filteredReady.length}
                        </span>
                      )}
                    </div>
                    <input
                      className="admin-input"
                      style={{ maxWidth: 220, padding: "5px 10px", fontSize: 12 }}
                      placeholder="Tìm trong danh sách..."
                      value={bulkSearch}
                      onChange={e => setBulkSearch(e.target.value)}
                    />
                  </div>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead><tr><th>Ảnh</th><th>Tên</th><th>AppID</th><th>Giá bán (₫)</th><th>DRM</th></tr></thead>
                      <tbody>
                        {filteredReady.length === 0 ? (
                          <tr><td colSpan={5} className="admin-empty">Không tìm thấy</td></tr>
                        ) : filteredReady.map(r => {
                          const noPrice = Number(r.editPrice) === 0;
                          return (
                            <tr key={r.appid} style={noPrice ? { background: "rgba(245,158,11,0.06)" } : undefined}>
                              <td><img src={r.header_image || steamAppAssetUrl(r.appid, "header.jpg")} className="game-thumb" alt="" onError={e => { (e.target as HTMLImageElement).src = DEFAULT_STEAM_BACKGROUND_URL; }} /></td>
                              <td style={{ maxWidth: 180, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                <span style={{ color: "#fff", fontWeight: 600 }}>{r.name || r.appid}</span>
                                {noPrice && (
                                  <span style={{ marginLeft: 6, fontSize: 10, background: "rgba(245,158,11,0.2)", color: "#fde68a", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 4, padding: "1px 5px" }}>
                                    chưa có giá
                                  </span>
                                )}
                              </td>
                              <td style={{ fontFamily: "monospace", color: "#66c0f4" }}>{r.appid}</td>
                              <td>
                                <input className="admin-input" type="number" min={0} style={{ width: 110 }}
                                  value={r.editPrice} onChange={e => updateResult(r.appid, "editPrice", e.target.value)} />
                              </td>
                              <td>
                                {/* Multi-DRM: hiện detected DRMs dạng tags, có thể xóa/thêm */}
                                <DrmMultiSelect
                                  value={r.editDrm}
                                  onChange={v => updateResult(r.appid, "editDrm", v)}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Errors */}
              {errorItems.length > 0 && (
                <div className="admin-section" style={{ padding: 0, overflow: "hidden" }}>
                  <div className="admin-section-title" style={{ padding: "10px 16px", color: "#f87171" }}>❌ Lỗi / không có giá ({errorItems.length})</div>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead><tr><th>AppID</th><th>Lý do</th></tr></thead>
                      <tbody>
                        {errorItems.map(r => (
                          <tr key={r.appid}>
                            <td style={{ fontFamily: "monospace", color: "#66c0f4" }}>{r.appid}</td>
                            <td style={{ color: "#f87171", fontSize: 12 }}>{r.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="admin-modal-foot">
          <button className="admin-btn" onClick={onClose}>Đóng</button>
          {phase === "input" && (
            <button className="admin-btn primary" onClick={handleProcess} disabled={!input.trim()}>
              Bắt đầu xử lý
            </button>
          )}
          {phase === "review" && readyItems.length > 0 && (
            <button className="admin-btn success" onClick={handleSave} disabled={saving}>
              {saving ? "Đang lưu..." : `Lưu ${readyItems.length} game`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Edit Game Modal ─────────────────────────────────────────────────────────

interface EditGameModalProps { game: GameItem; onClose: () => void; onSaved: () => void; }

function EditGameModal({ game, onClose, onSaved }: EditGameModalProps) {
  const [price, setPrice] = useState(String(game.price ?? ""));
  const [originalPrice, setOriginalPrice] = useState(String(game.original_price ?? ""));
  const [name, setName] = useState(String(game.name ?? ""));
  const [drm, setDrm] = useState(String(game.drm ?? "Steam"));
  const [customImage, setCustomImage] = useState(String(game.custom_image ?? ""));
  const [libraryHero, setLibraryHero] = useState(String(game.library_hero_url ?? ""));
  const [libraryIcon, setLibraryIcon] = useState(String(game.library_icon_url ?? ""));
  const [baseAppid, setBaseAppid] = useState(String((game as Record<string,unknown>).base_appid ?? ""));
  const [fixFolderName, setFixFolderName] = useState(String((game as Record<string,unknown>).fix_folder_name ?? ""));
  const [fixExeName, setFixExeName] = useState(String((game as Record<string,unknown>).fix_exe_name ?? ""));
  const [fixDllName, setFixDllName] = useState(String((game as Record<string,unknown>).fix_dll_name ?? ""));
  const [fixZipUrl, setFixZipUrl] = useState(String((game as Record<string,unknown>).fix_zip_url ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    setSaving(true); setError("");
    try {
      await tauriAPI.adminApi.gamesUpdate(String(game.id), {
        price: Number(price) || 0,
        original_price: Number(originalPrice) || undefined,
        name: name.trim() || undefined,
        drm: drm || "Steam",
        custom_image: customImage.trim() || null,
        library_hero_url: libraryHero.trim() || null,
        library_icon_url: libraryIcon.trim() || null,
        base_appid: baseAppid.trim() || null,
        fix_folder_name: fixFolderName.trim() || null,
        fix_exe_name: fixExeName.trim() || null,
        fix_dll_name: fixDllName.trim() || null,
        fix_zip_url: fixZipUrl.trim() || null,
      });
      onSaved(); onClose();
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error)?.message ?? "Lỗi cập nhật");
    } finally { setSaving(false); }
  };

  return (
    <div className="admin-modal-overlay" onClick={ev => ev.target === ev.currentTarget && onClose()}>
      <div className="admin-modal">
        <div className="admin-modal-head">
          <span className="admin-modal-title">Sửa: {game.name || `AppID ${game.appid}`}</span>
          <button className="admin-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="admin-modal-body">
          {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="admin-form-grid cols-1" style={{ gap: 12 }}>
            <div className="admin-field">
              <label>Tên game</label>
              <input className="admin-input" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="admin-form-grid">
              <div className="admin-field">
                <label>Giá bán (₫)</label>
                <input className="admin-input" type="number" min={0} value={price} onChange={e => setPrice(e.target.value)} />
              </div>
              <div className="admin-field">
                <label>Giá gốc (₫) — để trống nếu không sale</label>
                <input className="admin-input" type="number" min={0} value={originalPrice} onChange={e => setOriginalPrice(e.target.value)} />
              </div>
            </div>
            <div className="admin-field">
              <label>DRM</label>
              <select className="admin-select" value={drm} onChange={e => setDrm(e.target.value)}>
                {["Steam","Epic Games","GOG","Ubisoft","Origin","Battle.net","Denuvo","Other"].map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label>Link ảnh thay thế (để trống = dùng ảnh gốc Steam)</label>
              <input
                className="admin-input"
                placeholder="https://..."
                value={customImage}
                onChange={e => setCustomImage(e.target.value)}
              />
              {customImage.trim() && (
                <div style={{ marginTop: 8, width: "100%", aspectRatio: "460/215", background: "#000", borderRadius: 6, overflow: "hidden" }}>
                  <img
                    src={customImage.trim()}
                    alt="preview"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onError={e => { (e.target as HTMLImageElement).style.opacity = "0.25"; }}
                  />
                </div>
              )}
            </div>
            <div className="admin-field">
              <label>Link ảnh banner Thư viện (library_hero) — để trống = dùng ảnh gốc Steam</label>
              <input
                className="admin-input"
                placeholder="https://..."
                value={libraryHero}
                onChange={e => setLibraryHero(e.target.value)}
              />
              {libraryHero.trim() && (
                <div style={{ marginTop: 8, width: "100%", aspectRatio: "16/6", background: "#000", borderRadius: 6, overflow: "hidden" }}>
                  <img
                    src={libraryHero.trim()}
                    alt="preview hero"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onError={e => { (e.target as HTMLImageElement).style.opacity = "0.25"; }}
                  />
                </div>
              )}
              <div style={{ fontSize: 11, color: "#8f98a0", marginTop: 3 }}>
                Ảnh nền lớn hiển thị khi vào trang chi tiết game trong Thư viện (banner ngang)
              </div>
            </div>
            <div className="admin-field">
              <label>Link icon Thư viện (library_icon) — để trống = tự lấy từ Steam</label>
              <input
                className="admin-input"
                placeholder="https://..."
                value={libraryIcon}
                onChange={e => setLibraryIcon(e.target.value)}
              />
              {libraryIcon.trim() && (
                <div style={{ marginTop: 8, width: 64, height: 64, background: "#000", borderRadius: 6, overflow: "hidden" }}>
                  <img
                    src={libraryIcon.trim()}
                    alt="preview icon"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onError={e => { (e.target as HTMLImageElement).style.opacity = "0.25"; }}
                  />
                </div>
              )}
              <div style={{ fontSize: 11, color: "#8f98a0", marginTop: 3 }}>
                Icon nhỏ hiển thị ở danh sách game bên trái trong Thư viện
              </div>
            </div>
            <div className="admin-field">
              <label>Base AppID — nếu đây là DLC</label>
              <input
                className="admin-input"
                placeholder="Để trống nếu là game gốc, nhập AppID basegame nếu là DLC"
                value={baseAppid}
                onChange={e => setBaseAppid(e.target.value.replace(/[^\d]/g, ""))}
              />
              <div style={{ fontSize: 11, color: "#8f98a0", marginTop: 3 }}>
                Ví dụ: DLC của Dota 2 (570) → nhập 570
              </div>
            </div>

            {/* ── Game-fix activation config ──────────────────────────── */}
            <div style={{ marginTop: 10, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ fontSize: 12, color: "#66c0f4", fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                ⚡ Cấu hình Kích hoạt (Game Fix)
              </div>
              <div style={{ fontSize: 11, color: "#8f98a0", marginBottom: 10, lineHeight: 1.5 }}>
                Khi user bấm "Kích hoạt" ở Thư viện, launcher sẽ dò <code style={{ color: "#fde68a" }}>SteamPath\steamapps\common\&lt;tên folder&gt;</code>,
                verify có file <code style={{ color: "#fde68a" }}>&lt;exe&gt;</code> + <code style={{ color: "#fde68a" }}>steam_api64.dll</code> + <code style={{ color: "#fde68a" }}>appmanifest_{game.appid}.acf</code>,
                rồi tải zip từ URL về, giải nén, đặt thuộc tính ẩn và merge vào folder game.
              </div>
              <div className="admin-form-grid" style={{ gap: 12 }}>
                <div className="admin-field">
                  <label>Tên folder game (trong steamapps\common\)</label>
                  <input
                    className="admin-input"
                    placeholder="VD: Grand Theft Auto V"
                    value={fixFolderName}
                    onChange={e => setFixFolderName(e.target.value)}
                  />
                </div>
                <div className="admin-field">
                  <label>Tên file .exe</label>
                  <input
                    className="admin-input"
                    placeholder="VD: GTA5.exe"
                    value={fixExeName}
                    onChange={e => setFixExeName(e.target.value)}
                  />
                </div>
              </div>
              <div className="admin-field" style={{ marginTop: 10 }}>
                <label>Tên file Steam API DLL</label>
                <input
                  className="admin-input"
                  placeholder="steam_api64.dll (mặc định) — game cũ 32-bit dùng steam_api.dll"
                  value={fixDllName}
                  onChange={e => setFixDllName(e.target.value)}
                />
                <div style={{ fontSize: 11, color: "#8f98a0", marginTop: 3 }}>
                  Để trống = dùng <code style={{ color: "#fde68a" }}>steam_api64.dll</code>. Game cũ thường dùng <code style={{ color: "#fde68a" }}>steam_api.dll</code> (32-bit).
                </div>
              </div>
              <div className="admin-field" style={{ marginTop: 10 }}>
                <label>URL file zip bypass</label>
                <input
                  className="admin-input"
                  placeholder="https://.../game-fix.zip"
                  value={fixZipUrl}
                  onChange={e => setFixZipUrl(e.target.value)}
                />
                <div style={{ fontSize: 11, color: "#8f98a0", marginTop: 3 }}>
                  Để trống cả 3 trường = ẩn nút Kích hoạt cho game này
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="admin-modal-foot">
          <button className="admin-btn" onClick={onClose}>Hủy</button>
          <button className="admin-btn primary" onClick={handleSave} disabled={saving}>
            {saving ? "Đang lưu..." : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Games Tab ───────────────────────────────────────────────────────────────

function GamesTab() {
  const [games, setGames] = useState<GameItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [editGame, setEditGame] = useState<GameItem | null>(null);
  const [toast, setToast] = useState("");
  const [rescan, setRescan] = useState<{ open: boolean; total: number; done: number; updated: number; failed: number; current: string; running: boolean } | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await tauriAPI.adminApi.gamesList();
      setGames(Array.isArray(list) ? list : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const cancelRescanRef = useRef(false);

  const handleRescanGenres = async () => {
    if (rescan?.running) return;
    if (!confirm("Quét và fetch lại thể loại cho tất cả game? Quá trình có thể mất vài phút.")) return;
    cancelRescanRef.current = false;
    const list = games.slice();
    setRescan({ open: true, total: list.length, done: 0, updated: 0, failed: 0, current: "", running: true });

    let updated = 0;
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      if (cancelRescanRef.current) break;
      const g = list[i];
      const appid = String(g.appid || "");
      setRescan((p) => p && { ...p, current: g.name || `AppID ${appid}`, done: i });
      try {
        const fetched = await tauriAPI.adminApi.fetchSteamGame(appid);
        const genres = (fetched.genres || "").trim();
        if (genres) {
          await tauriAPI.adminApi.gamesUpdate(String(g.id), { genres });
          updated += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
      setRescan((p) => p && { ...p, done: i + 1, updated, failed });
    }

    setRescan((p) => p && { ...p, running: false, current: "" });
    refresh();
  };

  const handleDelete = async (game: GameItem) => {
    if (!confirm(`Xóa game "${game.name || game.appid}"?`)) return;
    try {
      await tauriAPI.adminApi.gamesDelete(String(game.id));
      showToast("Đã xóa game.");
      refresh();
    } catch (e) { showToast(typeof e === "string" ? e : "Lỗi xóa"); }
  };

  const filtered = games.filter(g =>
    (g.name || "").toLowerCase().includes(search.toLowerCase()) ||
    String(g.appid).includes(search)
  );

  return (
    <div>
      {toast && (
        <div style={{ position: "fixed", bottom: 20, right: 20, background: "rgba(22,27,34,0.98)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "10px 16px", color: "#fff", zIndex: 9998, fontSize: 13 }}>
          {toast}
        </div>
      )}

      <div className="admin-search-bar">
        <input className="admin-input" style={{ maxWidth: 280 }} placeholder="Tìm theo tên / AppID..." value={search} onChange={e => setSearch(e.target.value)} />
        <button className="admin-btn primary" onClick={() => setShowAdd(true)}>+ Thêm game</button>
        <button className="admin-btn" onClick={() => setShowBulk(true)}>+ Thêm hàng loạt</button>
        <button className="admin-btn" onClick={handleRescanGenres} disabled={rescan?.running}>
          {rescan?.running ? "Đang quét..." : "🏷️ Quét thể loại"}
        </button>
        <button className="admin-btn" onClick={refresh}>🔄</button>
        <span style={{ fontSize: 12, color: "#8f98a0" }}>{filtered.length} / {games.length} game</span>
      </div>

      {loading ? <div className="admin-empty">Đang tải...</div> : (
        <div className="admin-section" style={{ padding: 0, overflow: "hidden" }}>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Ảnh</th><th>Tên game</th><th>AppID</th>
                  <th>Giá</th><th>Giá gốc</th><th>DRM</th><th>DLC của</th><th>Lượt mua</th><th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="admin-empty">Không có game nào</td></tr>
                ) : filtered.map((g) => {
                  const appid = String(g.appid || "");
                  const baseAppidVal = String((g as Record<string,unknown>).base_appid ?? "");
                  const img = (g.custom_image as string) || (g.header_image as string) || steamAppAssetUrl(appid, "header.jpg");
                  const isOnSale = Number(g.original_price || 0) > Number(g.price || 0);
                  const gameId = String(g.id || "");
                  return (
                    <tr key={gameId} style={baseAppidVal ? { background: "rgba(102,192,244,0.04)" } : undefined}>
                      <td><img src={img} className="game-thumb" alt="" onError={e => { (e.target as HTMLImageElement).src = DEFAULT_STEAM_BACKGROUND_URL; }} /></td>
                      <td style={{ color: "#fff", maxWidth: 200 }}>
                        <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name || `Game ${appid}`}</div>
                        {baseAppidVal && <div style={{ fontSize: 10, color: "#66c0f4", marginTop: 2 }}>DLC</div>}
                      </td>
                      <td style={{ fontFamily: "monospace", color: "#66c0f4" }}>{appid}</td>
                      <td style={{ color: isOnSale ? "#a4d007" : "#c7d5e0", fontWeight: 600 }}>
                        {Number(g.price) === 0 ? "Miễn phí" : formatMoney(Number(g.price))}
                      </td>
                      <td style={{ color: "#8f98a0", textDecoration: isOnSale ? "line-through" : "none" }}>
                        {Number(g.original_price || 0) > 0 ? formatMoney(Number(g.original_price)) : "—"}
                      </td>
                      <td style={{ color: "#8f98a0" }}>{String(g.drm || "—")}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 11, color: baseAppidVal ? "#66c0f4" : "#8f98a0" }}>
                        {baseAppidVal || "—"}
                      </td>
                      <td style={{ color: "#c7d5e0" }}>{Number(g.purchase_count ?? 0)}</td>
                      <td>
                        <div className="admin-btn-row">
                          <button className="admin-btn" onClick={() => setEditGame(g)}>Sửa</button>
                          <button className="admin-btn danger" onClick={() => handleDelete(g)}>Xóa</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAdd && <AddGameModal allGames={games} onClose={() => setShowAdd(false)} onSaved={refresh} />}
      {showBulk && <BulkAddModal allGames={games} onClose={() => setShowBulk(false)} onSaved={refresh} />}
      {editGame && <EditGameModal game={editGame} onClose={() => setEditGame(null)} onSaved={refresh} />}

      {rescan?.open && (
        <div className="admin-modal-overlay">
          <div className="admin-modal" style={{ maxWidth: 460 }}>
            <div className="admin-modal-head">
              <span className="admin-modal-title">Quét thể loại game</span>
              {!rescan.running && (
                <button className="admin-modal-close" onClick={() => setRescan(null)}>✕</button>
              )}
            </div>
            <div className="admin-modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 13, color: "#c7d5e0" }}>
                {rescan.running ? `Đang xử lý: ${rescan.current || "..."}` : "Hoàn tất!"}
              </div>

              {/* Progress bar */}
              <div style={{ width: "100%", height: 12, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${rescan.total ? Math.round((rescan.done / rescan.total) * 100) : 0}%`,
                  background: "linear-gradient(90deg, #3b82f6, #2563eb)",
                  transition: "width 0.2s ease",
                }} />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#8f98a0" }}>
                <span>{rescan.done} / {rescan.total} game</span>
                <span style={{ color: "#a4d007" }}>✓ {rescan.updated}</span>
                <span style={{ color: "#ff6b6b" }}>✗ {rescan.failed}</span>
              </div>
            </div>
            <div className="admin-modal-foot">
              {rescan.running ? (
                <button className="admin-btn danger" onClick={() => { cancelRescanRef.current = true; }}>Dừng</button>
              ) : (
                <button className="admin-btn primary" onClick={() => setRescan(null)}>Đóng</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Users Tab ───────────────────────────────────────────────────────────────

interface UserActionsModalProps { user: UserProfile; panelRole: string; onClose: () => void; onChanged: () => void; }

function UserActionsModal({ user, panelRole, onClose, onChanged }: UserActionsModalProps) {
  const canMoney = panelRole === "payer" || panelRole === "manager";
  const canBan = panelRole === "admin" || panelRole === "manager";
  const canSteam = panelRole === "admin" || panelRole === "manager";
  const canRevokeGame = panelRole === "payer" || panelRole === "manager";
  const [giftAmount, setGiftAmount] = useState("");
  const [setBalanceVal, setSetBalanceVal] = useState(String(user.balance ?? 0));
  const [userGames, setUserGames] = useState<GameItem[]>([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState<"balance" | "games" | "add_game" | "steam">("balance");
  const [banReason, setBanReason] = useState("");
  const [banHours, setBanHours] = useState("");
  const [allGames, setAllGames] = useState<GameItem[]>([]);
  const [addGameSearch, setAddGameSearch] = useState("");
  const [addingGameId, setAddingGameId] = useState<string | null>(null);
  const [linkedSteam, setLinkedSteam] = useState<{linked: boolean; link?: any} | null>(null);
  const [loadingSteam, setLoadingSteam] = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const loadGames = useCallback(async () => {
    setLoadingGames(true);
    try { setUserGames(Array.isArray(await tauriAPI.adminApi.listUserGames(user.id)) ? await tauriAPI.adminApi.listUserGames(user.id) : []); }
    catch (_) { setUserGames([]); }
    finally { setLoadingGames(false); }
  }, [user.id]);

  useEffect(() => { if (tab === "games") loadGames(); }, [tab, loadGames]);

  useEffect(() => {
    if (tab === "add_game" && allGames.length === 0) {
      tauriAPI.adminApi.gamesList().then(g => setAllGames(Array.isArray(g) ? g : [])).catch(() => {});
    }
  }, [tab, allGames.length]);

  // Load Steam link info when tab is "steam"
  useEffect(() => {
    if (tab === "steam" && canSteam) {
      setLoadingSteam(true);
      tauriAPI.steamLink.adminGetUserSteamLink(user.id)
        .then(setLinkedSteam)
        .catch(() => setLinkedSteam({ linked: false }))
        .finally(() => setLoadingSteam(false));
    }
  }, [tab, user.id, canSteam]);

  const handleGift = async () => {
    const amt = Number(giftAmount);
    if (!Number.isFinite(amt) || amt === 0) { showToast("Số tiền không hợp lệ"); return; }
    try { await tauriAPI.adminApi.giftBalance(user.id, amt); showToast(amt > 0 ? `Đã tặng ${formatMoney(amt)}` : `Đã trừ ${formatMoney(Math.abs(amt))}`); setGiftAmount(""); onChanged(); }
    catch (e) { showToast(typeof e === "string" ? e : "Lỗi"); }
  };

  const handleSetBalance = async () => {
    const val = Number(setBalanceVal);
    if (!Number.isFinite(val) || val < 0) { showToast("Không hợp lệ"); return; }
    try { await tauriAPI.adminApi.setBalance(user.id, val); showToast(`Set số dư: ${formatMoney(val)}`); onChanged(); }
    catch (e) { showToast(typeof e === "string" ? e : "Lỗi"); }
  };

  const handleBan = async () => {
    if (user.is_banned) {
      // Bỏ ban — không cần confirm
      try { await tauriAPI.adminApi.toggleBan(user.id, false); showToast("Đã bỏ ban"); onChanged(); onClose(); }
      catch (e) { showToast(typeof e === "string" ? e : "Lỗi"); }
      return;
    }
    // Ban — cần lý do
    if (!banReason.trim()) { showToast("Nhập lý do ban"); return; }
    const hours = banHours.trim() === "" ? undefined : Number(banHours);
    if (hours !== undefined && (!Number.isFinite(hours) || hours <= 0)) { showToast("Thời hạn không hợp lệ"); return; }
    try {
      await tauriAPI.adminApi.toggleBan(user.id, true, banReason.trim(), hours);
      showToast("Đã ban");
      onChanged(); onClose();
    } catch (e) { showToast(typeof e === "string" ? e : "Lỗi"); }
  };

  const handleRevokeGame = async (gameId: string) => {
    try { await tauriAPI.adminApi.revokeGame(user.id, gameId); showToast("Đã thu hồi"); loadGames(); }
    catch (e) { showToast(typeof e === "string" ? e : "Lỗi"); }
  };

  const handleUnlinkSteam = async () => {
    if (!confirm("Hủy liên kết Steam của người dùng này?")) return;
    try {
      await tauriAPI.steamLink.adminUnlinkSteam(user.id);
      showToast("Đã hủy liên kết Steam");
      setLinkedSteam({ linked: false });
    } catch (e) { showToast(typeof e === "string" ? e : "Lỗi"); }
  };

  const name = user.display_name || user.username || user.email || user.id;

  return (
    <div className="admin-modal-overlay" onClick={ev => ev.target === ev.currentTarget && onClose()}>
      <div className="admin-modal" style={{ width: "min(680px, 100%)" }}>
        <div className="admin-modal-head">
          <span className="admin-modal-title">{name}</span>
          <button className="admin-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="admin-modal-body">
          {toast && <div style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 6, padding: "8px 12px", marginBottom: 12, color: "#93c5fd", fontSize: 13 }}>{toast}</div>}
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#8f98a0" }}>{user.email}</span>
            <span className={`admin-badge ${user.role === "admin" ? "admin" : user.role === "ctv" ? "ctv" : "user"}`}>{user.role || "user"}</span>
            {user.is_banned && <span className="admin-badge banned">BANNED</span>}
            <span style={{ fontSize: 12, color: "#a4d007" }}>💰 {formatMoney(Number(user.balance ?? 0))}</span>
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 8 }}>
            <button className={`admin-btn${tab === "balance" ? " primary" : ""}`} onClick={() => setTab("balance")}>Số dư & Tài khoản</button>
            <button className={`admin-btn${tab === "games" ? " primary" : ""}`} onClick={() => setTab("games")}>Game sở hữu</button>
            {(canRevokeGame || panelRole === "payer") && (
              <button className={`admin-btn${tab === "add_game" ? " primary" : ""}`} onClick={() => setTab("add_game")}>Thêm Game</button>
            )}
            {canSteam && (
              <button className={`admin-btn${tab === "steam" ? " primary" : ""}`} onClick={() => setTab("steam")}>Steam</button>
            )}
          </div>
          {tab === "balance" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {canMoney && (
                <>
                  <div className="admin-section" style={{ padding: 14 }}>
                    <div className="admin-section-title" style={{ fontSize: 12 }}>Tặng / Trừ số dư</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input className="admin-input" type="number" style={{ maxWidth: 180 }} placeholder="100000 hoặc -50000" value={giftAmount} onChange={e => setGiftAmount(e.target.value)} />
                      <button className="admin-btn success" onClick={handleGift}>Thực hiện</button>
                    </div>
                    <div style={{ fontSize: 11, color: "#8f98a0", marginTop: 5 }}>Số dương = tặng, số âm = trừ</div>
                  </div>
                  <div className="admin-section" style={{ padding: 14 }}>
                    <div className="admin-section-title" style={{ fontSize: 12 }}>Đặt số dư chính xác</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input className="admin-input" type="number" min={0} style={{ maxWidth: 180 }} value={setBalanceVal} onChange={e => setSetBalanceVal(e.target.value)} />
                      <button className="admin-btn primary" onClick={handleSetBalance}>Set</button>
                    </div>
                  </div>
                </>
              )}
              {canBan && (
                <div className="admin-section" style={{ padding: 14 }}>
                  <div className="admin-section-title" style={{ fontSize: 12 }}>Trạng thái tài khoản</div>
                  {!user.is_banned && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                      <input
                        className="admin-input"
                        placeholder="Lý do ban (bắt buộc)"
                        value={banReason}
                        onChange={e => setBanReason(e.target.value)}
                      />
                      <input
                        className="admin-input"
                        type="number"
                        min={0}
                        placeholder="Thời hạn (giờ) — để trống = vĩnh viễn"
                        value={banHours}
                        onChange={e => setBanHours(e.target.value)}
                        style={{ maxWidth: 280 }}
                      />
                    </div>
                  )}
                  <button className={`admin-btn ${user.is_banned ? "success" : "danger"}`} onClick={handleBan}>
                    {user.is_banned ? "Bỏ ban tài khoản" : "Ban tài khoản"}
                  </button>
                </div>
              )}
              {!canMoney && !canBan && (
                <div className="admin-empty">Bạn không có quyền thao tác trên tài khoản này.</div>
              )}
            </div>
          )}
          {tab === "games" && (
            loadingGames ? <div className="admin-empty">Đang tải...</div> :
            userGames.length === 0 ? <div className="admin-empty">Chưa sở hữu game nào</div> : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>AppID</th><th>Tên game</th><th>Thao tác</th></tr></thead>
                  <tbody>
                    {userGames.map(g => (
                      <tr key={String(g.id)}>
                        <td style={{ fontFamily: "monospace", color: "#66c0f4" }}>{g.appid}</td>
                        <td style={{ color: "#fff" }}>{g.name || `Game ${g.appid}`}</td>
                        <td>{canRevokeGame && <button className="admin-btn danger" onClick={() => handleRevokeGame(String(g.id))}>Thu hồi</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          {tab === "add_game" && (
            <div>
              <input
                className="admin-input"
                placeholder="Tìm tên game..."
                value={addGameSearch}
                onChange={e => setAddGameSearch(e.target.value)}
                style={{ marginBottom: 12, width: "100%" }}
              />
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {allGames
                  .filter(g => !addGameSearch || (g.name||"").toLowerCase().includes(addGameSearch.toLowerCase()))
                  .map(g => (
                    <div key={String(g.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <span style={{ flex: 1, color: "#c7d5e0", fontSize: 13 }}>{g.name || `Game ${g.appid}`}</span>
                      <span style={{ color: "#8f98a0", fontSize: 11, fontFamily: "monospace" }}>{g.appid}</span>
                      <button
                        className="admin-btn success"
                        style={{ fontSize: 11, padding: "3px 10px" }}
                        disabled={addingGameId === String(g.id)}
                        onClick={async () => {
                          setAddingGameId(String(g.id));
                          try {
                            const res = await tauriAPI.adminApi.grantGameToUser(user.id, String(g.id));
                            if (res.skipped) showToast("Game đã có trong thư viện");
                            else showToast(`Đã thêm "${g.name}" vào thư viện`);
                          } catch (e) { showToast(typeof e === "string" ? e : "Lỗi"); }
                          finally { setAddingGameId(null); }
                        }}
                      >
                        {addingGameId === String(g.id) ? "..." : "+ Thêm"}
                      </button>
                    </div>
                  ))
                }
              </div>
            </div>
          )}
          {tab === "steam" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {loadingSteam ? (
                <div className="admin-empty">Đang tải...</div>
              ) : linkedSteam?.linked ? (
                <div className="admin-section" style={{ padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    {linkedSteam.link?.avatar_url && (
                      <img src={linkedSteam.link.avatar_url} alt="" style={{ width: 48, height: 48, borderRadius: 4 }} />
                    )}
                    <div>
                      <div style={{ fontWeight: 600, color: "#fff" }}>{linkedSteam.link?.persona_name || "Steam Account"}</div>
                      <div style={{ fontSize: 11, color: "#8f98a0" }}>
                        Registry ID: <code style={{ background: "rgba(255,255,255,0.08)", padding: "2px 6px", borderRadius: 3 }}>{linkedSteam.link?.registry_id || linkedSteam.link?.steam_id}</code>
                      </div>
                      {linkedSteam.link?.linked_at && (
                        <div style={{ fontSize: 11, color: "#8f98a0" }}>
                          Liên kết: {new Date(linkedSteam.link.linked_at).toLocaleString("vi-VN")}
                        </div>
                      )}
                    </div>
                  </div>
                  <button className="admin-btn danger" onClick={handleUnlinkSteam}>
                    🗑️ Hủy liên kết Steam
                  </button>
                </div>
              ) : (
                <div className="admin-section" style={{ padding: 14 }}>
                  <div style={{ color: "#8f98a0", textAlign: "center", padding: "20px 0" }}>
                    Người dùng này chưa liên kết tài khoản Steam
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="admin-modal-foot">
          <button className="admin-btn" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
}

function UsersTab({ panelRole }: { panelRole: string }) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const list = await tauriAPI.adminApi.listUsers();
      setUsers(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error)?.message ?? "Lỗi tải users");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = users.filter(u => {
    const s = search.toLowerCase();
    return (u.email||"").toLowerCase().includes(s) || (u.username||"").toLowerCase().includes(s) || (u.display_name||"").toLowerCase().includes(s);
  });

  return (
    <div>
      <div className="admin-search-bar">
        <input className="admin-input" style={{ maxWidth: 320 }} placeholder="Tìm email, username, tên..." value={search} onChange={e => setSearch(e.target.value)} />
        <button className="admin-btn" onClick={refresh}>🔄 Làm mới</button>
        <span style={{ fontSize: 12, color: "#8f98a0" }}>{filtered.length} / {users.length} người dùng</span>
      </div>

      {loading ? <div className="admin-empty">Đang tải...</div> :
       error ? <div className="admin-empty" style={{ color: "#f87171" }}>{error}</div> : (
        <div className="admin-section" style={{ padding: 0, overflow: "hidden" }}>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Email</th><th>Tên / Username</th><th>Vai trò</th><th>Số dư</th><th>Trạng thái</th><th>Thao tác</th></tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="admin-empty">{users.length === 0 ? "Không có người dùng nào" : "Không tìm thấy"}</td></tr>
                ) : filtered.map(u => (
                  <tr key={u.id}>
                    <td style={{ color: "#66c0f4", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email || "—"}</td>
                    <td style={{ color: "#fff" }}>
                      <div style={{ fontWeight: 600 }}>{u.display_name || u.username || "—"}</div>
                      {u.username && <div style={{ fontSize: 11, color: "#8f98a0" }}>@{u.username}</div>}
                    </td>
                    <td><span className={`admin-badge ${u.role==="admin"?"admin":u.role==="ctv"?"ctv":"user"}`}>{u.role||"user"}</span></td>
                    <td style={{ color: "#a4d007", fontWeight: 600 }}>{formatMoney(Number(u.balance??0))}</td>
                    <td>{u.is_banned ? <span className="admin-badge banned">BANNED</span> : <span className="admin-badge active">Hoạt động</span>}</td>
                    <td><button className="admin-btn" onClick={() => setSelectedUser(u)}>Quản lý</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {selectedUser && <UserActionsModal user={selectedUser} panelRole={panelRole} onClose={() => setSelectedUser(null)} onChanged={refresh} />}
    </div>
  );
}

// ─── Store Assets Tab ─────────────────────────────────────────────────────────

function StoreAssetsTab() {
  const [assets, setAssets] = useState<StoreAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<"carousel"|"banner">("carousel");
  const [formImageUrl, setFormImageUrl] = useState("");
  const [formLinkUrl, setFormLinkUrl] = useState("");
  const [formPosition, setFormPosition] = useState("0");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setAssets(Array.isArray(await tauriAPI.adminApi.storeAssetsList()) ? await tauriAPI.adminApi.storeAssetsList() : []); }
    catch (_) { setAssets([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleAdd = async () => {
    if (!formImageUrl.trim()) { showToast("Vui lòng nhập URL ảnh"); return; }
    setSaving(true);
    try {
      await tauriAPI.adminApi.storeAssetsAdd({ type: formType, image_url: formImageUrl.trim(), link_url: formLinkUrl.trim()||undefined, position: Number(formPosition)||0 });
      showToast("Đã thêm"); setShowForm(false); setFormImageUrl(""); setFormLinkUrl(""); setFormPosition("0"); refresh();
    } catch (e) { showToast(typeof e==="string"?e:"Lỗi"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Xóa asset?")) return;
    try { await tauriAPI.adminApi.storeAssetsDelete(id); showToast("Đã xóa"); refresh(); }
    catch (e) { showToast(typeof e==="string"?e:"Lỗi"); }
  };

  return (
    <div>
      {toast && <div style={{ position:"fixed",bottom:20,right:20,background:"rgba(22,27,34,0.98)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"10px 16px",color:"#fff",zIndex:9998,fontSize:13 }}>{toast}</div>}
      <div className="admin-search-bar">
        <button className="admin-btn primary" onClick={() => setShowForm(v=>!v)}>{showForm?"Ẩn form":"+ Thêm asset"}</button>
        <button className="admin-btn" onClick={refresh}>🔄</button>
      </div>
      {showForm && (
        <div className="admin-section" style={{ marginBottom:20 }}>
          <div className="admin-section-title">Thêm Carousel / Banner mới</div>
          <div className="admin-form-grid cols-1" style={{ gap:12 }}>
            <div className="admin-field"><label>Loại</label>
              <select className="admin-select" value={formType} onChange={e=>setFormType(e.target.value as "carousel"|"banner")}>
                <option value="carousel">Carousel</option><option value="banner">Banner</option>
              </select>
            </div>
            <div className="admin-field"><label>URL ảnh / video</label><input className="admin-input" placeholder="https://..." value={formImageUrl} onChange={e=>setFormImageUrl(e.target.value)} /></div>
            <div className="admin-form-grid">
              <div className="admin-field"><label>URL liên kết</label><input className="admin-input" placeholder="https://..." value={formLinkUrl} onChange={e=>setFormLinkUrl(e.target.value)} /></div>
              <div className="admin-field"><label>Vị trí</label><input className="admin-input" type="number" min={0} value={formPosition} onChange={e=>setFormPosition(e.target.value)} /></div>
            </div>
            {formImageUrl && !/\.(mp4|webm)/i.test(formImageUrl) && <img src={formImageUrl} className="asset-preview-img" alt="preview" />}
            <button className="admin-btn primary" onClick={handleAdd} disabled={saving} style={{ maxWidth:160 }}>{saving?"Đang lưu...":"Thêm"}</button>
          </div>
        </div>
      )}
      {loading ? <div className="admin-empty">Đang tải...</div> :
       assets.length===0 ? <div className="admin-empty">Chưa có store asset nào</div> : (
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14 }}>
          {assets.map(a=>(
            <div key={String(a.id)} className="admin-section" style={{ padding:14 }}>
              {!/\.(mp4|webm)/i.test(String(a.image_url||"")) ? <img src={a.image_url} className="asset-preview-img" alt="" /> : <video src={a.image_url} autoPlay muted loop playsInline style={{ width:"100%",maxHeight:140,borderRadius:6,background:"#000" }} />}
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8 }}>
                <div><span className={`admin-badge ${a.type==="carousel"?"active":"ctv"}`}>{a.type}</span><span style={{ fontSize:11,color:"#8f98a0",marginLeft:8 }}>Vị trí: {String(a.position??0)}</span></div>
                <button className="admin-btn danger" onClick={()=>handleDelete(String(a.id))}>Xóa</button>
              </div>
              {a.link_url && <div style={{ fontSize:11,color:"#66c0f4",marginTop:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>🔗 {a.link_url}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DLCs Tab ─────────────────────────────────────────────────────────────────

function DlcsTab() {
  const [dlcs, setDlcs] = useState<DlcItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editDlc, setEditDlc] = useState<DlcItem | null>(null);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 4000); };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await tauriAPI.adminApi.dlcsList();
      setDlcs(Array.isArray(list) ? list : []);
    } catch (e) {
      showToast(`Lỗi tải DLC: ${typeof e === "string" ? e : (e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = dlcs.filter(d =>
    (d.name || "").toLowerCase().includes(search.toLowerCase()) ||
    String(d.appid).includes(search) ||
    String(d.base_appid || "").includes(search)
  );

  const handleDelete = async (dlc: DlcItem) => {
    if (!dlc.id) return;
    if (!confirm(`Xóa DLC "${dlc.name || dlc.appid}"?`)) return;
    try {
      await tauriAPI.adminApi.dlcsDelete(String(dlc.id));
      showToast("✅ Đã xóa DLC");
      refresh();
    } catch (e) {
      showToast(`Lỗi: ${typeof e === "string" ? e : (e as Error).message}`);
    }
  };

  return (
    <div>
      {toast && (
        <div style={{ position: "fixed", bottom: 20, right: 20, background: "rgba(22,27,34,0.98)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "10px 16px", color: "#fff", zIndex: 9998, fontSize: 13 }}>
          {toast}
        </div>
      )}

      <div className="admin-search-bar">
        <input className="admin-input" style={{ maxWidth: 280 }} placeholder="Tìm theo tên / AppID / Base AppID..." value={search} onChange={e => setSearch(e.target.value)} />
        <button className="admin-btn" onClick={refresh}>🔄 Tải lại</button>
        <span style={{ fontSize: 12, color: "#8f98a0" }}>{filtered.length} / {dlcs.length} DLC</span>
      </div>

      {loading ? <div className="admin-empty">Đang tải...</div> : (
        <div className="admin-section" style={{ padding: 0, overflow: "hidden" }}>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Ảnh</th>
                  <th>Tên DLC</th>
                  <th>AppID</th>
                  <th>Base AppID</th>
                  <th>Giá</th>
                  <th>Giá gốc</th>
                  <th style={{ width: 140 }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="admin-empty">Không có DLC</td></tr>
                ) : filtered.map(d => {
                  const id = String(d.id);
                  const appid = String(d.appid || "");
                  const img = (d.custom_image as string) || (d.header_image as string) || steamAppAssetUrl(appid, "header.jpg");
                  const isOnSale = Number(d.original_price || 0) > Number(d.price || 0);
                  return (
                    <tr key={id}>
                      <td><img src={img} className="game-thumb" alt="" onError={e => { (e.target as HTMLImageElement).src = DEFAULT_STEAM_BACKGROUND_URL; }} /></td>
                      <td style={{ color: "#fff", fontWeight: 600, maxWidth: 240, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {d.name || `DLC ${appid}`}
                      </td>
                      <td style={{ fontFamily: "monospace", color: "#66c0f4" }}>{appid}</td>
                      <td style={{ fontFamily: "monospace", color: "#8f98a0" }}>{String(d.base_appid || "—")}</td>
                      <td style={{ color: isOnSale ? "#a4d007" : "#c7d5e0", fontWeight: 600 }}>
                        {Number(d.price) === 0 ? "—" : formatMoney(Number(d.price))}
                      </td>
                      <td style={{ color: "#8f98a0", textDecoration: isOnSale ? "line-through" : "none" }}>
                        {isOnSale ? formatMoney(Number(d.original_price)) : "—"}
                      </td>
                      <td>
                        <button className="admin-btn small" onClick={() => setEditDlc(d)}>✏️ Sửa</button>
                        <button className="admin-btn small danger" onClick={() => handleDelete(d)} style={{ marginLeft: 6 }}>🗑️</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editDlc && (
        <DlcEditModal
          dlc={editDlc}
          onClose={() => setEditDlc(null)}
          onSaved={() => { setEditDlc(null); refresh(); showToast("✅ Đã lưu DLC"); }}
        />
      )}
    </div>
  );
}

function DlcEditModal({ dlc, onClose, onSaved }: { dlc: DlcItem; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(String(dlc.name || ""));
  const [price, setPrice] = useState(String(dlc.price ?? 0));
  const [originalPrice, setOriginalPrice] = useState(String(dlc.original_price ?? 0));
  const [headerImage, setHeaderImage] = useState(String(dlc.header_image || ""));
  const [customImage, setCustomImage] = useState(String(dlc.custom_image || ""));
  const [baseAppid, setBaseAppid] = useState(String(dlc.base_appid || ""));
  const [isFree, setIsFree] = useState(Boolean((dlc as Record<string, unknown>).is_free));
  const [appid] = useState(String(dlc.appid || ""));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const handleSave = async () => {
    if (!dlc.id) return;
    setSaving(true);
    setErr("");
    try {
      const patch: Partial<DlcItem> = {
        name: name.trim(),
        price: Number(price) || 0,
        original_price: Number(originalPrice) || 0,
        header_image: headerImage.trim() || undefined,
        custom_image: customImage.trim() || undefined,
        base_appid: baseAppid.trim() || undefined,
        is_free: isFree,
      } as Partial<DlcItem>;
      await tauriAPI.adminApi.dlcsUpdate(String(dlc.id), patch);
      onSaved();
    } catch (e) {
      setErr(typeof e === "string" ? e : (e as Error).message ?? "Lỗi không xác định");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header">
          <div className="admin-modal-title">Sửa DLC</div>
          <button className="admin-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="admin-modal-body">
          <div className="admin-field">
            <label>AppID (chỉ đọc)</label>
            <input className="admin-input" value={appid} readOnly disabled />
          </div>
          <div className="admin-field">
            <label>Tên DLC</label>
            <input className="admin-input" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div className="admin-field" style={{ flex: 1 }}>
              <label>Giá hiện tại (₫)</label>
              <input className="admin-input" type="number" min={0} value={price} onChange={e => setPrice(e.target.value)} />
            </div>
            <div className="admin-field" style={{ flex: 1 }}>
              <label>Giá gốc (₫) — để 0 nếu không sale</label>
              <input className="admin-input" type="number" min={0} value={originalPrice} onChange={e => setOriginalPrice(e.target.value)} />
            </div>
          </div>
          <div className="admin-field">
            <label>Base AppID (game gốc)</label>
            <input className="admin-input" value={baseAppid} onChange={e => setBaseAppid(e.target.value)} placeholder="VD: 730" />
          </div>
          <div className="admin-field">
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={isFree} onChange={e => setIsFree(e.target.checked)} />
              <span>DLC miễn phí (tích để cho phép user nhận free)</span>
            </label>
            <div style={{ fontSize: 11, color: "#8f98a0", marginTop: 3 }}>
              Không tích + giá = 0 → hiển thị "Chưa có giá" (user không nhận được)
            </div>
          </div>
          <div className="admin-field">
            <label>Header Image URL</label>
            <input className="admin-input" value={headerImage} onChange={e => setHeaderImage(e.target.value)} />
          </div>
          <div className="admin-field">
            <label>Custom Image URL (ưu tiên hiển thị)</label>
            <input className="admin-input" value={customImage} onChange={e => setCustomImage(e.target.value)} />
          </div>
          {err && <div style={{ color: "#ff6b6b", fontSize: 12, marginTop: 8 }}>{err}</div>}
        </div>
        <div className="admin-modal-footer">
          <button className="admin-btn" onClick={onClose} disabled={saving}>Hủy</button>
          <button className="admin-btn primary" onClick={handleSave} disabled={saving}>
            {saving ? "Đang lưu..." : "💾 Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sale Tab ─────────────────────────────────────────────────────────────────

type SaleType = "percent" | "fixed_price" | "fixed_amount";
type SaleMode = "games" | "dlcs";

function SaleTab() {
  const [mode, setMode] = useState<SaleMode>("games");
  const [games, setGames] = useState<GameItem[]>([]);
  const [dlcs, setDlcs] = useState<DlcItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saleType, setSaleType] = useState<SaleType>("percent");
  const [saleValue, setSaleValue] = useState("");
  const [saleStart, setSaleStart] = useState("");
  const [saleEnd, setSaleEnd] = useState("");
  const [applying, setApplying] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 4000); };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === "games") {
        const list = await tauriAPI.adminApi.gamesList();
        setGames(Array.isArray(list) ? list : []);
      } else {
        const list = await tauriAPI.adminApi.dlcsList();
        setDlcs(Array.isArray(list) ? list : []);
      }
    } catch (_) {}
    finally { setLoading(false); }
  }, [mode]);

  useEffect(() => {
    setSelected(new Set());
    refresh();
  }, [refresh]);

  // Items đang hiển thị (games hoặc dlcs)
  const items = mode === "games" ? games : dlcs;
  const filtered = items.filter((g: GameItem | DlcItem) =>
    (g.name || "").toLowerCase().includes(search.toLowerCase()) ||
    String(g.appid).includes(search)
  );

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((g) => String(g.id))));
    }
  };

  const handleApply = async () => {
    if (selected.size === 0) { showToast(`Chưa chọn ${mode === "games" ? "game" : "DLC"} nào`); return; }
    const val = Number(saleValue);
    if (!val || val <= 0) { showToast("Giá trị giảm không hợp lệ"); return; }
    setApplying(true);
    try {
      const ids = Array.from(selected);
      const res = mode === "games"
        ? await tauriAPI.adminApi.applySale(ids, saleType, val, saleStart || undefined, saleEnd || undefined)
        : await tauriAPI.adminApi.applySaleDlc(ids, saleType, val, saleStart || undefined, saleEnd || undefined);
      showToast(`✅ Đã áp dụng sale cho ${res.updated} ${mode === "games" ? "game" : "DLC"}${res.errors.length ? ` (${res.errors.length} lỗi)` : ""}`);

      // Thông báo Discord về đợt sale
      const selectedItems = items.filter(g => selected.has(String(g.id)));
      const saleDesc = saleType === "percent"
        ? `Giảm ${val}%`
        : saleType === "fixed_price"
          ? `Giá còn ${formatMoney(val)}`
          : `Giảm ${formatMoney(val)}`;
      const names = selectedItems.slice(0, 10).map(g => `• ${g.name || g.appid}`).join("\n");
      const more = selectedItems.length > 10 ? `\n...và ${selectedItems.length - 10} ${mode === "games" ? "game" : "DLC"} khác` : "";
      tauriAPI.adminApi.discordNotifySale({
        title: `🏷️ Sale mới: ${saleDesc}`,
        description: `**${res.updated} ${mode === "games" ? "game" : "DLC"}** đang được giảm giá!\n\n${names}${more}`,
        color: 0xf59e0b,
      }).catch(() => {});

      setSelected(new Set());
      refresh();
    } catch (e) { showToast(typeof e === "string" ? e : "Lỗi áp dụng sale"); }
    finally { setApplying(false); }
  };

  const handleRemoveSale = async () => {
    if (selected.size === 0) { showToast(`Chưa chọn ${mode === "games" ? "game" : "DLC"} nào`); return; }
    if (!confirm(`Gỡ sale cho ${selected.size} ${mode === "games" ? "game" : "DLC"}?`)) return;
    setApplying(true);
    try {
      const ids = Array.from(selected);
      const res = mode === "games"
        ? await tauriAPI.adminApi.removeSale(ids)
        : await tauriAPI.adminApi.removeSaleDlc(ids);
      showToast(`✅ Đã gỡ sale cho ${res.updated} ${mode === "games" ? "game" : "DLC"}`);
      setSelected(new Set());
      refresh();
    } catch (e) { showToast(typeof e === "string" ? e : "Lỗi gỡ sale"); }
    finally { setApplying(false); }
  };

  const saleLabel = { percent: "% giảm", fixed_price: "Giá còn lại (₫)", fixed_amount: "Giảm số tiền (₫)" };
  const labelItem = mode === "games" ? "game" : "DLC";

  return (
    <div>
      {toast && (
        <div style={{ position: "fixed", bottom: 20, right: 20, background: "rgba(22,27,34,0.98)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "10px 16px", color: "#fff", zIndex: 9998, fontSize: 13 }}>
          {toast}
        </div>
      )}

      {/* Mode tabs: Games / DLCs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          className={`admin-btn${mode === "games" ? " primary" : ""}`}
          onClick={() => setMode("games")}
        >
          🎮 Sale cho Game
        </button>
        <button
          className={`admin-btn${mode === "dlcs" ? " primary" : ""}`}
          onClick={() => setMode("dlcs")}
        >
          🧩 Sale cho DLC
        </button>
      </div>

      {/* Sale controls */}
      <div className="admin-section" style={{ marginBottom: 16, padding: 16 }}>
        <div className="admin-section-title">Áp dụng sale cho {selected.size > 0 ? `${selected.size} ${labelItem} đã chọn` : `${labelItem} được chọn`}</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          {/* Sale type */}
          <div className="admin-field" style={{ minWidth: 180 }}>
            <label>Kiểu giảm giá</label>
            <select className="admin-select" value={saleType} onChange={e => setSaleType(e.target.value as SaleType)}>
              <option value="percent">Giảm theo % (VD: 20 = giảm 20%)</option>
              <option value="fixed_price">Giá còn lại (VD: 150000 ₫)</option>
              <option value="fixed_amount">Giảm số tiền (VD: 50000 ₫)</option>
            </select>
          </div>
          {/* Sale value */}
          <div className="admin-field" style={{ minWidth: 140 }}>
            <label>{saleLabel[saleType]}</label>
            <input className="admin-input" type="number" min={0} placeholder={saleType === "percent" ? "VD: 20" : "VD: 100000"}
              value={saleValue} onChange={e => setSaleValue(e.target.value)} />
          </div>
          {/* Date range */}
          <div className="admin-field" style={{ minWidth: 160 }}>
            <label>Bắt đầu (tùy chọn)</label>
            <input className="admin-input" type="datetime-local" value={saleStart} onChange={e => setSaleStart(e.target.value)} />
          </div>
          <div className="admin-field" style={{ minWidth: 160 }}>
            <label>Kết thúc (tùy chọn)</label>
            <input className="admin-input" type="datetime-local" value={saleEnd} onChange={e => setSaleEnd(e.target.value)} />
          </div>
          {/* Actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="admin-btn primary" onClick={handleApply} disabled={applying || selected.size === 0}>
              {applying ? "Đang xử lý..." : `🏷️ Áp dụng sale (${selected.size})`}
            </button>
            <button className="admin-btn danger" onClick={handleRemoveSale} disabled={applying || selected.size === 0}>
              Gỡ sale ({selected.size})
            </button>
          </div>
        </div>
      </div>

      {/* Item list */}
      <div className="admin-search-bar">
        <input className="admin-input" style={{ maxWidth: 280 }} placeholder="Tìm theo tên / AppID..." value={search} onChange={e => setSearch(e.target.value)} />
        <button className="admin-btn" onClick={refresh}>🔄</button>
        <span style={{ fontSize: 12, color: "#8f98a0" }}>{selected.size} đã chọn / {filtered.length} {labelItem}</span>
      </div>

      {loading ? <div className="admin-empty">Đang tải...</div> : (
        <div className="admin-section" style={{ padding: 0, overflow: "hidden" }}>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox"
                      checked={filtered.length > 0 && selected.size === filtered.length}
                      onChange={toggleAll}
                      style={{ cursor: "pointer" }}
                    />
                  </th>
                  <th>Ảnh</th><th>Tên {labelItem}</th><th>AppID</th>
                  <th>Giá hiện tại</th><th>Giá gốc</th><th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="admin-empty">Không có {labelItem}</td></tr>
                ) : filtered.map((g) => {
                  const id = String(g.id);
                  const appid = String(g.appid || "");
                  const img = (g.custom_image as string) || (g.header_image as string) || steamAppAssetUrl(appid, "header.jpg");
                  const isOnSale = Number(g.original_price || 0) > Number(g.price || 0);
                  const discountPct = isOnSale
                    ? Math.round(((Number(g.original_price) - Number(g.price)) / Number(g.original_price)) * 100)
                    : 0;

                  return (
                    <tr key={id} style={selected.has(id) ? { background: "rgba(59,130,246,0.08)" } : undefined}>
                      <td>
                        <input type="checkbox" checked={selected.has(id)} onChange={() => toggleSelect(id)} style={{ cursor: "pointer" }} />
                      </td>
                      <td><img src={img} className="game-thumb" alt="" onError={e => { (e.target as HTMLImageElement).src = DEFAULT_STEAM_BACKGROUND_URL; }} /></td>
                      <td style={{ color: "#fff", fontWeight: 600, maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {g.name || `${labelItem === "game" ? "Game" : "DLC"} ${appid}`}
                      </td>
                      <td style={{ fontFamily: "monospace", color: "#66c0f4" }}>{appid}</td>
                      <td style={{ color: isOnSale ? "#a4d007" : "#c7d5e0", fontWeight: 600 }}>
                        {Number(g.price) === 0 ? "Miễn phí" : formatMoney(Number(g.price))}
                      </td>
                      <td style={{ color: "#8f98a0", textDecoration: isOnSale ? "line-through" : "none" }}>
                        {isOnSale ? formatMoney(Number(g.original_price)) : "—"}
                      </td>
                      <td>
                        {isOnSale ? (
                          <span className="admin-badge" style={{ background: "rgba(164,208,7,0.15)", color: "#a4d007", border: "1px solid rgba(164,208,7,0.3)" }}>
                            SALE -{discountPct}%
                          </span>
                        ) : (
                          <span style={{ color: "#8f98a0", fontSize: 12 }}>Bình thường</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab() {
  const [downloadUrl, setDownloadUrl] = useState("");
  const [latestVersion, setLatestVersion] = useState("");
  const [minVersion, setMinVersion] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  useEffect(() => {
    (async () => {
      try {
        const res = await tauriAPI.adminApi.getAppSettings();
        if (res.success) {
          setDownloadUrl(res.settings.download_url??"");
          setLatestVersion(res.settings.latest_version??"");
          setMinVersion(res.settings.min_version??"");
        }
      } catch (_) {}
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await tauriAPI.adminApi.saveAppSettings({
        download_url: downloadUrl,
        latest_version: latestVersion,
        min_version: minVersion,
      });
      showToast("Đã lưu cài đặt");
      window.dispatchEvent(new Event("nyvexa:settings-saved"));
    }
    catch (e) { showToast(typeof e==="string"?e:"Lỗi lưu"); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="admin-empty">Đang tải...</div>;

  return (
    <div>
      {toast && <div style={{ position:"fixed",bottom:20,right:20,background:"rgba(22,27,34,0.98)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"10px 16px",color:"#fff",zIndex:9998,fontSize:13 }}>{toast}</div>}
      <div className="admin-section" style={{ maxWidth:520 }}>
        <div className="admin-section-title">Cài đặt cập nhật launcher</div>
        <div className="admin-form-grid cols-1" style={{ gap:14 }}>
          <div className="admin-field"><label>URL tải xuống</label><input className="admin-input" placeholder="https://..." value={downloadUrl} onChange={e=>setDownloadUrl(e.target.value)} /></div>
          <div className="admin-form-grid">
            <div className="admin-field"><label>Phiên bản mới nhất</label><input className="admin-input" placeholder="2.2.16" value={latestVersion} onChange={e=>setLatestVersion(e.target.value)} /></div>
            <div className="admin-field"><label>Phiên bản tối thiểu</label><input className="admin-input" placeholder="1.0.0" value={minVersion} onChange={e=>setMinVersion(e.target.value)} /></div>
          </div>
          <button className="admin-btn primary" onClick={handleSave} disabled={saving} style={{ maxWidth:160 }}>{saving?"Đang lưu...":"Lưu cài đặt"}</button>
        </div>
      </div>
      <div className="admin-section" style={{ maxWidth:520, marginTop:16 }}>
        <div className="admin-section-title">Discord Webhooks</div>
        <div style={{ fontSize:13, color:"#8f98a0", lineHeight:1.7 }}>
          Webhook URL được lưu trong file <code style={{ color:"#66c0f4" }}>.env</code> dưới dạng secret (không lưu vào DB).
          <br />
          Thêm vào file <code style={{ color:"#fde68a" }}>.env</code> (hoặc <code style={{ color:"#fde68a" }}>.env.enc</code>):
        </div>
        <div style={{ marginTop:10, background:"rgba(0,0,0,0.3)", borderRadius:6, padding:"10px 14px", fontFamily:"monospace", fontSize:12, color:"#a4d007" }}>
          DISCORD_WEBHOOK_NEW_GAME=https://discord.com/api/webhooks/...<br />
          DISCORD_WEBHOOK_SALE=https://discord.com/api/webhooks/...
        </div>
      </div>
    </div>
  );
}

// ─── Hubcap API Keys Tab ──────────────────────────────────────────────────────

function statusBadge(key: HubcapKey) {
  if (!key.is_active)
    return <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "rgba(107,114,128,0.2)", color: "#9ca3af", border: "1px solid rgba(107,114,128,0.3)" }}>Tắt</span>;
  if (key.is_locked)
    return <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}>Khoá (24h)</span>;
  return <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "rgba(34,197,94,0.15)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.3)" }}>Hoạt động</span>;
}

function formatExpiry(val?: string | null) {
  if (!val) return "—";
  try {
    return new Date(val).toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return val;
  }
}

function HubcapKeysTab() {
  const [keys, setKeys] = useState<HubcapKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ msg: "", type: "info" as "info" | "error" | "success" });
  const [showAdd, setShowAdd] = useState(false);
  const [addKey, setAddKey] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addOrder, setAddOrder] = useState("0");
  const [addSaving, setAddSaving] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkResults, setCheckResults] = useState<Record<string, HubcapKeyStats>>({});

  const showToast = (msg: string, type: "info" | "error" | "success" = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: "", type: "info" }), 4000);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await tauriAPI.hubcap.listKeys();
      setKeys(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      showToast(typeof e === "string" ? e : "Lỗi tải keys", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleAdd = async () => {
    if (!addKey.trim()) { showToast("Vui lòng nhập API key", "error"); return; }
    setAddSaving(true);
    try {
      await tauriAPI.hubcap.addKey({
        apiKey: addKey.trim(),
        label: addLabel.trim() || `Key ${keys.length + 1}`,
        sortOrder: Number(addOrder) || 0,
      });
      showToast("Đã thêm API key", "success");
      setAddKey(""); setAddLabel(""); setAddOrder("0");
      setShowAdd(false);
      refresh();
    } catch (e) {
      showToast(typeof e === "string" ? e : "Lỗi thêm key", "error");
    } finally {
      setAddSaving(false);
    }
  };

  const handleDelete = async (key: HubcapKey) => {
    if (!confirm(`Xóa key "${key.label || key.id}"?`)) return;
    try {
      await tauriAPI.hubcap.deleteKey(key.id);
      showToast("Đã xóa key", "success");
      refresh();
    } catch (e) {
      showToast(typeof e === "string" ? e : "Lỗi xóa", "error");
    }
  };

  const handleToggle = async (key: HubcapKey) => {
    try {
      await tauriAPI.hubcap.toggleKey(key.id, !key.is_active);
      showToast(key.is_active ? "Đã tắt key" : "Đã bật key", "success");
      refresh();
    } catch (e) {
      showToast(typeof e === "string" ? e : "Lỗi", "error");
    }
  };

  const handleCheckAll = async () => {
    setCheckingAll(true);
    const results: Record<string, HubcapKeyStats> = {};
    // Check each key via backend (only active key can be checked via checkActiveKeyStats)
    // For all keys we use checkKey directly — but we only have preview, not full key
    // So we check stats of the currently active key
    try {
      const res = await tauriAPI.hubcap.checkActiveKeyStats();
      if (res.stats) {
        // Map result to active key
        const activeKey = keys.find(k => k.is_active && !k.is_locked);
        if (activeKey) {
          results[activeKey.id] = res.stats;
        }
        if (res.exhausted && res.locked_key_id) {
          showToast(`Key bị khoá vì hết quota (${res.reason || "quota_exceeded"})`, "error");
          refresh();
        }
      }
    } catch (e) {
      showToast(typeof e === "string" ? e : "Lỗi kiểm tra", "error");
    }
    setCheckResults(results);
    setCheckingAll(false);
  };

  const lockedUntil = (key: HubcapKey) => {
    if (!key.locked_at) return null;
    try {
      const d = new Date(key.locked_at);
      d.setHours(d.getHours() + 24);
      return d.toLocaleString("vi-VN");
    } catch {
      return null;
    }
  };

  const toastColor = toast.type === "error" ? "#f87171" : toast.type === "success" ? "#4ade80" : "#93c5fd";

  return (
    <div>
      {toast.msg && (
        <div style={{ position: "fixed", bottom: 20, right: 20, background: "rgba(22,27,34,0.98)", border: `1px solid ${toastColor}33`, borderRadius: 8, padding: "10px 16px", color: toastColor, zIndex: 9998, fontSize: 13 }}>
          {toast.msg}
        </div>
      )}

      {/* Toolbar */}
      <div className="admin-search-bar" style={{ marginBottom: 16 }}>
        <button className="admin-btn primary" onClick={() => setShowAdd(v => !v)}>
          {showAdd ? "Ẩn form" : "+ Thêm key"}
        </button>
        <button className="admin-btn" onClick={handleCheckAll} disabled={checkingAll || keys.length === 0}>
          {checkingAll ? "Đang kiểm tra..." : "🔍 Kiểm tra key active"}
        </button>
        <button className="admin-btn" onClick={refresh}>🔄</button>
        <span style={{ fontSize: 12, color: "#8f98a0" }}>{keys.length} key</span>
      </div>

      {/* Lưu ý rotation */}
      <div style={{ fontSize: 12, color: "#8f98a0", background: "rgba(102,192,244,0.06)", border: "1px solid rgba(102,192,244,0.15)", borderRadius: 6, padding: "8px 12px", marginBottom: 16, lineHeight: 1.6 }}>
        <strong style={{ color: "#66c0f4" }}>Rotation logic:</strong> Key có <code style={{ color: "#fde68a" }}>sort_order</code> thấp nhất và đang hoạt động sẽ được dùng trước.
        Khi hết quota/ngày, key tự động bị khoá và chuyển sang key tiếp theo. Sau đúng 24h kể từ lúc khoá, key tự mở lại.
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="admin-section" style={{ marginBottom: 16, padding: 16 }}>
          <div className="admin-section-title">Thêm API Key mới</div>
          <div className="admin-form-grid cols-1" style={{ gap: 12 }}>
            <div className="admin-field">
              <label>API Key <span style={{ color: "#f87171" }}>*</span></label>
              <input
                className="admin-input"
                type="password"
                placeholder="Bearer token từ hubcapmanifest.com"
                value={addKey}
                onChange={e => setAddKey(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="admin-form-grid">
              <div className="admin-field">
                <label>Nhãn (tùy chọn)</label>
                <input
                  className="admin-input"
                  placeholder="Key chính, Key dự phòng 1..."
                  value={addLabel}
                  onChange={e => setAddLabel(e.target.value)}
                />
              </div>
              <div className="admin-field">
                <label>Thứ tự ưu tiên</label>
                <input
                  className="admin-input"
                  type="number"
                  min={0}
                  value={addOrder}
                  onChange={e => setAddOrder(e.target.value)}
                  title="Số thấp = ưu tiên dùng trước"
                />
                <div style={{ fontSize: 11, color: "#8f98a0", marginTop: 3 }}>Số thấp = dùng trước</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="admin-btn primary" onClick={handleAdd} disabled={addSaving || !addKey.trim()}>
                {addSaving ? "Đang lưu..." : "Thêm key"}
              </button>
              <button className="admin-btn" onClick={() => { setShowAdd(false); setAddKey(""); setAddLabel(""); }}>
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keys table */}
      {loading ? (
        <div className="admin-empty">Đang tải...</div>
      ) : keys.length === 0 ? (
        <div className="admin-empty">Chưa có API key nào. Thêm key để bắt đầu tải lua.</div>
      ) : (
        <div className="admin-section" style={{ padding: 0, overflow: "hidden" }}>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Nhãn</th>
                  <th>Key (preview)</th>
                  <th>Trạng thái</th>
                  <th>Kiểm tra</th>
                  <th>Khoá đến</th>
                  <th style={{ width: 140 }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key, idx) => {
                  const stats = checkResults[key.id];
                  const unlock = lockedUntil(key);
                  return (
                    <tr key={key.id} style={idx === 0 && key.is_active && !key.is_locked ? { background: "rgba(34,197,94,0.05)" } : undefined}>
                      <td style={{ color: "#8f98a0", textAlign: "center", fontWeight: 700 }}>{key.sort_order}</td>
                      <td style={{ color: "#fff", fontWeight: 600 }}>{key.label || `Key ${idx + 1}`}</td>
                      <td>
                        <code style={{ fontSize: 12, color: "#66c0f4", letterSpacing: "0.05em" }}>
                          {key.api_key_preview || "***"}
                        </code>
                      </td>
                      <td>{statusBadge(key)}</td>
                      <td>
                        {/* Chỉ hiện kết quả nếu đã check */}
                        {stats ? (
                          <div style={{ fontSize: 11, lineHeight: 1.5 }}>
                            {stats.alive ? (
                              <>
                                <div style={{ color: "#4ade80" }}>✅ Alive</div>
                                {stats.expires_at && <div style={{ color: "#8f98a0" }}>HH: {formatExpiry(stats.expires_at)}</div>}
                                {stats.daily_limit != null && (
                                  <div>
                                    <span style={{ color: "#fde68a" }}>{stats.used_today ?? 0}</span>
                                    <span style={{ color: "#8f98a0" }}> / {stats.daily_limit}</span>
                                    {stats.remaining != null && (
                                      <span style={{ color: stats.remaining <= 0 ? "#f87171" : "#4ade80", marginLeft: 4 }}>
                                        (còn {stats.remaining})
                                      </span>
                                    )}
                                  </div>
                                )}
                              </>
                            ) : (
                              <div style={{ color: "#f87171" }}>❌ Dead{stats.reason ? `: ${stats.reason}` : ""}</div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "#8f98a0", fontSize: 11 }}>—</span>
                        )}
                      </td>
                      <td style={{ fontSize: 11, color: "#f87171" }}>
                        {key.is_locked && unlock ? unlock : "—"}
                      </td>
                      <td>
                        <div className="admin-btn-row">
                          <button
                            className={`admin-btn${key.is_active ? "" : " success"}`}
                            onClick={() => handleToggle(key)}
                            style={{ fontSize: 11, padding: "3px 8px" }}
                          >
                            {key.is_active ? "Tắt" : "Bật"}
                          </button>
                          <button
                            className="admin-btn danger"
                            onClick={() => handleDelete(key)}
                            style={{ fontSize: 11, padding: "3px 8px" }}
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Discount Codes Tab ───────────────────────────────────────────────────────

interface DiscountCodeRow {
  id: string;
  code: string;
  name?: string | null;
  description?: string | null;
  type: "fixed" | "percent" | "deposit_fixed" | "deposit_percent";
  value: number;
  expires_at?: string | null;
  applies_to_sale: boolean;
  applies_to_all: boolean;
  applicable_game_ids?: string[] | null;
  min_price?: number | null;
  max_price?: number | null;
  max_uses?: number | null;
  current_uses: number;
  is_active: boolean;
  is_hidden?: boolean;
  created_at?: string;
}

const DISCOUNT_TYPE_LABELS: Record<DiscountCodeRow["type"], string> = {
  percent:         "Giảm % khi mua game/DLC",
  fixed:           "Giảm tiền cố định khi mua game/DLC",
  deposit_fixed:   "Giảm tiền cố định khi nạp",
  deposit_percent: "Giảm % khi nạp",
};

function formatExpiryLabel(iso?: string | null): string {
  if (!iso) return "Vô hạn";
  try { return new Date(iso).toLocaleString("vi-VN"); } catch { return String(iso); }
}

function isExpired(iso?: string | null): boolean {
  if (!iso) return false;
  try { return new Date(iso).getTime() < Date.now(); } catch { return false; }
}

function toLocalDatetimeInput(iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ""; }
}

interface DiscountFormState {
  code: string;
  name: string;
  description: string;
  type: DiscountCodeRow["type"];
  value: string;
  expiresAt: string;
  appliesToSale: boolean;
  appliesToAll: boolean;
  applicableGameIds: string[];
  minPrice: string;
  maxPrice: string;
  maxUses: string;
  isActive: boolean;
  isHidden: boolean;
}

const EMPTY_DISCOUNT_FORM: DiscountFormState = {
  code: "",
  name: "",
  description: "",
  type: "percent",
  value: "",
  expiresAt: "",
  appliesToSale: true,
  appliesToAll: true,
  applicableGameIds: [],
  minPrice: "",
  maxPrice: "",
  maxUses: "",
  isActive: true,
  isHidden: false,
};

function DiscountCodesTab() {
  const [codes, setCodes] = useState<DiscountCodeRow[]>([]);
  const [games, setGames] = useState<GameItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DiscountCodeRow | null>(null);
  const [form, setForm] = useState<DiscountFormState>(EMPTY_DISCOUNT_FORM);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [gamePickerOpen, setGamePickerOpen] = useState(false);
  const [gamePickerSearch, setGamePickerSearch] = useState("");
  const [selectedDiscountForUsers, setSelectedDiscountForUsers] = useState<DiscountCodeRow | null>(null);
  const [discountRedemptions, setDiscountRedemptions] = useState<Array<Record<string, unknown>>>([]);
  const [redemptionsLoading, setRedemptionsLoading] = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, gameList] = await Promise.all([
        tauriAPI.discount.adminList(),
        tauriAPI.adminApi.gamesList(),
      ]);
      const rows = (Array.isArray(list) ? list : []) as unknown as DiscountCodeRow[];
      setCodes(rows);
      setGames(Array.isArray(gameList) ? gameList : []);
    } catch (e) {
      console.error(e);
      showToast(typeof e === "string" ? e : "Lỗi tải mã giảm giá");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const resetForm = () => { setForm(EMPTY_DISCOUNT_FORM); setEditing(null); };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (row: DiscountCodeRow) => {
    setEditing(row);
    setForm({
      code: row.code,
      name: row.name || "",
      description: row.description || "",
      type: row.type,
      value: String(row.value ?? ""),
      expiresAt: toLocalDatetimeInput(row.expires_at),
      appliesToSale: !!row.applies_to_sale,
      appliesToAll: !!row.applies_to_all,
      applicableGameIds: Array.isArray(row.applicable_game_ids) ? row.applicable_game_ids : [],
      minPrice: row.min_price != null ? String(row.min_price) : "",
      maxPrice: row.max_price != null ? String(row.max_price) : "",
      maxUses: row.max_uses != null ? String(row.max_uses) : "",
      isActive: !!row.is_active,
      isHidden: !!row.is_hidden,
    });
    setShowForm(true);
  };

  const isDepositType = form.type === "deposit_fixed" || form.type === "deposit_percent";
  const isPercentType = form.type === "percent" || form.type === "deposit_percent";

  const handleSave = async () => {
    const code = form.code.trim().toUpperCase();
    if (!code) { showToast("Nhập mã code"); return; }
    const valueNum = Number(form.value);
    if (!Number.isFinite(valueNum) || valueNum <= 0) { showToast("Giá trị giảm không hợp lệ"); return; }
    if (isPercentType && valueNum > 100) { showToast("% giảm phải <= 100"); return; }

    const minPriceNum = form.minPrice.trim() === "" ? null : Number(form.minPrice);
    const maxPriceNum = form.maxPrice.trim() === "" ? null : Number(form.maxPrice);
    if (minPriceNum != null && (!Number.isFinite(minPriceNum) || minPriceNum < 0)) { showToast("Giá tối thiểu không hợp lệ"); return; }
    if (maxPriceNum != null && (!Number.isFinite(maxPriceNum) || maxPriceNum < 0)) { showToast("Giá tối đa không hợp lệ"); return; }
    if (minPriceNum != null && maxPriceNum != null && maxPriceNum < minPriceNum) { showToast("Giá tối đa phải >= Giá tối thiểu"); return; }

    const maxUsesNum = form.maxUses.trim() === "" ? null : parseInt(form.maxUses, 10);
    if (maxUsesNum != null && (!Number.isFinite(maxUsesNum) || maxUsesNum <= 0)) { showToast("Số lần dùng phải > 0"); return; }

    let expiresIso: string | null = null;
    if (form.expiresAt.trim() !== "") {
      const t = new Date(form.expiresAt);
      if (Number.isNaN(t.getTime())) { showToast("Ngày hết hạn không hợp lệ"); return; }
      expiresIso = t.toISOString();
    }

    // Deposit codes: chỉ có value + max_uses + expires + active. Bỏ qua sale / game / min-max-price.
    const payload: Record<string, unknown> = isDepositType
      ? {
          code,
          name: form.name.trim() || null,
          description: form.description.trim() || null,
          type: form.type,
          value: valueNum,
          expires_at: expiresIso,
          max_uses: maxUsesNum,
          applies_to_sale: true,
          applies_to_all: true,
          applicable_game_ids: null,
          min_price: null,
          max_price: null,
          is_active: form.isActive,
          is_hidden: form.isHidden,
        }
      : {
          code,
          name: form.name.trim() || null,
          description: form.description.trim() || null,
          type: form.type,
          value: valueNum,
          expires_at: expiresIso,
          applies_to_sale: form.appliesToSale,
          applies_to_all: form.appliesToAll,
          applicable_game_ids: form.appliesToAll ? null : form.applicableGameIds,
          min_price: minPriceNum,
          max_price: maxPriceNum,
          max_uses: maxUsesNum,
          is_active: form.isActive,
          is_hidden: form.isHidden,
        };

    if (!isDepositType && !form.appliesToAll && form.applicableGameIds.length === 0) {
      showToast("Chọn ít nhất 1 game khi không áp dụng cho tất cả");
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await tauriAPI.discount.adminUpdate(editing.id, payload);
        showToast("Đã cập nhật mã");
      } else {
        await tauriAPI.discount.adminCreate(payload);
        showToast("Đã tạo mã");
        // Thông báo Discord về voucher mới (chỉ khi tạo mới + đang active + không ẩn)
        if (form.isActive && !form.isHidden) {
          const valueDesc = isPercentType ? `giảm ${valueNum}%` : `giảm ${formatMoney(valueNum)}`;
          const scopeDesc = isDepositType ? "khi nạp tiền" : "khi mua game/DLC";
          tauriAPI.adminApi.discordNotifySale({
            title: `🎟️ Voucher mới: ${code}`,
            description: `Mã **${code}** — ${valueDesc} ${scopeDesc}${form.name.trim() ? `\n${form.name.trim()}` : ""}`,
            color: 0xa4d007,
          }).catch(() => {});
        }
      }
      setShowForm(false);
      resetForm();
      refresh();
    } catch (e) {
      showToast(typeof e === "string" ? e : "Lỗi lưu mã");
    } finally { setSaving(false); }
  };

  const handleDelete = async (row: DiscountCodeRow) => {
    if (!confirm(`Xóa mã "${row.code}"?`)) return;
    try {
      await tauriAPI.discount.adminDelete(row.id);
      showToast("Đã xóa");
      refresh();
    } catch (e) {
      showToast(typeof e === "string" ? e : "Lỗi xóa");
    }
  };

  const handleToggleActive = async (row: DiscountCodeRow) => {
    try {
      await tauriAPI.discount.adminUpdate(row.id, { is_active: !row.is_active });
      refresh();
    } catch (e) {
      showToast(typeof e === "string" ? e : "Lỗi");
    }
  };

  const openRedemptions = async (row: DiscountCodeRow) => {
    setSelectedDiscountForUsers(row);
    setRedemptionsLoading(true);
    try {
      const res = await tauriAPI.adminApi.discountRedemptions(row.id);
      setDiscountRedemptions(res.success ? res.data : []);
    } catch { setDiscountRedemptions([]); }
    finally { setRedemptionsLoading(false); }
  };

  const filtered = codes.filter(c => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (c.code || "").toLowerCase().includes(q)
      || (c.name || "").toLowerCase().includes(q);
  });

  const filteredGames = games.filter(g => {
    const q = gamePickerSearch.trim().toLowerCase();
    if (!q) return true;
    return (g.name || "").toLowerCase().includes(q) || String(g.appid).includes(q);
  });

  const toggleGameId = (gid: string) => {
    setForm(f => ({
      ...f,
      applicableGameIds: f.applicableGameIds.includes(gid)
        ? f.applicableGameIds.filter(x => x !== gid)
        : [...f.applicableGameIds, gid],
    }));
  };

  return (
    <div>
      {toast && (
        <div style={{ position: "fixed", bottom: 20, right: 20, background: "rgba(22,27,34,0.98)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "10px 16px", color: "#fff", zIndex: 9998, fontSize: 13 }}>
          {toast}
        </div>
      )}

      <div className="admin-search-bar" style={{ marginBottom: 16 }}>
        <input className="admin-input" style={{ maxWidth: 280 }} placeholder="Tìm theo code / tên..." value={search} onChange={e => setSearch(e.target.value)} />
        <button className="admin-btn primary" onClick={openCreate}>+ Tạo mã giảm giá</button>
        <button className="admin-btn" onClick={refresh}>🔄</button>
        <span style={{ fontSize: 12, color: "#8f98a0" }}>{codes.length} mã</span>
      </div>

      <div style={{ fontSize: 12, color: "#8f98a0", background: "rgba(102,192,244,0.06)", border: "1px solid rgba(102,192,244,0.15)", borderRadius: 6, padding: "8px 12px", marginBottom: 16, lineHeight: 1.6 }}>
        <strong style={{ color: "#66c0f4" }}>Hỗ trợ 4 loại mã:</strong> giảm % hoặc tiền cố định khi mua game/DLC, và giảm % hoặc tiền cố định khi nạp ví.
        Mã có thể giới hạn số lần dùng, thời hạn, khoảng giá game, danh sách game áp dụng và có cho phép dùng cho game đang sale hay không.
      </div>

      {/* Form */}
      {showForm && (
        <div className="admin-section" style={{ marginBottom: 20, padding: 16 }}>
          <div className="admin-section-title">{editing ? `Sửa mã ${editing.code}` : "Tạo mã giảm giá mới"}</div>

          <div className="admin-form-grid" style={{ gap: 12 }}>
            <div className="admin-field">
              <label>Code <span style={{ color: "#f87171" }}>*</span></label>
              <input
                className="admin-input"
                placeholder="VD: SALE10, NAPGIAM50K"
                value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                disabled={!!editing}
                style={{ textTransform: "uppercase", fontFamily: "monospace" }}
              />
            </div>
            <div className="admin-field">
              <label>Tên hiển thị</label>
              <input className="admin-input" placeholder="VD: Giảm 10% Tết" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
          </div>

          <div className="admin-field" style={{ marginTop: 10 }}>
            <label>Mô tả</label>
            <input className="admin-input" placeholder="Mô tả ngắn về mã" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="admin-form-grid" style={{ gap: 12, marginTop: 10 }}>
            <div className="admin-field">
              <label>Loại mã <span style={{ color: "#f87171" }}>*</span></label>
              <select
                className="admin-select"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as DiscountCodeRow["type"] }))}
              >
                <option value="percent">Giảm % khi mua game/DLC</option>
                <option value="fixed">Giảm tiền cố định khi mua game/DLC</option>
                <option value="deposit_percent">Giảm % khi nạp tiền</option>
                <option value="deposit_fixed">Giảm tiền cố định khi nạp tiền</option>
              </select>
            </div>
            <div className="admin-field">
              <label>
                Giá trị {isPercentType ? "(%)" : "(₫)"} <span style={{ color: "#f87171" }}>*</span>
              </label>
              <input
                className="admin-input"
                type="number"
                min={0}
                max={isPercentType ? 100 : undefined}
                placeholder={isPercentType ? "VD: 10 = giảm 10%" : "VD: 50000"}
                value={form.value}
                onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
              />
            </div>
          </div>

          <div className="admin-form-grid" style={{ gap: 12, marginTop: 10 }}>
            <div className="admin-field">
              <label>Hết hạn</label>
              <input
                className="admin-input"
                type="datetime-local"
                value={form.expiresAt}
                onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
              />
              <div style={{ fontSize: 11, color: "#8f98a0", marginTop: 3 }}>Để trống = vô hạn</div>
            </div>
            <div className="admin-field">
              <label>Số lần dùng tối đa</label>
              <input
                className="admin-input"
                type="number"
                min={1}
                placeholder="Để trống = vô hạn"
                value={form.maxUses}
                onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))}
              />
            </div>
          </div>

          {!isDepositType && (
            <>
              <div className="admin-form-grid" style={{ gap: 12, marginTop: 10 }}>
                <div className="admin-field">
                  <label>Áp dụng cho game có giá từ (₫)</label>
                  <input
                    className="admin-input"
                    type="number"
                    min={0}
                    placeholder="Không giới hạn"
                    value={form.minPrice}
                    onChange={e => setForm(f => ({ ...f, minPrice: e.target.value }))}
                  />
                </div>
                <div className="admin-field">
                  <label>Đến (₫)</label>
                  <input
                    className="admin-input"
                    type="number"
                    min={0}
                    placeholder="Không giới hạn"
                    value={form.maxPrice}
                    onChange={e => setForm(f => ({ ...f, maxPrice: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#c7d5e0", cursor: "pointer", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={form.appliesToSale}
                    onChange={e => setForm(f => ({ ...f, appliesToSale: e.target.checked }))}
                  />
                  Cho phép dùng cùng lúc với game đang sale
                  <span style={{ fontSize: 11, color: "#8f98a0", marginLeft: 4 }}>
                    (bỏ chọn = game đang sale sẽ không dùng được mã này)
                  </span>
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#c7d5e0", cursor: "pointer", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={form.appliesToAll}
                    onChange={e => setForm(f => ({ ...f, appliesToAll: e.target.checked }))}
                  />
                  Áp dụng cho tất cả game/DLC
                </label>

                {!form.appliesToAll && (
                  <div className="admin-section" style={{ padding: 12, marginBottom: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: "#c7d5e0" }}>
                        Đã chọn <strong style={{ color: "#66c0f4" }}>{form.applicableGameIds.length}</strong> game
                      </div>
                      <button type="button" className="admin-btn" onClick={() => setGamePickerOpen(v => !v)}>
                        {gamePickerOpen ? "Đóng danh sách" : "Chọn game"}
                      </button>
                    </div>

                    {gamePickerOpen && (
                      <div>
                        <input
                          className="admin-input"
                          placeholder="Tìm game..."
                          value={gamePickerSearch}
                          onChange={e => setGamePickerSearch(e.target.value)}
                          style={{ marginBottom: 8 }}
                        />
                        <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: 6 }}>
                          {filteredGames.length === 0 ? (
                            <div style={{ color: "#8f98a0", fontSize: 12, padding: 8 }}>Không có game nào</div>
                          ) : filteredGames.map(g => {
                            const gid = String(g.id || "");
                            const checked = form.applicableGameIds.includes(gid);
                            return (
                              <label key={gid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", cursor: "pointer", fontSize: 12, color: "#c7d5e0", borderRadius: 4, background: checked ? "rgba(102,192,244,0.08)" : "transparent" }}>
                                <input type="checkbox" checked={checked} onChange={() => toggleGameId(gid)} />
                                <span style={{ color: "#66c0f4", fontFamily: "monospace", minWidth: 70 }}>{String(g.appid || "")}</span>
                                <span style={{ flex: 1 }}>{g.name || "—"}</span>
                                <span style={{ color: "#8f98a0" }}>{Number(g.price || 0) === 0 ? "Free" : formatMoney(Number(g.price))}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          <div style={{ marginTop: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#c7d5e0", cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
              />
              Kích hoạt mã ngay
            </label>
          </div>

          <div style={{ marginTop: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#c7d5e0", cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.isHidden}
                onChange={e => setForm(f => ({ ...f, isHidden: e.target.checked }))}
              />
              Ẩn khỏi danh sách mã có sẵn
              <span style={{ fontSize: 11, color: "#8f98a0", marginLeft: 4 }}>(user vẫn dùng được khi nhập thủ công)</span>
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="admin-btn primary" onClick={handleSave} disabled={saving}>
              {saving ? "Đang lưu..." : (editing ? "Cập nhật" : "Tạo mã")}
            </button>
            <button className="admin-btn" onClick={() => { setShowForm(false); resetForm(); }}>Hủy</button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="admin-empty">Đang tải...</div>
      ) : filtered.length === 0 ? (
        <div className="admin-empty">{search ? "Không tìm thấy mã phù hợp" : "Chưa có mã giảm giá nào. Bấm \"+ Tạo mã giảm giá\" để bắt đầu."}</div>
      ) : (
        <div className="admin-section" style={{ padding: 0, overflow: "hidden" }}>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Loại</th>
                  <th>Giá trị</th>
                  <th>Phạm vi</th>
                  <th>Khoảng giá</th>
                  <th>Lượt dùng</th>
                  <th>Hết hạn</th>
                  <th>Trạng thái</th>
                  <th>Ẩn</th>
                  <th>Theo dõi</th>
                  <th style={{ width: 160 }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => {
                  const expired = isExpired(row.expires_at);
                  const exhausted = row.max_uses != null && row.current_uses >= row.max_uses;
                  const isDeposit = row.type === "deposit_fixed" || row.type === "deposit_percent";
                  const isPercent = row.type === "percent" || row.type === "deposit_percent";
                  return (
                    <tr key={row.id}>
                      <td>
                        <div style={{ fontFamily: "monospace", color: "#66c0f4", fontWeight: 700, fontSize: 13 }}>{row.code}</div>
                        {row.name && <div style={{ fontSize: 11, color: "#8f98a0" }}>{row.name}</div>}
                      </td>
                      <td style={{ fontSize: 12, color: "#c7d5e0" }}>{DISCOUNT_TYPE_LABELS[row.type]}</td>
                      <td style={{ fontWeight: 700, color: "#a4d007" }}>
                        {isPercent ? `-${row.value}%` : `-${formatMoney(Number(row.value))}`}
                      </td>
                      <td style={{ fontSize: 12, color: "#c7d5e0" }}>
                        {isDeposit ? (
                          <span>Nạp ví</span>
                        ) : (
                          <>
                            <div>{row.applies_to_all ? "Tất cả game/DLC" : `${(row.applicable_game_ids || []).length} game cụ thể`}</div>
                            <div style={{ fontSize: 11, color: row.applies_to_sale ? "#4ade80" : "#fbbf24" }}>
                              {row.applies_to_sale ? "✓ Cho game đang sale" : "✗ Không cho game đang sale"}
                            </div>
                          </>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: "#8f98a0" }}>
                        {isDeposit ? "—" : (
                          row.min_price == null && row.max_price == null
                            ? "Mọi giá"
                            : `${row.min_price != null ? formatMoney(Number(row.min_price)) : "0"} → ${row.max_price != null ? formatMoney(Number(row.max_price)) : "∞"}`
                        )}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        <span style={{ color: exhausted ? "#f87171" : "#c7d5e0", fontWeight: 600 }}>{row.current_uses}</span>
                        <span style={{ color: "#8f98a0" }}> / {row.max_uses != null ? row.max_uses : "∞"}</span>
                      </td>
                      <td style={{ fontSize: 12, color: expired ? "#f87171" : "#c7d5e0" }}>{formatExpiryLabel(row.expires_at)}</td>
                      <td>
                        {!row.is_active ? (
                          <span className="admin-badge" style={{ background: "rgba(143,152,160,0.15)", color: "#8f98a0", border: "1px solid rgba(143,152,160,0.3)" }}>Tắt</span>
                        ) : expired ? (
                          <span className="admin-badge" style={{ background: "rgba(248,113,113,0.15)", color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" }}>Hết hạn</span>
                        ) : exhausted ? (
                          <span className="admin-badge" style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" }}>Hết lượt</span>
                        ) : (
                          <span className="admin-badge" style={{ background: "rgba(74,222,128,0.15)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.3)" }}>Đang chạy</span>
                        )}
                      </td>
                      <td>
                        {row.is_hidden ? (
                          <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "rgba(143,152,160,0.2)", color: "#8f98a0", border: "1px solid rgba(143,152,160,0.3)" }}>👁️ Ẩn</span>
                        ) : null}
                      </td>
                      <td>
                        <button className="admin-btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => openRedemptions(row)}>👥 Dùng mã</button>
                      </td>
                      <td>
                        <div className="admin-btn-row">
                          <button className="admin-btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => openEdit(row)}>Sửa</button>
                          <button className={`admin-btn${row.is_active ? "" : " success"}`} style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => handleToggleActive(row)}>
                            {row.is_active ? "Tắt" : "Bật"}
                          </button>
                          <button className="admin-btn danger" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => handleDelete(row)}>Xóa</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Redemptions modal */}
      {selectedDiscountForUsers && (
        <div
          onClick={e => e.target === e.currentTarget && setSelectedDiscountForUsers(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}
        >
          <div className="admin-modal" style={{ minWidth: 600, maxWidth: 760, maxHeight: "80vh", overflowY: "auto" }}>
            <div className="admin-modal-head">
              <span>Lịch sử dùng mã <strong style={{ color: "#66c0f4", fontFamily: "monospace", letterSpacing: 2 }}>{selectedDiscountForUsers.code}</strong></span>
              <button className="admin-btn" onClick={() => setSelectedDiscountForUsers(null)}>Đóng</button>
            </div>
            <div className="admin-modal-body">
              {redemptionsLoading ? (
                <div style={{ color: "#8f98a0", textAlign: "center", padding: 20 }}>Đang tải...</div>
              ) : discountRedemptions.length === 0 ? (
                <div className="admin-empty">Chưa có lượt dùng nào.</div>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Username</th>
                        <th>Loại đơn</th>
                        <th>Số tiền đơn</th>
                        <th>Giảm giá</th>
                        <th>Game / Đơn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discountRedemptions.map((r, i) => (
                        <tr key={String(r.id || i)}>
                          <td style={{ color: "#66c0f4" }}>{String(r.username || r.user_id || "—")}</td>
                          <td style={{ fontSize: 12, color: "#c7d5e0" }}>{String(r.order_type || "—")}</td>
                          <td style={{ color: "#c7d5e0" }}>{formatMoney(Number(r.order_amount || 0))}</td>
                          <td style={{ color: "#a4d007" }}>-{formatMoney(Number(r.discount_amount || 0))}</td>
                          <td style={{ fontSize: 12, color: "#c7d5e0" }}>{String(r.game_name || r.order_id || "—")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="admin-modal-foot">
              <button className="admin-btn" onClick={() => setSelectedDiscountForUsers(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Balance Logs Tab ─────────────────────────────────────────────────────────

function BalanceLogsTab() {
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [detailLog, setDetailLog] = useState<Record<string, unknown> | null>(null);
  const [detailData, setDetailData] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const LIMIT = 50;

  const loadLogs = useCallback(async (reset = false, off = 0) => {
    setLoading(true);
    try {
      const res = await tauriAPI.adminApi.balanceLogsV2({
        limit: LIMIT,
        offset: reset ? 0 : off,
      });
      const rows = res.success ? res.data : [];
      if (reset) {
        setLogs(rows);
        setOffset(rows.length);
      } else {
        setLogs(prev => [...prev, ...rows]);
        setOffset(off + rows.length);
      }
      setHasMore(rows.length >= LIMIT);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadLogs(true); }, [loadLogs]);

  const openDetail = async (log: Record<string, unknown>) => {
    setDetailLog(log);
    setDetailData(null);
    setDetailLoading(true);
    try {
      const res = await tauriAPI.adminApi.balanceLogDetail(String(log.id || ""));
      setDetailData(res);
    } catch { setDetailData(null); }
    finally { setDetailLoading(false); }
  };

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        <button className="admin-btn" onClick={() => loadLogs(true)}>🔄 Làm mới</button>
        <span style={{ fontSize: 12, color: "#8f98a0" }}>{logs.length} bản ghi</span>
      </div>

      {loading && logs.length === 0 ? (
        <div className="admin-empty">Đang tải...</div>
      ) : logs.length === 0 ? (
        <div className="admin-empty">Chưa có log biến động số dư nào.</div>
      ) : (
        <div className="admin-section" style={{ padding: 0, overflow: "hidden" }}>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>User</th>
                  <th>Biến động</th>
                  <th>Trước</th>
                  <th>Sau</th>
                  <th>Kiểm tra</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => {
                  const amount = Number(log.amount || 0);
                  const before = Number(log.balance_before || 0);
                  const after = Number(log.balance_after || 0);
                  const profile = log.profiles as Record<string, unknown> | undefined;
                  const userName = String(profile?.display_name || profile?.username || profile?.email || log.user_id || "");
                  return (
                    <tr key={String(log.id || i)}>
                      <td style={{ fontSize: 11, color: "#8f98a0", whiteSpace: "nowrap" }}>
                        {log.created_at ? new Date(String(log.created_at)).toLocaleString("vi-VN") : "—"}
                      </td>
                      <td style={{ color: "#c7d5e0", fontSize: 12, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {userName}
                      </td>
                      <td style={{ fontWeight: 700, color: amount >= 0 ? "#4ade80" : "#f87171" }}>
                        {amount >= 0 ? "+" : ""}{formatMoney(amount)}
                      </td>
                      <td style={{ color: "#8f98a0", fontSize: 12 }}>{formatMoney(before)}</td>
                      <td style={{ color: "#c7d5e0", fontSize: 12, fontWeight: 600 }}>{formatMoney(after)}</td>
                      <td>
                        <button className="admin-btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => openDetail(log)}>Kiểm tra</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div style={{ padding: 12, textAlign: "center" }}>
              <button className="admin-btn" onClick={() => loadLogs(false, offset)} disabled={loading}>
                {loading ? "Đang tải..." : "Tải thêm"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Detail modal */}
      {detailLog && (
        <div
          onClick={e => e.target === e.currentTarget && setDetailLog(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}
        >
          <div className="admin-modal" style={{ minWidth: 440, maxWidth: 580, maxHeight: "80vh", overflowY: "auto" }}>
            <div className="admin-modal-head">
              <span>Chi tiết giao dịch</span>
              <button className="admin-btn" onClick={() => setDetailLog(null)}>Đóng</button>
            </div>
            <div className="admin-modal-body">
              {detailLoading ? (
                <div style={{ color: "#8f98a0", textAlign: "center", padding: 20 }}>Đang tải...</div>
              ) : (
                <BalanceLogDetailBody detailLog={detailLog} detailData={detailData} />
              )}
            </div>
            <div className="admin-modal-foot">
              <button className="admin-btn" onClick={() => setDetailLog(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Avatars Tab ──────────────────────────────────────────────────────────────

interface AvatarRow {
  id: string;
  name: string;
  image_url: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

function AvatarsTab() {
  const [avatars, setAvatars] = useState<AvatarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newOrder, setNewOrder] = useState("0");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await tauriAPI.avatar.adminList();
      setAvatars(Array.isArray(list) ? list as unknown as AvatarRow[] : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { showToast("File >5MB"); e.target.value = ""; return; }
    if (!["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"].includes(f.type)) {
      showToast("Chỉ hỗ trợ PNG/JPG/GIF/WEBP"); e.target.value = ""; return;
    }
    setNewFile(f);
  };

  const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const handleAdd = async () => {
    if (!newName.trim()) { showToast("Nhập tên avatar"); return; }
    if (!newFile) { showToast("Chọn file ảnh"); return; }
    setSaving(true);
    try {
      const base64 = await fileToBase64(newFile);
      await tauriAPI.avatar.adminUpload({
        name: newName.trim(),
        imageData: base64,
        mimeType: newFile.type,
        sortOrder: Number(newOrder) || 0,
      });
      showToast("Đã thêm avatar");
      setNewName(""); setNewFile(null); setNewOrder("0");
      setShowForm(false);
      refresh();
    } catch (e) { showToast(typeof e === "string" ? e : "Lỗi upload"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (av: AvatarRow) => {
    if (!confirm(`Xóa avatar "${av.name}"?`)) return;
    try {
      await tauriAPI.avatar.adminDelete(av.id, av.name);
      showToast("Đã xóa");
      refresh();
    } catch (e) { showToast(typeof e === "string" ? e : "Lỗi xóa"); }
  };

  // Đổi vị trí avatar (lên/xuống) rồi ghi lại sort_order tuần tự
  const handleMove = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= avatars.length) return;
    const next = [...avatars];
    [next[index], next[target]] = [next[target], next[index]];
    // Gán lại sort_order theo vị trí mới (0,1,2,...) — cập nhật UI ngay
    const reordered = next.map((a, i) => ({ ...a, sort_order: i }));
    setAvatars(reordered);
    try {
      await tauriAPI.avatar.adminReorder(reordered.map(a => ({ id: a.id, sort_order: a.sort_order })));
    } catch (e) {
      showToast(typeof e === "string" ? e : "Lỗi lưu thứ tự");
      refresh(); // rollback từ DB nếu lỗi
    }
  };

  const previewUrl = newFile ? URL.createObjectURL(newFile) : "";

  return (
    <div>
      {toast && (
        <div style={{ position: "fixed", bottom: 20, right: 20, background: "rgba(22,27,34,0.98)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "10px 16px", color: "#fff", zIndex: 9998, fontSize: 13 }}>
          {toast}
        </div>
      )}

      <div className="admin-search-bar" style={{ marginBottom: 16 }}>
        <button className="admin-btn primary" onClick={() => setShowForm(v => !v)}>
          {showForm ? "Ẩn form" : "+ Upload avatar"}
        </button>
        <button className="admin-btn" onClick={refresh}>🔄</button>
        <span style={{ fontSize: 12, color: "#8f98a0" }}>{avatars.length} avatar</span>
      </div>

      {showForm && (
        <div className="admin-section" style={{ marginBottom: 16, padding: 16 }}>
          <div className="admin-section-title">Upload Avatar mới</div>
          <div className="admin-form-grid" style={{ gap: 12 }}>
            <div className="admin-field">
              <label>Tên (unique, không dấu)</label>
              <input className="admin-input" placeholder="VD: warrior" value={newName} onChange={e => setNewName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))} />
            </div>
            <div className="admin-field">
              <label>Thứ tự hiển thị</label>
              <input className="admin-input" type="number" value={newOrder} onChange={e => setNewOrder(e.target.value)} style={{ maxWidth: 100 }} />
            </div>
          </div>
          <div className="admin-field" style={{ marginTop: 10 }}>
            <label>File ảnh (PNG/JPG, max 5MB)</label>
            <input type="file" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp" onChange={handleFileSelect} style={{ color: "#c7d5e0", fontSize: 12 }} />
            {previewUrl && (
              <div style={{ marginTop: 10 }}>
                <img src={previewUrl} alt="preview" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(255,255,255,0.15)" }} />
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="admin-btn primary" onClick={handleAdd} disabled={saving || !newName.trim() || !newFile}>
              {saving ? "Đang upload..." : "Upload"}
            </button>
            <button className="admin-btn" onClick={() => setShowForm(false)}>Hủy</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="admin-empty">Đang tải...</div>
      ) : avatars.length === 0 ? (
        <div className="admin-empty">Chưa có avatar nào. Bấm "+ Upload avatar" để bắt đầu.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {avatars.map((av, i) => (
            <div key={av.id} className="admin-section" style={{ padding: 14, textAlign: "center" }}>
              <img
                src={av.image_url}
                alt={av.name}
                style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", border: "3px solid rgba(255,255,255,0.12)", marginBottom: 8 }}
                onError={e => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
              />
              <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{av.name}</div>
              <div style={{ fontSize: 11, color: "#8f98a0", marginBottom: 8 }}>#{av.sort_order}</div>
              <div style={{ display: "flex", justifyContent: "center", gap: 6, alignItems: "center" }}>
                <button
                  className="admin-btn"
                  style={{ fontSize: 13, padding: "3px 9px", opacity: i === 0 ? 0.35 : 1 }}
                  disabled={i === 0}
                  title="Lên trước"
                  onClick={() => handleMove(i, -1)}
                >↑</button>
                <button
                  className="admin-btn"
                  style={{ fontSize: 13, padding: "3px 9px", opacity: i === avatars.length - 1 ? 0.35 : 1 }}
                  disabled={i === avatars.length - 1}
                  title="Xuống sau"
                  onClick={() => handleMove(i, 1)}
                >↓</button>
                <button className="admin-btn danger" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => handleDelete(av)}>Xóa</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Referral Admin Tab ───────────────────────────────────────────────────────

interface ReferralCodeRow {
  id: string;
  code: string;
  total_uses: number;
  total_earned: number;
  user_id: string;
  created_at: string;
  username?: string;
}

interface ReferralUseRow {
  id: string;
  buyer_user_id: string;
  game_name: string;
  order_amount: number;
  discount_percent: number;
  discount_amount: number;
  commission_amount: number;
  created_at: string;
  username?: string;
  display_name?: string;
}

function ReferralAdminTab() {
  const [codes, setCodes] = useState<ReferralCodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Detail modal
  const [selectedCode, setSelectedCode] = useState<ReferralCodeRow | null>(null);
  const [uses, setUses] = useState<ReferralUseRow[]>([]);
  const [usesLoading, setUsesLoading] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await tauriAPI.referral.adminList();
      if (res.success) setCodes(res.data as ReferralCodeRow[]);
      else setError("Không tải được danh sách mã.");
    } catch (e) {
      setError((e as Error)?.message || "Lỗi tải dữ liệu.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const openDetail = async (code: ReferralCodeRow) => {
    setSelectedCode(code);
    setUsesLoading(true);
    try {
      const res = await tauriAPI.referral.adminUses(code.id);
      if (res.success) setUses(res.data as ReferralUseRow[]);
    } catch (_) {
      setUses([]);
    } finally {
      setUsesLoading(false);
    }
  };

  const handleReset = async () => {
    if (!selectedCode) return;
    if (!window.confirm(`Reset số tiền kiếm được của @${selectedCode.username || selectedCode.user_id}?`)) return;
    setResetting(true);
    try {
      await tauriAPI.referral.adminResetEarned(selectedCode.id);
      await load();
      setSelectedCode(null);
    } catch (e) {
      alert((e as Error)?.message || "Lỗi reset.");
    } finally {
      setResetting(false);
    }
  };

  const tierLabel = (uses: number) => uses >= 50 ? "Cấp 3 (25%)" : uses >= 20 ? "Cấp 2 (20%)" : "Cấp 1 (15%)";
  const tierColor = (uses: number) => uses >= 50 ? "#a4d007" : uses >= 20 ? "#66c0f4" : "#8f98a0";

  return (
    <div className="admin-section">
      <div className="admin-section-title">🎁 Quản lý Mã Giới Thiệu</div>

      {error && <div style={{ color: "#ff7a7a", marginBottom: 12, padding: 10, background: "rgba(239,68,68,0.08)", borderRadius: 6 }}>{error}</div>}

      {loading ? (
        <div style={{ color: "#8f98a0", padding: 20, textAlign: "center" }}>Đang tải...</div>
      ) : codes.length === 0 ? (
        <div className="admin-empty">Chưa có mã giới thiệu nào.</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Mã</th>
                <th>Cấp độ</th>
                <th>Số người dùng</th>
                <th>Số tiền kiếm được</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {codes.map(row => (
                <tr key={row.id}>
                  <td style={{ color: "#66c0f4", fontWeight: 600 }}>
                    @{row.username || row.user_id.slice(0, 8)}
                  </td>
                  <td style={{ fontFamily: "monospace", color: "#fff", fontWeight: 700, letterSpacing: 2 }}>
                    {row.code}
                  </td>
                  <td style={{ color: tierColor(row.total_uses), fontWeight: 600 }}>
                    {tierLabel(row.total_uses)}
                  </td>
                  <td style={{ color: "#c7d5e0" }}>{row.total_uses.toLocaleString("vi-VN")}</td>
                  <td style={{ color: "#a4d007", fontWeight: 700 }}>{formatMoney(row.total_earned)}</td>
                  <td>
                    <button className="admin-btn" onClick={() => openDetail(row)}>Theo dõi</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail modal */}
      {selectedCode && (
        <div
          onClick={(e) => e.target === e.currentTarget && setSelectedCode(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
          }}
        >
          <div className="admin-modal" style={{ minWidth: 600, maxWidth: 720, maxHeight: "80vh", overflowY: "auto" }}>
            <div className="admin-modal-head">
              <span>
                Chi tiết mã <strong style={{ color: "#66c0f4", fontFamily: "monospace", letterSpacing: 2 }}>
                  {selectedCode.code}
                </strong> — @{selectedCode.username || selectedCode.user_id.slice(0, 8)}
              </span>
              <button className="admin-btn" onClick={() => setSelectedCode(null)}>Đóng</button>
            </div>
            <div className="admin-modal-body">
              <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "10px 16px", minWidth: 120 }}>
                  <div style={{ fontSize: 11, color: "#8f98a0", marginBottom: 3 }}>CẤP ĐỘ</div>
                  <div style={{ fontWeight: 700, color: tierColor(selectedCode.total_uses) }}>{tierLabel(selectedCode.total_uses)}</div>
                </div>
                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "10px 16px", minWidth: 120 }}>
                  <div style={{ fontSize: 11, color: "#8f98a0", marginBottom: 3 }}>TỔNG NGƯỜI DÙNG</div>
                  <div style={{ fontWeight: 700, color: "#c7d5e0" }}>{selectedCode.total_uses}</div>
                </div>
                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "10px 16px", minWidth: 120 }}>
                  <div style={{ fontSize: 11, color: "#8f98a0", marginBottom: 3 }}>TỔNG KIẾM ĐƯỢC</div>
                  <div style={{ fontWeight: 700, color: "#a4d007" }}>{formatMoney(selectedCode.total_earned)}</div>
                </div>
              </div>

              {usesLoading ? (
                <div style={{ color: "#8f98a0", textAlign: "center", padding: 20 }}>Đang tải...</div>
              ) : uses.length === 0 ? (
                <div className="admin-empty" style={{ padding: 16 }}>Chưa có lượt dùng nào.</div>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Người mua</th>
                        <th>Game</th>
                        <th>Giá gốc</th>
                        <th>Giảm</th>
                        <th>Hoa hồng</th>
                        <th>Thời gian</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uses.map(u => (
                        <tr key={u.id}>
                          <td style={{ color: "#66c0f4" }}>
                            @{u.username || u.buyer_user_id.slice(0, 8)}
                          </td>
                          <td>{u.game_name || "—"}</td>
                          <td style={{ color: "#c7d5e0" }}>{formatMoney(u.order_amount)}</td>
                          <td style={{ color: "#66c0f4" }}>-{u.discount_percent}% ({formatMoney(u.discount_amount)})</td>
                          <td style={{ color: "#a4d007", fontWeight: 700 }}>{formatMoney(u.commission_amount)}</td>
                          <td style={{ color: "#8f98a0", fontSize: 11 }}>
                            {new Date(u.created_at).toLocaleString("vi-VN")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="admin-modal-foot" style={{ display: "flex", justifyContent: "space-between" }}>
              <button
                className="admin-btn danger"
                onClick={handleReset}
                disabled={resetting}
              >
                {resetting ? "Đang reset..." : "🔄 Reset số tiền kiếm được"}
              </button>
              <button className="admin-btn" onClick={() => setSelectedCode(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const ALL_TABS: { id: AdminTab; label: string; roles: string[] }[] = [
  { id: "analytics",    label: "📊 Phân tích",       roles: ["manager", "admin", "payer"] },
  { id: "games",        label: "🎮 Quản lý Game",    roles: ["manager"] },
  { id: "dlcs",         label: "🧩 Quản lý DLC",     roles: ["manager"] },
  { id: "sale",         label: "🏷️ Quản lý Sale",    roles: ["admin"] },
  { id: "discounts",    label: "🎟️ Mã giảm giá",    roles: ["admin"] },
  { id: "balance_logs", label: "💰 Luồng tiền",      roles: ["payer"] },
  { id: "referral",     label: "🎁 Mã Giới Thiệu",  roles: ["payer"] },
  { id: "users",        label: "👥 Người dùng",      roles: ["admin", "payer"] },
  { id: "store",        label: "🖼️ Store Assets",    roles: ["manager"] },
  { id: "avatars",      label: "🎭 Avatar",          roles: ["manager"] },
  { id: "hubcap",       label: "🔑 Key",             roles: ["manager"] },
  { id: "settings",     label: "⚙️ Cài đặt",        roles: ["manager"] },
];

interface AdminPageProps { userRole?: string; }

export function AdminPage({ userRole }: AdminPageProps) {
  const role = userRole || "user";
  const allowedTabs = ALL_TABS.filter(t => t.roles.includes(role));
  const [activeTab, setActiveTab] = useState<AdminTab>(allowedTabs[0]?.id || "analytics");

  if (role === "user" || allowedTabs.length === 0) {
    return (
      <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"#8f98a0" }}>
        <div style={{ textAlign:"center" }}><div style={{ fontSize:48,marginBottom:16 }}>🔒</div><div style={{ fontSize:16,color:"#fff",marginBottom:8 }}>Truy cập bị từ chối</div><div>Bạn cần quyền đặc biệt.</div></div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-title">Admin Panel</div>
        {allowedTabs.map(t => (
          <button key={t.id} className={`admin-tab-btn${activeTab===t.id?" active":""}`} onClick={() => setActiveTab(t.id)}>{t.label}</button>
        ))}
      </aside>
      <div className="admin-content">
        {activeTab==="analytics" && <AnalyticsTab />}
        {activeTab==="games"     && <GamesTab />}
        {activeTab==="dlcs"      && <DlcsTab />}
        {activeTab==="sale"      && <SaleTab />}
        {activeTab==="discounts" && <DiscountCodesTab />}
        {activeTab==="users"     && <UsersTab panelRole={role} />}
        {activeTab==="store"     && <StoreAssetsTab />}
        {activeTab==="avatars"   && <AvatarsTab />}
        {activeTab==="balance_logs" && <BalanceLogsTab />}
        {activeTab==="referral"    && <ReferralAdminTab />}
        {activeTab==="hubcap"    && <HubcapKeysTab />}
        {activeTab==="settings"  && <SettingsTab />}
      </div>
    </div>
  );
}
