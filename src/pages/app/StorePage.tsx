import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../../hooks/useStore";
import { FilterState, FilterData } from "../../lib/gameFilters";
import { GameItem, StoreAsset } from "../../lib/tauri-api";
import { steamAppAssetUrl, DEFAULT_STEAM_BACKGROUND_URL } from "../../lib/runtimeUrls";
import { formatMoney } from "../../lib/utils";
import { addToCart, toggleWishlist, isInCart, isInWishlist, isOwned } from "../../lib/cartWishlist";
import "../../styles/store.css";

// ─── Types ───────────────────────────────────────────────────────────────────

interface StorePageProps {
  store: ReturnType<typeof useStore>;
  onGameClick: (game: GameItem) => void;
}

// ─── FilterBar ───────────────────────────────────────────────────────────────

interface FilterBarProps {
  filters: FilterState;
  filterData: FilterData;
  onChange: (partial: Partial<FilterState>) => void;
}

export function FilterBar({ filters, filterData, onChange }: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const toggleBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (toggleBtnRef.current?.contains(target)) return;
      setExpanded(false);
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [expanded]);

  const toggleGenre = (genre: string) => {
    const next = filters.genres.includes(genre)
      ? filters.genres.filter((g) => g !== genre)
      : [...filters.genres, genre];
    onChange({ genres: next });
  };

  const toggleDrm = (drm: string) => {
    const next = filters.drms.includes(drm)
      ? filters.drms.filter((d) => d !== drm)
      : [...filters.drms, drm];
    onChange({ drms: next });
  };

  return (
    <div className="store-subnav-controls">
      <div className="store-subnav-filterbar">
        <button
          ref={toggleBtnRef}
          className="filter-toggle-btn"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span>BỘ LỌC</span>
          <span>{expanded ? "▲" : "▼"}</span>
        </button>
        <input
          type="text"
          className="store-search-field"
          placeholder="Tên trò chơi..."
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
        />
      </div>

      {expanded && (
        <div id="filter-content" className="filter-content expanded" ref={dropdownRef}>
          <div className="filter-section price-section">
            <h4 className="filter-title">Mức giá</h4>
            <div className="range-slider-container">
              <div className="range-label">
                <span>Miễn phí</span>
                <span>{(filterData.priceMax / 1000).toLocaleString("vi-VN")}k ₫</span>
              </div>
              <input type="range" className="range-slider" min={0} max={filterData.priceMax} step={10000}
                value={filters.priceMin}
                onChange={(e) => onChange({ priceMin: Math.min(Number(e.target.value), filters.priceMax) })} />
              <input type="range" className="range-slider" min={0} max={filterData.priceMax} step={10000}
                value={filters.priceMax}
                onChange={(e) => onChange({ priceMax: Math.max(Number(e.target.value), filters.priceMin) })} />
              <div className="range-display">
                <span>{filters.priceMin === 0 ? "Miễn phí" : (filters.priceMin / 1000).toLocaleString("vi-VN") + "k ₫"}</span>
                <span className="range-sep">-</span>
                <span>{(filters.priceMax / 1000).toLocaleString("vi-VN")}k ₫</span>
              </div>
            </div>
          </div>

          <div className="filter-section year-section">
            <h4 className="filter-title">Năm phát hành</h4>
            <div className="range-slider-container">
              <div className="range-label"><span>{filters.yearMin}</span><span>{filters.yearMax}</span></div>
              <input type="range" className="range-slider" min={filterData.yearMin} max={filterData.yearMax}
                value={filters.yearMin}
                onChange={(e) => onChange({ yearMin: Math.min(Number(e.target.value), filters.yearMax) })} />
              <input type="range" className="range-slider" min={filterData.yearMin} max={filterData.yearMax}
                value={filters.yearMax}
                onChange={(e) => onChange({ yearMax: Math.max(Number(e.target.value), filters.yearMin) })} />
              <div className="range-display">
                <span>{filters.yearMin}</span><span className="range-sep">-</span><span>{filters.yearMax}</span>
              </div>
            </div>
          </div>

          <div className="filter-section drm-section">
            <h4 className="filter-title">DRM</h4>
            <div className="filter-options">
              {filterData.drms.map((d) => (
                <label key={d} className="filter-opt">
                  <input type="checkbox" checked={filters.drms.includes(d)} onChange={() => toggleDrm(d)} /> {d}
                </label>
              ))}
            </div>
          </div>

          <div className="filter-section genre-section">
            <h4 className="filter-title">Thể loại</h4>
            <div className="filter-options" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px 12px", maxHeight: 180, overflowY: "auto", paddingRight: 4 }}>
              {filterData.genres.length === 0 ? (
                <div style={{ color: "#8f98a0", fontSize: 12 }}>Chưa có thể loại</div>
              ) : filterData.genres.map((g) => (
                <label key={g} className="filter-opt">
                  <input type="checkbox" checked={filters.genres.includes(g)} onChange={() => toggleGenre(g)} /> {g}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SaleCarousel ────────────────────────────────────────────────────────────

interface SaleCarouselProps { saleGames: GameItem[]; onGameClick: (game: GameItem) => void; }

function SaleCarousel({ saleGames, onGameClick }: SaleCarouselProps) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (saleGames.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % saleGames.length), 5000);
    return () => clearInterval(t);
  }, [saleGames.length]);
  if (saleGames.length === 0) return null;
  const current = saleGames[idx];
  const appid = String(current.appid || "").trim();
  const origPrice = Number(current.original_price || 0);
  const salePrice = Number(current.price || 0);
  const discountPct = origPrice > salePrice && origPrice > 0 ? Math.round(((origPrice - salePrice) / origPrice) * 100) : 0;
  const formatSaleEnd = (raw?: string) => {
    if (!raw) return "Không giới hạn";
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d.toLocaleString("vi-VN") : "Không rõ";
  };
  return (
    <div className="sale-carousel-layout" style={{ gridColumn: "1/-1" }}>
      <div className="store-carousel sale-games-carousel">
        <div className="sale-carousel-header">
          <span className="sale-carousel-badge">SALE NOW</span>
          <h3>Ưu đãi nổi bật</h3>
        </div>
        <div className="carousel-track" style={{ transform: `translateX(-${idx * 100}%)` }}>
          {saleGames.map((g) => {
            const aid = String(g.appid || "").trim();
            const img = (g.custom_image as string) || (g.header_image as string) || steamAppAssetUrl(aid, "header.jpg");
            return (
              <div key={String(g.id || aid)} className="carousel-slide sale-carousel-slide" onClick={() => onGameClick(g)} style={{ cursor: "pointer" }}>
                <img src={img} alt={String(g.name || "")} onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_STEAM_BACKGROUND_URL; }} />
              </div>
            );
          })}
        </div>
      </div>
      <div className="sale-info-box">
        <div className="sale-info-badge">SALE HOT</div>
        <h3 className="sale-info-title">{current.name || `Game ${appid}`}</h3>
        <div className="sale-info-row"><span>Giá gốc</span><strong className="sale-info-original">{formatMoney(origPrice)}</strong></div>
        <div className="sale-info-row"><span>Giảm</span><strong className="sale-info-discount">-{discountPct}%</strong></div>
        <div className="sale-info-row"><span>Giá sau sale</span><strong className="sale-info-price">{formatMoney(salePrice)}</strong></div>
        <div className="sale-info-row"><span>Hạn sale</span><strong>{formatSaleEnd(current.sale_end_at as string)}</strong></div>
        {saleGames.length > 1 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 8 }}>
            {saleGames.map((_, i) => (
              <div key={i} className={`carousel-dot${i === idx ? " active" : ""}`} onClick={() => setIdx(i)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PromoCarousel ───────────────────────────────────────────────────────────

function PromoCarousel({ assets }: { assets: StoreAsset[] }) {
  const [idx, setIdx] = useState(0);
  const carousels = assets.filter((a) => a.type === "carousel");
  useEffect(() => {
    if (carousels.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % carousels.length), 5000);
    return () => clearInterval(t);
  }, [carousels.length]);
  if (carousels.length === 0) return null;
  const isVideo = (url: string) => /\.mp4(\?|$)/i.test(url) || /\.webm(\?|$)/i.test(url);
  return (
    <div className="store-carousel" style={{ gridColumn: "1/-1" }}>
      <div className="carousel-track" style={{ transform: `translateX(-${idx * 100}%)` }}>
        {carousels.map((c, i) => (
          <div key={i} className="carousel-slide" onClick={() => c.link_url && window.open(c.link_url, "_blank")} style={{ cursor: c.link_url ? "pointer" : "default" }}>
            {isVideo(c.image_url) ? (
              <video src={c.image_url} autoPlay muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <img src={c.image_url} alt="" className={i === idx ? "zoom-active" : ""} />
            )}
          </div>
        ))}
      </div>
      {carousels.length > 1 && (
        <>
          <button className="carousel-btn prev" onClick={() => setIdx((i) => (i - 1 + carousels.length) % carousels.length)}>❮</button>
          <button className="carousel-btn next" onClick={() => setIdx((i) => (i + 1) % carousels.length)}>❯</button>
          <div className="carousel-dots">
            {carousels.map((_, i) => (
              <div key={i} className={`carousel-dot${i === idx ? " active" : ""}`} onClick={() => setIdx(i)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── GameCard ─────────────────────────────────────────────────────────────────

interface GameCardProps { game: GameItem; review?: { up: number; down: number; total: number }; onClick: () => void; }

function GameCard({ game, review, onClick }: GameCardProps) {
  const appid = String(game.appid || "").trim();
  const img = (game.custom_image as string) || (game.header_image as string) || steamAppAssetUrl(appid, "header.jpg");
  const isOnSale = Number(game.original_price || 0) > Number(game.price || 0);
  const discountPct = isOnSale ? Math.round(((Number(game.original_price) - Number(game.price)) / Number(game.original_price)) * 100) : 0;
  const up = Math.max(0, Number(review?.up || 0));
  const down = Math.max(0, Number(review?.down || 0));
  const owned = isOwned(game.id);
  const [inCart, setInCart] = useState(() => isInCart(game.id));
  const [inWishlist, setInWishlist] = useState(() => isInWishlist(game.id));

  const onCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (addToCart(game)) setInCart(true);
  };
  const onWishlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInWishlist(toggleWishlist(game));
  };

  return (
    <div className="store-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onClick()}>
      <div className="store-card-image-wrap">
        <img src={img} loading="lazy" alt={String(game.name || "")} onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_STEAM_BACKGROUND_URL; }} />
        {isOnSale && <div className="discount-badge">-{discountPct}%</div>}
        {!owned && (
          <div className="store-card-quick">
            <button
              type="button"
              className={`store-quick-btn${inWishlist ? " active-wish" : ""}`}
              title={inWishlist ? "Bỏ yêu thích" : "Yêu thích"}
              onClick={onWishlist}
            >
              {inWishlist ? "♥" : "♡"}
            </button>
            <button
              type="button"
              className={`store-quick-btn${inCart ? " active-cart" : ""}`}
              title={inCart ? "Đã ở giỏ hàng" : "Thêm vào giỏ"}
              onClick={onCart}
              disabled={inCart}
            >
              {inCart ? "✓" : "🛒"}
            </button>
          </div>
        )}
      </div>
      <div className="store-card-info">
        <div className="store-card-name">{game.name || `Game ${game.appid}`}</div>
        <div className="store-card-footer">
          <div className="store-card-price-box">
            {isOnSale && <span className="original-price">{formatMoney(Number(game.original_price))}</span>}
            <span className="current-price">{Number(game.price) === 0 ? "Miễn phí" : formatMoney(Number(game.price))}</span>
          </div>
          <div className="store-card-stats">{game.purchase_count || 0} lượt mua</div>
        </div>
        <div className="store-card-footer" style={{ marginTop: 4 }}>
          <div className="store-card-stats" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#a4d007" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 21h4V9H2v12zm20.29-11.29a1 1 0 0 0-.83-.42H15V5a3 3 0 0 0-3-3l-1 5-3 4v10h10.46a2 2 0 0 0 1.94-1.5l1.6-7a2 2 0 0 0-.31-1.71z"/></svg>
              {up}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#ff6b6b" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 3h-4v12h4V3zM1.71 14.29a1 1 0 0 0 .83.42H9v4a3 3 0 0 0 3 3l1-5 3-4V3H5.54a2 2 0 0 0-1.94 1.5l-1.6 7a2 2 0 0 0 .31 1.79z"/></svg>
              {down}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

interface PaginationProps { currentPage: number; totalPages: number; onGoTo: (page: number) => void; }

function Pagination({ currentPage, totalPages, onGoTo }: PaginationProps) {
  const [inputVal, setInputVal] = useState(String(currentPage));
  useEffect(() => { setInputVal(String(currentPage)); }, [currentPage]);
  if (totalPages <= 1) return null;
  const go = (page: number) => { const p = Math.max(1, Math.min(totalPages, Number(page) || 1)); onGoTo(p); };
  return (
    <div className="store-pagination">
      <button className="btn-secondary" disabled={currentPage === 1} onClick={() => go(1)}>Đầu</button>
      <button className="btn-secondary" disabled={currentPage === 1} onClick={() => go(currentPage - 1)}>Trước</button>
      <div style={{ display: "flex", alignItems: "center", color: "#c7d5e0", gap: 4, minWidth: 80, justifyContent: "center" }}>
        <input type="number" min={1} max={totalPages} value={inputVal} onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") go(Number(inputVal)); }} onBlur={() => go(Number(inputVal))}
          style={{ width: 52, background: "transparent", border: "none", outline: "none", color: "#fff", textAlign: "right", fontWeight: 700, padding: 0 }} />
        <span>/ {totalPages}</span>
      </div>
      <button className="btn-secondary" disabled={currentPage === totalPages} onClick={() => go(currentPage + 1)}>Sau</button>
      <button className="btn-secondary" disabled={currentPage === totalPages} onClick={() => go(totalPages)}>Cuối</button>
    </div>
  );
}

// ─── Main StorePage ───────────────────────────────────────────────────────────

export function StorePage({ store, onGameClick }: StorePageProps) {
  const {
    storeAssets, pageItems, currentPage,
    totalPages, reviewMap, loading, error, saleGames, goToPage, saveReturnState,
  } = store;

  const gridRef = useRef<HTMLDivElement>(null);
  // Tham chiếu đến element "điểm dừng" ngay dưới carousel để scroll tới khi chuyển trang
  const gamesAnchorRef = useRef<HTMLDivElement>(null);
  const prevPageRef = useRef(currentPage);
  const banners = storeAssets.filter((a) => a.type === "banner");
  const isVideo = (url: string) => /\.mp4(\?|$)/i.test(url) || /\.webm(\?|$)/i.test(url);

  // Scroll lên đầu danh sách game (dưới carousel) khi chuyển trang
  useEffect(() => {
    if (prevPageRef.current !== currentPage) {
      prevPageRef.current = currentPage;
      // Ưu tiên scroll anchor vào view, fallback scroll container về đầu
      if (gamesAnchorRef.current) {
        gamesAnchorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (gridRef.current) {
        gridRef.current.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  }, [currentPage]);

  const handleGameClick = useCallback(
    (game: GameItem) => { saveReturnState(gridRef.current?.scrollTop ?? 0); onGameClick(game); },
    [saveReturnState, onGameClick]
  );

  if (loading) return <div style={{ textAlign: "center", padding: "100px 0", color: "#8f98a0" }}>Đang tải cửa hàng...</div>;
  if (error) return (
    <div style={{ textAlign: "center", padding: "100px 0", color: "#ff4d4d" }}>
      <div style={{ fontSize: 14, marginBottom: 12 }}>Lỗi tải cửa hàng:</div>
      <div style={{ fontSize: 12, color: "#ff8080", fontFamily: "monospace", maxWidth: 600, margin: "0 auto", wordBreak: "break-all" }}>{error}</div>
    </div>
  );

  let bannerIdx = 0;
  const gridItems: React.ReactNode[] = [];
  pageItems.forEach((g, index) => {
    if (index > 0 && index % 9 === 0 && banners[bannerIdx]) {
      const b = banners[bannerIdx];
      gridItems.push(
        <div key={`banner-${bannerIdx}`} className="store-banner-item" onClick={() => b.link_url && window.open(b.link_url, "_blank")} style={{ cursor: b.link_url ? "pointer" : "default" }}>
          {isVideo(b.image_url) ? <video src={b.image_url} autoPlay muted loop playsInline /> : <img src={b.image_url} alt="" />}
        </div>
      );
      bannerIdx = (bannerIdx + 1) % banners.length;
    }
    gridItems.push(<GameCard key={String(g.id || g.appid)} game={g} review={reviewMap[String(g.id)]} onClick={() => handleGameClick(g)} />);
  });

  return (
    <div className="store-page-wrapper">
      <div id="page-store" className="page">
        <div className="store-grid" ref={gridRef}>
          <PromoCarousel assets={storeAssets} />
          <SaleCarousel saleGames={saleGames} onGameClick={handleGameClick} />
          {/* Anchor để scroll tới khi chuyển trang */}
          <div ref={gamesAnchorRef} style={{ gridColumn: "1/-1", height: 0, margin: 0, padding: 0 }} />
          {pageItems.length === 0 ? (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "100px 0", color: "#8f98a0" }}>Không tìm thấy trò chơi nào phù hợp.</div>
          ) : gridItems}
          {totalPages > 1 && (
            <div style={{ gridColumn: "1/-1", display: "flex", justifyContent: "center", padding: "40px 0" }}>
              <Pagination currentPage={currentPage} totalPages={totalPages} onGoTo={goToPage} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
