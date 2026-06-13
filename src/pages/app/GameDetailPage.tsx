import { useCallback, useEffect, useRef, useState } from "react";
import { tauriAPI, GameItem, DlcItem } from "../../lib/tauri-api";
import { addToCart, isInCart, toggleWishlist, isInWishlist } from "../../lib/cartWishlist";
import { DEFAULT_STEAM_BACKGROUND_URL, steamAppAssetUrl } from "../../lib/runtimeUrls";
import { formatMoney, isGameReleased } from "../../lib/utils";
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
  recommendations?: { total?: number };
  supported_languages?: string;
  [key: string]: unknown;
}

interface MediaItem {
  type: "video" | "image";
  url: string;
  thumb: string;
}

interface GameDetailPageProps {
  appid: string;
  gameId?: string;
  storePrice?: number;
  originalPrice?: number;
  gameName?: string;
  headerImage?: string;
  drm?: string;
  owned?: boolean;
  currentBalance?: number;
  onBack: () => void;
  onPurchased?: () => void;
  onPlay?: () => void;
  onDlcClick?: (dlcAppid: string) => void;
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

// Fetch qua Rust backend (CSP của WebView chặn fetch trực tiếp tới Steam)
async function fetchSteamDetails(appid: string): Promise<SteamData | null> {
  try {
    const data = await tauriAPI.adminApi.fetchSteamFull(appid);
    if (data && typeof data === "object" && "name" in data) {
      return data as SteamData;
    }
    return null;
  } catch (e) {
    console.error("[GameDetail] fetch error:", e);
    return null;
  }
}

// ─── DLC Section ────────────────────────────────────────────────────────────

interface DlcSectionProps {
  baseAppid: string;
  steamDlcAppids: string[]; // danh sách DLC appid từ Steam API
  currentBalance?: number;
  onPurchased?: () => void;
  onDlcClick?: (dlcAppid: string) => void; // Navigate to DLC detail page
}

function DlcSection({ baseAppid, steamDlcAppids, currentBalance, onPurchased, onDlcClick }: DlcSectionProps) {
  const [dlcs, setDlcs] = useState<Map<string, DlcItem>>(new Map());
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [purchaseDlc, setPurchaseDlc] = useState<DlcItem | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const cancelRef = useRef(false);

  const VISIBLE_COUNT = 5;
  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Load 1 DLC: ưu tiên DB, fallback Steam → lưu DB ───────────────────────
  const loadOneDlc = useCallback(async (dlcAppid: string): Promise<DlcItem | null> => {
    try {
      const res = await tauriAPI.dlc.getOrFetch({ baseAppid, dlcAppid });
      if (res.success && res.data) {
        return res.data as DlcItem;
      }
    } catch (e) {
      console.warn(`[DLC] load ${dlcAppid} failed:`, e);
    }
    return null;
  }, [baseAppid]);

  // ── Initial load: 5 DLC đầu (parallel) + owned list ───────────────────────
  useEffect(() => {
    if (steamDlcAppids.length === 0) return;
    cancelRef.current = false;
    setDlcs(new Map());
    setLoadedCount(0);

    (async () => {
      setLoading(true);
      try {
        // Owned list (1 call duy nhất)
        const ownedRes = await tauriAPI.dlc.listOwnedForBasegame(baseAppid).catch(() => ({ data: [] as string[] }));
        if (cancelRef.current) return;
        setOwnedIds(new Set((ownedRes.data ?? []).map(String)));

        // Load 5 DLC đầu song song
        const initialIds = steamDlcAppids.slice(0, VISIBLE_COUNT);
        const results = await Promise.all(initialIds.map(loadOneDlc));
        if (cancelRef.current) return;

        const newMap = new Map<string, DlcItem>();
        results.forEach((dlc, i) => {
          if (dlc) newMap.set(initialIds[i], dlc);
          else newMap.set(initialIds[i], { appid: initialIds[i], name: `DLC ${initialIds[i]}`, price: 0 });
        });
        setDlcs(newMap);
        setLoadedCount(initialIds.length);
      } finally {
        if (!cancelRef.current) setLoading(false);
      }
    })();

    return () => { cancelRef.current = true; };
  }, [baseAppid, steamDlcAppids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load more: từng DLC một, hiển thị progressive ────────────────────────
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || loadedCount >= steamDlcAppids.length) return;
    setLoadingMore(true);
    try {
      const remaining = steamDlcAppids.slice(loadedCount);
      for (let i = 0; i < remaining.length; i++) {
        if (cancelRef.current) break;
        const dlcAppid = remaining[i];
        const dlc = await loadOneDlc(dlcAppid);
        if (cancelRef.current) break;

        setDlcs((prev) => {
          const next = new Map(prev);
          next.set(dlcAppid, dlc ?? { appid: dlcAppid, name: `DLC ${dlcAppid}`, price: 0 });
          return next;
        });
        setLoadedCount((prev) => prev + 1);
      }
    } finally {
      if (!cancelRef.current) setLoadingMore(false);
    }
  }, [loadingMore, loadedCount, steamDlcAppids, loadOneDlc]);

  const handleBuy = (dlc: DlcItem) => {
    const dlcAppid = String(dlc.appid || "");
    if (!dlcAppid) return;

    if (!dlc.id || (Number(dlc.price ?? 0) === 0 && !(dlc as Record<string, unknown>).is_free)) {
      showToast("DLC này chưa có giá. Vui lòng liên hệ admin.", "error");
      return;
    }
    setPurchaseDlc(dlc);
  };

  const handlePurchaseSuccess = () => {
    if (purchaseDlc?.appid) {
      setOwnedIds((prev) => new Set([...prev, String(purchaseDlc.appid)]));
    }
    onPurchased?.();
  };

  if (steamDlcAppids.length === 0) return null;

  // Render: chỉ hiển thị DLC đã load (theo thứ tự steamDlcAppids)
  const visibleAppids = steamDlcAppids.slice(0, loadedCount);
  const hasMore = loadedCount < steamDlcAppids.length;
  const remainingCount = steamDlcAppids.length - loadedCount;

  return (
    <div className="section-card">
      <h4 className="section-header">Nội dung tải về ({steamDlcAppids.length})</h4>
      <div className="dlc-list">
        {/* Skeleton placeholders cho 5 DLC đầu khi đang load */}
        {loading && visibleAppids.length === 0 && steamDlcAppids.slice(0, VISIBLE_COUNT).map((id) => (
          <div key={id} className="dlc-row">
            <div className="dlc-row-img-wrap">
              <div className="dlc-row-img" style={{ background: "rgba(255,255,255,0.05)" }} />
            </div>
            <div className="dlc-row-info">
              <div className="dlc-row-skeleton" style={{ width: 160, height: 13, borderRadius: 4, background: "rgba(255,255,255,0.07)", animation: "pulse 1.2s infinite" }} />
            </div>
          </div>
        ))}

        {visibleAppids.map((dlcAppid) => {
          const dlc = dlcs.get(dlcAppid) ?? { appid: dlcAppid, name: `DLC ${dlcAppid}`, price: 0 };
          const isOwned = ownedIds.has(dlcAppid);
          const price = Number(dlc.price ?? 0);
          const origPrice = Number(dlc.original_price ?? 0);
          const isOnSale = origPrice > price && origPrice > 0 && price > 0;
          const isFree = Boolean((dlc as Record<string, unknown>).is_free);
          const hasPrice = !!dlc.id && price > 0;
          const displayName = dlc.name || `DLC ${dlcAppid}`;
          const img = (dlc.custom_image as string) || (dlc.header_image as string)
            || steamAppAssetUrl(dlcAppid, "header.jpg");

          return (
            <div
              key={dlcAppid}
              className="dlc-row"
              style={{ cursor: "pointer", animation: "fadeIn 0.3s ease" }}
              onClick={() => onDlcClick?.(dlcAppid)}
            >
              <div className="dlc-row-img-wrap">
                <img
                  className="dlc-row-img"
                  src={img}
                  alt={displayName}
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_STEAM_BACKGROUND_URL; }}
                />
              </div>
              <div className="dlc-row-info">
                <div className="dlc-row-name">{displayName}</div>
              </div>
              <div className="dlc-row-action" onClick={(e) => e.stopPropagation()}>
                {isOwned ? (
                  <span className="dlc-owned-badge">✓ Đã sở hữu</span>
                ) : hasPrice ? (
                  <div className="dlc-price-buy">
                    <div className="dlc-price-wrap">
                      {isOnSale && <span className="dlc-orig-price">{formatMoney(origPrice)}</span>}
                      <span className="dlc-price">{formatMoney(price)}</span>
                    </div>
                    <button className="dlc-buy-btn" onClick={() => handleBuy(dlc)}>
                      Mua
                    </button>
                  </div>
                ) : isFree ? (
                  <div className="dlc-price-buy">
                    <div className="dlc-price-wrap">
                      <span className="dlc-price" style={{ color: "#a4d007" }}>Miễn phí</span>
                    </div>
                    <button className="dlc-buy-btn" onClick={() => handleBuy(dlc)}>
                      Nhận
                    </button>
                  </div>
                ) : (
                  <span style={{ fontSize: 11, color: "#8f98a0" }}>Chưa có giá</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loadingMore}
          style={{
            display: "block",
            width: "100%",
            marginTop: 12,
            padding: "10px 0",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            color: loadingMore ? "#8f98a0" : "#66c0f4",
            fontSize: 13,
            cursor: loadingMore ? "wait" : "pointer",
            textAlign: "center",
          }}
        >
          {loadingMore
            ? `Đang tải... (${loadedCount}/${steamDlcAppids.length})`
            : `Hiển thị thêm ${remainingCount} DLC ▼`}
        </button>
      )}

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

      {/* DLC purchase modal */}
      {purchaseDlc && (
        <PurchaseModal
          items={[{
            id: String(purchaseDlc.id || ""),
            appid: String(purchaseDlc.appid || ""),
            name: purchaseDlc.name || `DLC ${purchaseDlc.appid}`,
            price: Number(purchaseDlc.price || 0),
            originalPrice: Number(purchaseDlc.original_price || 0),
            type: "dlc",
            baseAppId: baseAppid,
          }]}
          currentBalance={currentBalance ?? 0}
          onClose={() => setPurchaseDlc(null)}
          onPurchased={handlePurchaseSuccess}
        />
      )}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────

export function GameDetailPage({ appid, gameId, storePrice, originalPrice, gameName, headerImage, drm, owned: ownedProp, currentBalance, onBack, onPurchased, onPlay, onDlcClick }: GameDetailPageProps) {
  const [steam, setSteam] = useState<SteamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeMediaIdx, setActiveMediaIdx] = useState(0);
  const [reqTab, setReqTab] = useState<"min" | "rec">("min");
  const videoRef = useRef<HTMLVideoElement>(null);

  // Purchase state
  const [owned, setOwned] = useState(!!ownedProp);
  const [buying] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Cart + Wishlist state
  const [inCart, setInCart] = useState(() => isInCart(gameId));
  const [inWishlist, setInWishlist] = useState(() => isInWishlist(gameId));

  useEffect(() => {
    setInCart(isInCart(gameId));
    setInWishlist(isInWishlist(gameId));
  }, [gameId]);

  const buildGameItem = useCallback((): GameItem => ({
    id: gameId,
    appid,
    name: gameName || steam?.name || `Game ${appid}`,
    price: storePrice ?? 0,
    original_price: originalPrice ?? 0,
    header_image: headerImage || steam?.header_image,
  }), [gameId, appid, gameName, storePrice, originalPrice, headerImage, steam]);

  const handleAddToCart = () => {
    if (!gameId) { showToast("Game này chưa có trong cửa hàng.", "error"); return; }
    if (inCart) { showToast("Game đã có trong giỏ hàng.", "success"); return; }
    if (addToCart(buildGameItem())) {
      setInCart(true);
      showToast("Đã thêm vào giỏ hàng.", "success");
    }
  };

  const handleToggleWishlist = () => {
    if (!gameId) { showToast("Game này chưa có trong cửa hàng.", "error"); return; }
    const now = toggleWishlist(buildGameItem());
    setInWishlist(now);
    showToast(now ? "Đã thêm vào yêu thích." : "Đã bỏ khỏi yêu thích.", "success");
  };

  // Kiểm tra sở hữu khi mount
  useEffect(() => {
    if (!gameId) return;
    tauriAPI.userGames.has(gameId).then(setOwned).catch(() => {});
  }, [gameId]);

  // Purchase modal
  const [showPurchase, setShowPurchase] = useState(false);

  // ── Review state ────────────────────────────────────────────────────────
  const [myReview, setMyReview] = useState<{ recommended: boolean; content?: string } | null>(null);
  const [allReviews, setAllReviews] = useState<Array<{ id: string; user_id: string; recommended: boolean; content?: string; created_at?: string; profiles?: { display_name?: string; username?: string; avatar_url?: string } }>>([]);
  const [reviewText, setReviewText] = useState("");
  const [reviewChoice, setReviewChoice] = useState<boolean | null>(null);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewsShown, setReviewsShown] = useState(5);

  // Load reviews when gameId changes
  useEffect(() => {
    if (!gameId) return;
    tauriAPI.reviews.my(gameId).then(res => {
      if (res.success && res.data) {
        setMyReview({ recommended: res.data.recommended, content: res.data.content });
        setReviewText(res.data.content || "");
      } else {
        setMyReview(null);
        setReviewText("");
      }
    }).catch(() => {});
    tauriAPI.reviews.list(gameId).then(res => {
      if (res.success && res.data) setAllReviews(res.data);
    }).catch(() => {});
  }, [gameId, owned]);

  const handleSubmitReview = async (recommended: boolean) => {
    if (!gameId) return;
    setSubmittingReview(true);
    try {
      const content = reviewText.trim() || undefined;
      await tauriAPI.reviews.submit({ gameId, recommended, content });
      setMyReview({ recommended, content });
      showToast("Đã gửi đánh giá!", "success");
      // Refresh reviews list
      const res = await tauriAPI.reviews.list(gameId);
      if (res.success && res.data) setAllReviews(res.data);
    } catch (e) {
      showToast(typeof e === "string" ? e : "Lỗi gửi đánh giá", "error");
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleBuy = useCallback(() => {
    if (!gameId) {
      showToast("Game này chưa có trong cửa hàng.", "error");
      return;
    }
    if (buying) return;
    setShowPurchase(true);
  }, [gameId, buying]);

  const handlePurchaseSuccess = useCallback(() => {
    setOwned(true);
    onPurchased?.();
  }, [onPurchased]);

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
  }, [appid]);

  useEffect(() => { load(); }, [load]);

  // Preload toàn bộ ảnh screenshot full-res để chuyển ảnh tức thì (không phải chờ tải)
  useEffect(() => {
    if (!steam) return;
    (steam.screenshots || []).forEach((s) => {
      if (s.path_full) {
        const img = new Image();
        img.src = s.path_full;
      }
    });
  }, [steam]);

  if (loading) {
    return (
      <div className="gd2-loading">
        <div className="gd2-spinner" />
        <div>Đang tải thông tin chi tiết...</div>
      </div>
    );
  }

  if (error || !steam) {
    return (
      <div className="gd2-error">
        <div style={{ fontSize: 48, marginBottom: 12 }}>😞</div>
        <div style={{ marginBottom: 16, color: "#acb2b8" }}>
          Không thể tải metadata từ Steam cho game này. Vui lòng thử lại.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-back" onClick={load}>🔄 Thử lại</button>
          <button className="btn-back" onClick={onBack}>← Quay lại</button>
        </div>
      </div>
    );
  }

  const name = steam.name || `Game ${appid}`;
  const header = steam.header_image || steamAppAssetUrl(appid, "header.jpg");
  const description = steam.short_description || "Chưa có mô tả cho trò chơi này.";
  const detailedDescription = steam.detailed_description || steam.about_the_game || description;
  const aboutOnly = steam.about_the_game || "";
  const aboutTheGame = (aboutOnly && aboutOnly !== detailedDescription)
    ? `${detailedDescription}<div style="margin-top:16px;">${aboutOnly}</div>`
    : detailedDescription;

  const releaseDate = steam.release_date?.date || "Đang cập nhật";
  const isComingSoon = !isGameReleased(steam.release_date?.coming_soon, steam.release_date?.date);
  const developers = Array.isArray(steam.developers) ? steam.developers : [];
  const publishers = Array.isArray(steam.publishers) ? steam.publishers : [];

  const minReq = steam.pc_requirements?.minimum || "Chưa có thông tin cấu hình tối thiểu.";
  const recReq = steam.pc_requirements?.recommended || "Chưa có thông tin cấu hình đề nghị.";

  // Build media list (videos first, then screenshots)
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
    : ["Game"];

  return (
    <div className="gd2-scroll">
      <div className="game-detail-container">
        {/* Title */}
        <div className="game-title-area">
          <div className="game-title-row">
            <div className="game-title-left">
              <h1 className="game-detail-title">{name}</h1>
              {!owned && gameId && (
                <div className="gd2-title-actions">
                  <button
                    type="button"
                    className={`gd2-icon-btn${inWishlist ? " in-wish" : ""}`}
                    onClick={handleToggleWishlist}
                    title={inWishlist ? "Bỏ yêu thích" : "Yêu thích"}
                    aria-label="Yêu thích"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill={inWishlist ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={`gd2-icon-btn${inCart ? " in-cart" : ""}`}
                    onClick={handleAddToCart}
                    disabled={inCart}
                    title={inCart ? "Đã ở giỏ hàng" : "Thêm vào giỏ hàng"}
                    aria-label="Thêm vào giỏ hàng"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="21" r="1" />
                      <circle cx="20" cy="21" r="1" />
                      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
            <button className="btn-back game-title-back-btn" onClick={onBack}>
              <span>←</span> Quay lại cửa hàng
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
            <div className="popular-tags">
              <span className="tag-label">Thể loại:</span>
              <div className="tags-list">
                {genres.map((g, i) => <span key={i} className="tag-item">{g}</span>)}
              </div>
            </div>
          </div>
        </div>

        {/* Review section — chỉ hiện khi đã sở hữu VÀ chưa đánh giá */}
        {owned && !myReview && (
          <div className="buy-section-container" style={{ marginBottom: 16 }}>
            <div style={{ background: "rgba(22,27,34,0.7)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 12 }}>
                Đánh giá game này
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => setReviewChoice(true)}
                  disabled={submittingReview}
                  style={{
                    flex: 1, padding: "10px 12px", border: "1px solid",
                    borderColor: reviewChoice === true ? "#4ade80" : "rgba(255,255,255,0.12)",
                    background: reviewChoice === true ? "rgba(74,222,128,0.15)" : "rgba(0,0,0,0.2)",
                    borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    color: reviewChoice === true ? "#4ade80" : "#c7d5e0", fontWeight: 600, fontSize: 13,
                    transition: "all 0.15s",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={reviewChoice === true ? "#4ade80" : "currentColor"}><path d="M2 21h4V9H2v12zm20.29-11.29a1 1 0 0 0-.83-.42H15V5a3 3 0 0 0-3-3l-1 5-3 4v10h10.46a2 2 0 0 0 1.94-1.5l1.6-7a2 2 0 0 0-.31-1.71z"/></svg>
                  Recommend
                </button>
                <button
                  type="button"
                  onClick={() => setReviewChoice(false)}
                  disabled={submittingReview}
                  style={{
                    flex: 1, padding: "10px 12px", border: "1px solid",
                    borderColor: reviewChoice === false ? "#f87171" : "rgba(255,255,255,0.12)",
                    background: reviewChoice === false ? "rgba(248,113,113,0.15)" : "rgba(0,0,0,0.2)",
                    borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    color: reviewChoice === false ? "#f87171" : "#c7d5e0", fontWeight: 600, fontSize: 13,
                    transition: "all 0.15s",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={reviewChoice === false ? "#f87171" : "currentColor"}><path d="M22 3h-4v12h4V3zM1.71 14.29a1 1 0 0 0 .83.42H9v4.29a3 3 0 0 0 3 3l1-5 3-4V3H5.54a2 2 0 0 0-1.94 1.5l-1.6 7a2 2 0 0 0 .31 1.71z"/></svg>
                  Not Recommend
                </button>
              </div>
              <textarea
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                placeholder="Viết nhận xét (không bắt buộc)..."
                maxLength={500}
                style={{
                  width: "100%", minHeight: 60, resize: "vertical",
                  background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6, padding: "8px 10px", color: "#c7d5e0", fontSize: 12,
                  outline: "none", fontFamily: "inherit",
                }}
              />
              <button
                type="button"
                onClick={() => { if (reviewChoice !== null) handleSubmitReview(reviewChoice); }}
                disabled={submittingReview || reviewChoice === null}
                style={{
                  marginTop: 10, width: "100%", padding: "10px",
                  background: reviewChoice === null ? "rgba(255,255,255,0.05)" : "rgba(59,130,246,0.8)",
                  border: "none", borderRadius: 6, cursor: reviewChoice === null ? "not-allowed" : "pointer",
                  color: "#fff", fontWeight: 700, fontSize: 13, opacity: reviewChoice === null ? 0.5 : 1,
                  transition: "all 0.15s",
                }}
              >
                {submittingReview ? "Đang gửi..." : "Đăng đánh giá"}
              </button>
            </div>
          </div>
        )}

        {/* Đã đánh giá → hiện thông báo cảm ơn */}
        {owned && myReview && (
          <div className="buy-section-container" style={{ marginBottom: 16 }}>
            <div style={{ background: "rgba(22,27,34,0.7)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 10, padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
              <div style={{ color: "#c7d5e0", fontSize: 13, lineHeight: 1.6 }}>
                Cảm ơn vì đánh giá của bạn, đánh giá của bạn đã được ghi nhận
              </div>
            </div>
          </div>
        )}

        {/* Buy section */}
        <div className="buy-section-container">
          <div className="buy-card">
            <div className="buy-card-title">{owned ? "Đã sở hữu" : "Mua"} {name}</div>
            <div className="price-tag">
              {!owned && (
                <span className="price-text">
                  {storePrice === 0 || steam.is_free ? "Miễn phí" : storePrice !== undefined ? formatMoney(storePrice) : ""}
                </span>
              )}
              {owned ? (
                <button className="buy-btn" onClick={onPlay}>Chơi ngay</button>
              ) : (
                <button className="buy-btn" onClick={handleBuy} disabled={buying}>
                  {buying ? "Đang xử lý..." : isComingSoon ? "Pre-order" : "Mua ngay"}
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
            {/* DLC section — dùng danh sách DLC từ Steam API (hiện trước "Về trò chơi") */}
            <DlcSection
              baseAppid={appid}
              steamDlcAppids={(((steam as Record<string, unknown>).dlc ?? []) as Array<string | number>).map(String)}
              currentBalance={currentBalance}
              onPurchased={onPurchased}
              onDlcClick={onDlcClick}
            />

            <div className="section-card">
              <h4 className="section-header">Về trò chơi này</h4>
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

            {/* Reviews list — trong cột chính, song song với box cấu hình */}
            {allReviews.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h4 className="section-header">Đánh giá từ người chơi ({allReviews.length})</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {allReviews.filter(r => r.content).slice(0, reviewsShown).map(r => {
                    const profile = r.profiles;
                    const dName = profile?.display_name || profile?.username || "User";
                    const avUrl = profile?.avatar_url || "";
                    return (
                      <div key={r.id} style={{
                        display: "flex", gap: 12, padding: 12,
                        background: "rgba(22,27,34,0.6)", border: "1px solid rgba(255,255,255,0.07)",
                        borderRadius: 8,
                      }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: "50%", flexShrink: 0, overflow: "hidden",
                          background: "linear-gradient(135deg, #1e3a5f, #2563eb)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          {avUrl ? (
                            <img src={avUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
                          ) : (
                            <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>{dName.charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <span style={{ color: "#c7d5e0", fontSize: 12, fontWeight: 600 }}>{dName}</span>
                            {r.recommended ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="#4ade80"><path d="M2 21h4V9H2v12zm20.29-11.29a1 1 0 0 0-.83-.42H15V5a3 3 0 0 0-3-3l-1 5-3 4v10h10.46a2 2 0 0 0 1.94-1.5l1.6-7a2 2 0 0 0-.31-1.71z"/></svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="#f87171"><path d="M22 3h-4v12h4V3zM1.71 14.29a1 1 0 0 0 .83.42H9v4.29a3 3 0 0 0 3 3l1-5 3-4V3H5.54a2 2 0 0 0-1.94 1.5l-1.6 7a2 2 0 0 0 .31 1.71z"/></svg>
                            )}
                            <span style={{ fontSize: 10, color: "#8f98a0", marginLeft: "auto" }}>
                              {r.created_at ? new Date(r.created_at).toLocaleDateString("vi-VN") : ""}
                            </span>
                          </div>
                          <div style={{ color: "#8f98a0", fontSize: 12, lineHeight: 1.5, wordBreak: "break-word" }}>
                            {r.content}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {allReviews.filter(r => r.content).length > reviewsShown && (
                  <button
                    type="button"
                    onClick={() => setReviewsShown(prev => prev + 5)}
                    style={{
                      marginTop: 12, width: "100%", padding: "10px",
                      background: "rgba(102,192,244,0.08)", border: "1px solid rgba(102,192,244,0.2)",
                      borderRadius: 6, color: "#66c0f4", cursor: "pointer",
                      fontSize: 12, fontWeight: 600,
                    }}
                  >
                    Xem thêm đánh giá
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="side-content-col">
            <div className="section-card mini">
              <h4 className="section-header">Ngôn ngữ hỗ trợ</h4>
              <div className="languages-text" style={{ whiteSpace: "pre-line" }}>{formatSupportedLanguages(steam.supported_languages)}</div>
            </div>

            {/* DRM box — chỉ hiện nếu có DRM ngoài Steam */}
            {(() => {
              const drmList = String(drm || "")
                .split(",")
                .map(d => d.trim())
                .filter(Boolean)
                .filter(d => d.toLowerCase() !== "steam");
              if (drmList.length === 0) return null;
              return (
                <>
                  {drmList.map((drmName, i) => (
                    <div key={i} className="gd2-drm-box">
                      <div className="gd2-drm-title">Yêu cầu phần mềm bên thứ ba</div>
                      <div className="gd2-drm-content">
                        Game này sử dụng DRM bên thứ ba: <strong>{drmName}</strong>
                      </div>
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Purchase Modal */}
      {showPurchase && gameId && (
        <PurchaseModal
          items={[{
            id: gameId,
            appid,
            name: steam?.name || gameName || `Game ${appid}`,
            price: storePrice ?? 0,
            originalPrice: originalPrice,
            type: "game",
          }]}
          currentBalance={currentBalance ?? 0}
          onClose={() => setShowPurchase(false)}
          onPurchased={handlePurchaseSuccess}
        />
      )}
    </div>
  );
}
