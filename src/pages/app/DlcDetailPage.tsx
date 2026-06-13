import { useCallback, useEffect, useRef, useState } from "react";
import { tauriAPI, DlcItem } from "../../lib/tauri-api";
import { DEFAULT_STEAM_BACKGROUND_URL, steamAppAssetUrl } from "../../lib/runtimeUrls";
import { formatMoney } from "../../lib/utils";
import { PurchaseModal } from "../../components/PurchaseModal";
import "../../styles/game-detail.css";

// ─── Types ─────────────────────────────────────────────────────────────────

interface Screenshot { id: number; path_full: string; path_thumbnail: string; }
interface Movie {
  id: number; name: string;
  mp4?: { max?: string; "480"?: string };
  webm?: { max?: string; "480"?: string };
  thumbnail: string;
}
interface SteamData {
  steam_appid?: number;
  name?: string;
  type?: string;
  is_free?: boolean;
  short_description?: string;
  detailed_description?: string;
  about_the_game?: string;
  header_image?: string;
  screenshots?: Screenshot[];
  movies?: Movie[];
  genres?: { id: string; description: string }[];
  developers?: string[];
  publishers?: string[];
  release_date?: { coming_soon?: boolean; date?: string };
  pc_requirements?: { minimum?: string; recommended?: string };
  supported_languages?: string;
  fullgame?: { appid?: string; name?: string };
  dlc?: (string | number)[];
  [key: string]: unknown;
}

interface MediaItem {
  type: "video" | "image";
  url: string;
  thumb: string;
}

interface DlcDetailPageProps {
  appid: string;
  baseAppid?: string;
  currentBalance?: number;
  onBack: () => void;
  onPurchased?: () => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function pickMovieUrl(m: Movie): string {
  return m.mp4?.max || m.mp4?.["480"] || m.webm?.max || m.webm?.["480"] || "";
}

function formatSupportedLanguages(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "Tiếng Anh";
  const plain = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\*/g, "");
  const lines = plain
    .split(/\n|,/)
    .map(x => x.trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.findIndex(t => t.toLowerCase() === v.toLowerCase()) === i);
  return lines.length ? lines.join("\n") : "Tiếng Anh";
}

async function fetchSteamDetails(appid: string): Promise<SteamData | null> {
  try {
    const data = await tauriAPI.adminApi.fetchSteamFull(appid);
    if (data && typeof data === "object" && "name" in data) {
      return data as SteamData;
    }
    return null;
  } catch (e) {
    console.error("[DlcDetail] fetch error:", e);
    return null;
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

export function DlcDetailPage({ appid, baseAppid, currentBalance, onBack, onPurchased }: DlcDetailPageProps) {
  const [steam, setSteam] = useState<SteamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeMediaIdx, setActiveMediaIdx] = useState(0);
  const [reqTab, setReqTab] = useState<"min" | "rec">("min");
  const videoRef = useRef<HTMLVideoElement>(null);

  // Purchase state
  const [owned, setOwned] = useState(false);
  const [buying] = useState(false);
  const [dlcPrice, setDlcPrice] = useState<number>(0);
  const [dlcOrigPrice, setDlcOrigPrice] = useState<number>(0);
  const [dlcDbId, setDlcDbId] = useState<string>("");
  const [dlcIsFree, setDlcIsFree] = useState<boolean>(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    setActiveMediaIdx(0);
    const data = await fetchSteamDetails(appid);
    if (!data) {
      setError(true);
    } else {
      setSteam(data);
    }
    setLoading(false);

    // Check owned + get price from DB
    const effectiveBase = baseAppid || String(data?.fullgame?.appid || "");
    if (effectiveBase && data) {
      const [ownedRes, dbRes] = await Promise.all([
        tauriAPI.dlc.listOwnedForBasegame(effectiveBase).catch(() => ({ data: [] as string[] })),
        tauriAPI.dlc.listForBasegame(effectiveBase).catch(() => ({ success: true, data: [] as DlcItem[] })),
      ]);

      const ownedIds = new Set((ownedRes.data ?? []).map(String));
      setOwned(ownedIds.has(appid));

      const dbDlc = (dbRes.data ?? []).find((d) => String(d.appid || "") === appid);
      if (dbDlc) {
        setDlcPrice(Number(dbDlc.price ?? 0));
        setDlcOrigPrice(Number(dbDlc.original_price ?? 0));
        setDlcDbId(String(dbDlc.id || ""));
        setDlcIsFree(Boolean(dbDlc.is_free));
      }
    }
  }, [appid, baseAppid]);

  useEffect(() => { load(); }, [load]);

  // Preload screenshots
  useEffect(() => {
    if (!steam) return;
    (steam.screenshots || []).forEach((s) => {
      if (s.path_full) {
        const img = new Image();
        img.src = s.path_full;
      }
    });
  }, [steam]);

  // Purchase modal
  const [showPurchase, setShowPurchase] = useState(false);

  // Handle purchase
  const isFreeDlc = dlcIsFree || Boolean(steam?.is_free);
  const canBuy = dlcPrice > 0 || isFreeDlc;
  const handleBuy = useCallback(() => {
    if (buying || owned) return;
    const effectiveBase = baseAppid || String(steam?.fullgame?.appid || "");
    if (!effectiveBase) {
      showToast("Không xác định được game gốc.", "error");
      return;
    }
    if (dlcPrice === 0 && !dlcIsFree && !steam?.is_free) {
      showToast("DLC này chưa có giá.", "error");
      return;
    }
    setShowPurchase(true);
  }, [buying, owned, baseAppid, steam, dlcPrice, dlcIsFree]);

  const handlePurchaseSuccess = useCallback(() => {
    setOwned(true);
    onPurchased?.();
  }, [onPurchased]);

  // Loading
  if (loading) {
    return (
      <div className="gd2-loading">
        <div className="gd2-spinner" />
        <div>Đang tải thông tin chi tiết...</div>
      </div>
    );
  }

  // Error
  if (error || !steam) {
    return (
      <div className="gd2-error">
        <div style={{ fontSize: 48, marginBottom: 12 }}>😞</div>
        <div style={{ marginBottom: 16, color: "#acb2b8" }}>
          Không thể tải metadata từ Steam cho DLC này. Vui lòng thử lại.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-back" onClick={load}>🔄 Thử lại</button>
          <button className="btn-back" onClick={onBack}>← Quay lại</button>
        </div>
      </div>
    );
  }

  const name = steam.name || `DLC ${appid}`;
  const header = steam.header_image || steamAppAssetUrl(appid, "header.jpg");
  const description = steam.short_description || "Chưa có mô tả cho DLC này.";
  const detailedDescription = steam.detailed_description || steam.about_the_game || description;
  const aboutOnly = steam.about_the_game || "";
  const aboutTheGame = (aboutOnly && aboutOnly !== detailedDescription)
    ? `${detailedDescription}<div style="margin-top:16px;">${aboutOnly}</div>`
    : detailedDescription;

  const releaseDate = steam.release_date?.date || "Đang cập nhật";
  const developers = Array.isArray(steam.developers) ? steam.developers : [];
  const publishers = Array.isArray(steam.publishers) ? steam.publishers : [];

  const minReq = steam.pc_requirements?.minimum || "Chưa có thông tin cấu hình tối thiểu.";
  const recReq = steam.pc_requirements?.recommended || "Chưa có thông tin cấu hình đề nghị.";

  // Build media list
  const media: MediaItem[] = [];
  (steam.movies || []).forEach(m => {
    const url = pickMovieUrl(m);
    if (url) media.push({ type: "video", url, thumb: m.thumbnail || header });
  });
  (steam.screenshots || []).forEach(s => {
    if (s.path_full) media.push({ type: "image", url: s.path_full, thumb: s.path_thumbnail || s.path_full });
  });
  if (media.length === 0) media.push({ type: "image", url: header, thumb: header });

  const activeMedia = media[Math.min(activeMediaIdx, media.length - 1)];

  const genres = steam.genres && steam.genres.length > 0
    ? steam.genres.map(g => g.description)
    : [];

  const isOnSale = dlcOrigPrice > dlcPrice && dlcOrigPrice > 0 && dlcPrice > 0;

  return (
    <div className="gd2-scroll">
      <div className="game-detail-container">
        {/* Title */}
        <div className="game-title-area">
          <div className="game-title-row">
            <div className="game-title-left">
              <h1 className="game-detail-title">{name}</h1>
            </div>
            <button className="btn-back game-title-back-btn" onClick={onBack}>
              <span>←</span> Quay lại
            </button>
          </div>
        </div>

        {/* Main grid: gallery + info */}
        <div className="game-detail-main-grid">
          {/* Gallery */}
          <div className="gallery-column">
            <div className="gallery-container">
              <div className="gallery-main">
                {activeMedia.type === "video" ? (
                  <video
                    ref={videoRef}
                    key={activeMedia.url}
                    controls autoPlay muted playsInline loop
                    poster={activeMedia.thumb}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  >
                    <source src={activeMedia.url} type="video/mp4" />
                  </video>
                ) : (
                  <img src={activeMedia.url} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
                    alt="" onError={e => { (e.target as HTMLImageElement).src = DEFAULT_STEAM_BACKGROUND_URL; }} />
                )}
              </div>
              <div className="gallery-thumbs-wrapper">
                <div className="gallery-thumbs">
                  {media.map((m, i) => (
                    <div key={i} className={`thumb-item${i === activeMediaIdx ? " active" : ""}`} onClick={() => setActiveMediaIdx(i)}>
                      <img src={m.thumb} alt="" onError={e => { (e.target as HTMLImageElement).src = DEFAULT_STEAM_BACKGROUND_URL; }} />
                      {m.type === "video" && <div className="play-icon">▶</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Info column */}
          <div className="info-column">
            <img src={header} className="sidebar-banner" alt="" onError={e => { (e.target as HTMLImageElement).src = DEFAULT_STEAM_BACKGROUND_URL; }} />
            <div className="sidebar-desc">{description}</div>
            <div className="sidebar-metadata">
              <div className="meta-row">
                <span className="meta-label">Ngày phát hành:</span>
                <span className="meta-value white">{releaseDate}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">Nhà phát triển:</span>
                <span className="meta-value blue">{developers.length ? developers.join(", ") : "N/A"}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">Nhà phát hành:</span>
                <span className="meta-value blue">{publishers.length ? publishers.join(", ") : "N/A"}</span>
              </div>
            </div>
            {genres.length > 0 && (
              <div className="popular-tags">
                <span className="tag-label">Thể loại:</span>
                <div className="tags-list">
                  {genres.map((g, i) => <span key={i} className="tag-item">{g}</span>)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Buy section */}
        <div className="buy-section-container">
          <div className="buy-card">
            <div className="buy-card-title">{owned ? "Đã sở hữu" : "Mua"} {name}</div>
            <div className="price-tag">
              {!owned && dlcPrice > 0 && (
                <span className="price-text">
                  {isOnSale && <span style={{ textDecoration: "line-through", color: "#8f98a0", marginRight: 8, fontSize: 12 }}>{formatMoney(dlcOrigPrice)}</span>}
                  {formatMoney(dlcPrice)}
                </span>
              )}
              {!owned && dlcPrice === 0 && (
                <span className="price-text" style={{ color: isFreeDlc ? "#a4d007" : "#8f98a0" }}>
                  {isFreeDlc ? "Miễn phí" : "Chưa có giá"}
                </span>
              )}
              {owned ? (
                <button className="buy-btn" disabled style={{ opacity: 0.7 }}>✓ Đã sở hữu</button>
              ) : (
                <button className="buy-btn" onClick={handleBuy} disabled={buying || !canBuy}>
                  {buying ? "Đang xử lý..." : canBuy ? (dlcPrice === 0 ? "Nhận miễn phí" : "Mua ngay") : "Chưa bán"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Toast */}
        {toast && (
          <div style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 9999,
            background: toast.type === "success" ? "rgba(16,185,129,0.95)" : "rgba(239,68,68,0.95)",
            color: "#fff", padding: "12px 18px", borderRadius: 8, fontSize: 13,
            maxWidth: 360, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}>
            {toast.msg}
          </div>
        )}

        {/* Content grid */}
        <div className="detail-content-grid">
          <div className="main-content-col">
            <div className="section-card">
              <h4 className="section-header">Về DLC này</h4>
              <div className="desc-html" dangerouslySetInnerHTML={{ __html: aboutTheGame }} />
            </div>

            <div className="requirements-container">
              <h4 className="section-header">Cấu hình hệ thống</h4>
              <div className="req-tabs-header">
                <button className={`req-tab-btn${reqTab === "min" ? " active" : ""}`} onClick={() => setReqTab("min")}>Tối thiểu</button>
                <button className={`req-tab-btn${reqTab === "rec" ? " active" : ""}`} onClick={() => setReqTab("rec")}>Đề nghị</button>
              </div>
              <div className="req-content" dangerouslySetInnerHTML={{ __html: reqTab === "min" ? minReq : recReq }} />
            </div>
          </div>

          <div className="side-content-col">
            <div className="section-card mini">
              <h4 className="section-header">Ngôn ngữ hỗ trợ</h4>
              <div className="languages-text" style={{ whiteSpace: "pre-line" }}>{formatSupportedLanguages(steam.supported_languages)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Purchase modal */}
      {showPurchase && dlcDbId && (
        <PurchaseModal
          items={[{
            id: dlcDbId,
            appid,
            name: steam?.name || `DLC ${appid}`,
            price: dlcPrice,
            originalPrice: dlcOrigPrice,
            type: "dlc",
            baseAppId: baseAppid || String(steam?.fullgame?.appid || ""),
          }]}
          currentBalance={currentBalance ?? 0}
          onClose={() => setShowPurchase(false)}
          onPurchased={handlePurchaseSuccess}
        />
      )}
    </div>
  );
}
