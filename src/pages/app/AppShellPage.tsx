import { useEffect, useRef, useState } from "react";
import { tauriAPI, GameItem } from "../../lib/tauri-api";
import type { SessionUser } from "../../hooks/useSessionBootstrap";
import { StorePage, FilterBar } from "./StorePage";
import { useStore } from "../../hooks/useStore";
import { LibraryPage } from "./LibraryPage";
import { ProfilePage } from "./ProfilePage";
import { AdminPage } from "./AdminPage";
import { GameDetailPage } from "./GameDetailPage";
import { DlcDetailPage } from "./DlcDetailPage";
import { AddFundsModal } from "../../components/AddFundsModal";
import { ReferralModal } from "../../components/ReferralModal";
import { SteamLinkModal } from "../../components/SteamLinkModal";
import { CartPage } from "./CartPage";
import { WishlistPage } from "./WishlistPage";
import { useCartWishlist } from "../../hooks/useCartWishlist";
import { formatMoney } from "../../lib/utils";
import { UpdateGate } from "../../components/UpdateGate";
import "../../styles/base.css";

// ─── Types ─────────────────────────────────────────────────────────────────

interface AppShellPageProps {
  user: SessionUser;
  onRefreshSession?: () => Promise<SessionUser | null>;
}

type AppPage = "store" | "library" | "profile" | "admin" | "game-detail" | "cart" | "wishlist" | "dlc-detail";

// ─── Avatar + Dropdown ──────────────────────────────────────────────────────

interface UserAvatarProps {
  displayName: string;
  balance: number;
  avatarUrl?: string;
  onNavigate: (page: AppPage) => void;
  onAddFunds: () => void;
  onLogout: () => void;
  onRefreshSession?: () => Promise<unknown>;
  onReferral: () => void;
  onSteamLink: () => void;
}

function UserAvatar({ displayName, balance, avatarUrl, onNavigate, onAddFunds, onLogout, onRefreshSession, onReferral, onSteamLink }: UserAvatarProps) {
  const [open, setOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [updatingSteam, setUpdatingSteam] = useState(false);
  const [steamToast, setSteamToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Reset imgError khi avatar URL thay đổi
  useEffect(() => { setImgError(false); }, [avatarUrl]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const showImage = !!avatarUrl && !imgError;

  const go = (page: AppPage) => {
    setOpen(false);
    onNavigate(page);
  };

  const handleUpdateSteam = async () => {
    if (updatingSteam) return;
    setUpdatingSteam(true);
    setSteamToast(null);
    try {
      const res = await tauriAPI.steamIntegration.manifestFix();
      if (res.success) {
        setSteamToast({ type: "success", msg: "Steam đã được cập nhật" });
      } else {
        setSteamToast({ type: "error", msg: res.message || "Không thể cập nhật Steam" });
      }
    } catch (e) {
      setSteamToast({ type: "error", msg: (e as Error)?.message || "Lỗi cập nhật Steam" });
    } finally {
      setUpdatingSteam(false);
      // Tự ẩn toast sau 4s
      setTimeout(() => setSteamToast(null), 4000);
    }
  };

  return (
    <div className="user-avatar-wrap" ref={ref}>
      <button
        type="button"
        className="user-avatar-btn"
        onClick={() => {
          const next = !open;
          setOpen(next);
          // Refresh session khi mở dropdown để balance/role luôn mới nhất
          if (next && onRefreshSession) {
            onRefreshSession();
          }
        }}
        aria-label={`Tài khoản: ${displayName}`}
        aria-expanded={open}
      >
        {showImage ? (
          <img
            src={avatarUrl}
            alt={displayName}
            className="user-avatar-img"
            key={avatarUrl}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="user-avatar-initials">{initials || "?"}</span>
        )}
        <span className="user-avatar-online" aria-hidden="true" />
        <span className="user-avatar-balance" aria-label={`Số dư: ${formatMoney(balance)}`}>
          {formatMoney(balance)}
        </span>
      </button>

      {open && (
        <div className="user-avatar-dropdown" role="menu">
          {/* Header với display name và balance */}
          <div className="user-avatar-dropdown-header">
            <div className="user-avatar-dropdown-avatar">
              {showImage ? (
                <img src={avatarUrl} alt={displayName} referrerPolicy="no-referrer" onError={() => setImgError(true)} />
              ) : (
                <span>{initials || "?"}</span>
              )}
            </div>
            <div className="user-avatar-dropdown-info">
              <div className="user-avatar-dropdown-name">{displayName}</div>
              <div className="user-avatar-dropdown-balance">{formatMoney(balance)}</div>
            </div>
          </div>
          <div className="user-avatar-dropdown-divider" />

          {/* Xem hồ sơ */}
          <button
            type="button"
            className="user-avatar-dropdown-item"
            role="menuitem"
            onClick={() => go("profile")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Xem hồ sơ
          </button>

          {/* Nạp tiền */}
          <button
            type="button"
            className="user-avatar-dropdown-item"
            role="menuitem"
            onClick={() => { setOpen(false); onAddFunds(); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
            Nạp tiền
          </button>

          {/* Mã Giới Thiệu */}
          <button
            type="button"
            className="user-avatar-dropdown-item"
            role="menuitem"
            onClick={() => { setOpen(false); onReferral(); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            Mã Giới Thiệu
          </button>

          {/* Update Steam */}          <button
            type="button"
            className="user-avatar-dropdown-item"
            role="menuitem"
            onClick={handleUpdateSteam}
            disabled={updatingSteam}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {updatingSteam ? "Đang cập nhật..." : "Update Steam"}
          </button>

          {/* Liên Kết Steam */}
          <button
            type="button"
            className="user-avatar-dropdown-item"
            role="menuitem"
            onClick={() => { setOpen(false); onSteamLink(); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            Liên Kết Steam
          </button>

          <div className="user-avatar-dropdown-divider" />

          {/* Đăng xuất */}
          <button
            type="button"
            className="user-avatar-dropdown-item logout"
            role="menuitem"
            onClick={() => { setOpen(false); onLogout(); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Đăng xuất
          </button>
        </div>
      )}

      {/* Toast thông báo update Steam */}
      {steamToast && (
        <div
          role="status"
          style={{
            position: "absolute",
            top: "calc(100% + 10px)",
            right: 0,
            minWidth: 220,
            padding: "12px 16px",
            borderRadius: 10,
            background: steamToast.type === "success" ? "rgba(16,185,129,0.16)" : "rgba(239,68,68,0.14)",
            border: `1px solid ${steamToast.type === "success" ? "rgba(16,185,129,0.5)" : "rgba(239,68,68,0.5)"}`,
            color: steamToast.type === "success" ? "#34d399" : "#f87171",
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 12px 30px rgba(0,0,0,0.45)",
            backdropFilter: "blur(12px)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span aria-hidden="true">{steamToast.type === "success" ? "✓" : "✕"}</span>
          {steamToast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Top navbar ─────────────────────────────────────────────────────────────

interface NavBarProps {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  onBrandClick: () => void;
  displayName: string;
  balance: number;
  avatarUrl?: string;
  userRole?: string;
  cartCount: number;
  wishlistCount: number;
  onAddFunds: () => void;
  onLogout: () => void;
  onRefreshSession?: () => Promise<unknown>;
  onReferral: () => void;
  onSteamLink: () => void;
}

function NavBar({ activePage, onNavigate, onBrandClick, displayName, balance, avatarUrl, userRole, cartCount, wishlistCount, onAddFunds, onLogout, onRefreshSession, onReferral, onSteamLink }: NavBarProps) {
  const hasAdminAccess = userRole === "admin" || userRole === "manager" || userRole === "payer";
  const adminLabel = userRole === "manager" ? "Manager" : userRole === "payer" ? "Payer" : userRole === "admin" ? "Admin" : "Panel";
  return (
    <nav className="app-navbar">
      <div className="app-navbar-brand-wrap">
        <button
          type="button"
          className="app-navbar-brand"
          onClick={onBrandClick}
        >
          Nyvexa
        </button>
      </div>

      <div className="app-navbar-links">
        <button
          type="button"
          className={`nav-btn${activePage === "store" ? " active" : ""}`}
          onClick={() => onNavigate("store")}
        >
          Cửa hàng
        </button>
        <button
          type="button"
          className={`nav-btn${activePage === "library" ? " active" : ""}`}
          onClick={() => onNavigate("library")}
        >
          Thư viện
        </button>
        <button
          type="button"
          className={`nav-btn${activePage === "profile" ? " active" : ""}`}
          onClick={() => onNavigate("profile")}
        >
          {displayName || "Hồ sơ"}
        </button>
        {hasAdminAccess && (
          <button
            type="button"
            className={`nav-btn${activePage === "admin" ? " active" : ""}`}
            onClick={() => onNavigate("admin")}
          >
            {adminLabel}
          </button>
        )}
      </div>

      <div className="app-navbar-user">
        {/* Wishlist icon */}
        <button
          type="button"
          className={`nav-icon-btn${activePage === "wishlist" ? " active" : ""}`}
          onClick={() => onNavigate("wishlist")}
          aria-label="Yêu thích"
          title="Yêu thích"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          {wishlistCount > 0 && <span className="nav-icon-badge">{wishlistCount}</span>}
        </button>
        {/* Cart icon */}
        <button
          type="button"
          className={`nav-icon-btn${activePage === "cart" ? " active" : ""}`}
          onClick={() => onNavigate("cart")}
          aria-label="Giỏ hàng"
          title="Giỏ hàng"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
          {cartCount > 0 && <span className="nav-icon-badge">{cartCount}</span>}
        </button>
        <UserAvatar
          displayName={displayName}
          balance={balance}
          avatarUrl={avatarUrl}
          onNavigate={onNavigate}
          onAddFunds={onAddFunds}
          onLogout={onLogout}
          onRefreshSession={onRefreshSession}
          onReferral={onReferral}
          onSteamLink={onSteamLink}
        />
      </div>
    </nav>
  );
}

// ─── AppShellPage ────────────────────────────────────────────────────────────

export function AppShellPage({ user, onRefreshSession }: AppShellPageProps) {
  const [activePage, setActivePage] = useState<AppPage>("store");
  const [libraryFocusAppId, setLibraryFocusAppId] = useState<string | undefined>();
  const [balance, setBalance] = useState(Number(user.balance ?? 0));
  const [detailAppid, setDetailAppid] = useState<string>("");
  const [detailGameId, setDetailGameId] = useState<string>("");
  const [detailPrice, setDetailPrice] = useState<number | undefined>(undefined);
  const [detailDrm, setDetailDrm] = useState<string | undefined>(undefined);
  const [detailOriginalPrice, setDetailOriginalPrice] = useState<number | undefined>(undefined);
  const [detailName, setDetailName] = useState<string | undefined>(undefined);
  const [detailHeaderImage, setDetailHeaderImage] = useState<string | undefined>(undefined);
  const [prevPage, setPrevPage] = useState<AppPage>("store");
  // DLC detail state
  const [dlcDetailAppid, setDlcDetailAppid] = useState<string>("");
  const [dlcDetailBaseAppid, setDlcDetailBaseAppid] = useState<string>("");
  // AddFunds modal
  const [showAddFunds, setShowAddFunds] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  // Steam Link modal
  const [showSteamLink, setShowSteamLink] = useState(false);
  // Guardian mismatch notification
  const [guardianMismatch, setGuardianMismatch] = useState(false);
  const [guardianMismatchMsg, setGuardianMismatchMsg] = useState("");

  // Store state — quản lý ở đây để sub-navbar có thể render cùng cấp với main navbar
  const storeState = useStore();

  // Cart + Wishlist
  const { cart, wishlist, cartCount, wishlistCount, refreshOwned } = useCartWishlist();

  // ── Lịch sử điều hướng ────────────────────────────────────────────────
  // Mỗi entry lưu đủ ngữ cảnh để khôi phục chính xác:
  //  - page: trang đang xem
  //  - storePage: số trang trong Cửa Hàng (nếu là store)
  //  - libAppId: appid game đang xem trong Thư viện (nếu là library)
  //  - detail: ngữ cảnh trang game-detail
  interface NavEntry {
    page: AppPage;
    storePage?: number;
    libAppId?: string;
    detail?: { appid: string; gameId: string; price?: number; drm?: string };
  }

  const [history, setHistory] = useState<NavEntry[]>([{ page: "store", storePage: 1 }]);
  const [histIdx, setHistIdx] = useState(0);
  // Cờ để bỏ qua việc push khi điều hướng bằng nút tiến/lùi
  const isNavigatingRef = useRef(false);

  const sameEntry = (a: NavEntry, b: NavEntry): boolean =>
    a.page === b.page &&
    (a.storePage ?? null) === (b.storePage ?? null) &&
    (a.libAppId ?? null) === (b.libAppId ?? null) &&
    (a.detail?.appid ?? null) === (b.detail?.appid ?? null);

  const pushHistory = (entry: NavEntry) => {
    setHistory((prev) => {
      const current = prev[histIdx];
      // Tránh lặp: không push nếu trùng entry hiện tại
      if (current && sameEntry(current, entry)) return prev;
      const trimmed = prev.slice(0, histIdx + 1);
      trimmed.push(entry);
      setHistIdx(trimmed.length - 1);
      return trimmed;
    });
  };

  // Áp dụng một entry lịch sử lên state (dùng khi tiến/lùi)
  const applyEntry = (entry: NavEntry) => {
    isNavigatingRef.current = true;
    if (entry.page === "library") {
      setLibraryFocusAppId(entry.libAppId);
    } else {
      setLibraryFocusAppId(undefined);
    }
    if (entry.page === "store" && entry.storePage) {
      storeState.goToPage(entry.storePage);
    }
    if (entry.page === "game-detail" && entry.detail) {
      setDetailAppid(entry.detail.appid);
      setDetailGameId(entry.detail.gameId);
      setDetailPrice(entry.detail.price);
      setDetailDrm(entry.detail.drm);
    }
    setActivePage(entry.page);
    // Nhả cờ sau khi render
    setTimeout(() => { isNavigatingRef.current = false; }, 0);
  };

  const navBack = () => {
    if (histIdx > 0) {
      const idx = histIdx - 1;
      setHistIdx(idx);
      applyEntry(history[idx]);
    }
  };

  const navForward = () => {
    if (histIdx < history.length - 1) {
      const idx = histIdx + 1;
      setHistIdx(idx);
      applyEntry(history[idx]);
    }
  };

  // Sync lại khi user prop thay đổi (sau refreshSession)
  useEffect(() => {
    setBalance(Number(user.balance ?? 0));
  }, [user.balance, user.id]);

  // Real-time poll balance: gọi getSessionLite mỗi 15s để bắt mọi thay đổi
  // (webhook nạp tiền, mua game ở tab khác, admin gift balance, ...)
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const session = await tauriAPI.supabase.getSessionLite();
        if (cancelled) return;
        const next = Number((session as { balance?: number })?.balance ?? NaN);
        if (Number.isFinite(next)) {
          setBalance((prev) => (prev !== next ? next : prev));
        }
      } catch (_) {}
    };
    const id = setInterval(tick, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Guardian mismatch polling - kiểm tra Steam ID mỗi 5s nếu đã liên kết
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        // Chỉ kiểm tra nếu đã liên kết tài khoản Steam
        const linked = await tauriAPI.steamLink.getLinkedAccount();
        if (!linked.linked) return;
        
        const verifyRes = await tauriAPI.steamLink.verifyLinkedAccount();
        if (cancelled) return;
        
        if (verifyRes.is_mismatch) {
          setGuardianMismatch(true);
          setGuardianMismatchMsg(
            `Tài khoản Steam hiện tại không khớp với tài khoản đã liên kết. Vui lòng đăng nhập đúng tài khoản Steam đã liên kết.`
          );
        } else {
          setGuardianMismatch(false);
          setGuardianMismatchMsg("");
        }
      } catch (_) {}
    };
    // Chạy ngay lần đầu
    void tick();
    // Sau đó mỗi 5s
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Handle force restart Steam khi có mismatch
  const handleForceRestartSteam = async () => {
    setGuardianMismatch(false);
    try {
      await tauriAPI.steamLink.forceRestartAndClear();
    } catch (e) {
      console.error("Force restart failed:", e);
    }
  };

  // Khi đổi trang trong Cửa Hàng → cập nhật history để tiến/lùi về đúng trang
  const lastStorePageRef = useRef(storeState.currentPage);
  useEffect(() => {
    if (activePage !== "store") return;
    if (isNavigatingRef.current) {
      lastStorePageRef.current = storeState.currentPage;
      return;
    }
    if (storeState.currentPage !== lastStorePageRef.current) {
      lastStorePageRef.current = storeState.currentPage;
      pushHistory({ page: "store", storePage: storeState.currentPage });
    }
  }, [storeState.currentPage, activePage]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayName =
    (user.display_name as string) ||
    user.displayName ||
    (user.username as string) ||
    user.email ||
    "Người dùng";

  // Avatar: dùng URL trực tiếp từ DB
  const avatarUrl = (user.avatar_url as string) || undefined;

  const handleLogout = () => tauriAPI.supabase.signOut();

  const handleGameClick = (game: GameItem) => {
    // Navigate to GameDetailPage — dùng Steam appid để fetch
    const appid = String(game.appid ?? "");
    if (!appid) return;
    setPrevPage(activePage);
    const gameId = game.id ? String(game.id) : "";
    const price = game.price !== undefined ? Number(game.price) : undefined;
    const drm = game.drm ? String(game.drm) : undefined;
    setDetailAppid(appid);
    setDetailGameId(gameId);
    setDetailPrice(price);
    setDetailDrm(drm);
    setDetailOriginalPrice(game.original_price !== undefined ? Number(game.original_price) : undefined);
    setDetailName(game.name ? String(game.name) : undefined);
    setDetailHeaderImage(
      (game.custom_image as string) || (game.header_image as string) || undefined
    );
    setActivePage("game-detail");
    pushHistory({ page: "game-detail", detail: { appid, gameId, price, drm } });
  };

  const handleNavigate = (page: AppPage) => {
    if (page !== "library") setLibraryFocusAppId(undefined);
    setActivePage(page);
    pushHistory(
      page === "store"
        ? { page, storePage: storeState.currentPage }
        : { page }
    );
  };

  const handleBrandClick = () => {
    setLibraryFocusAppId(undefined);
    setActivePage("store");
    storeState.goToPage(1);
    storeState.reload();
    pushHistory({ page: "store", storePage: 1 });
  };

  return (
    <div className="app-shell">
      <UpdateGate />

      {/* Guardian mismatch warning banner */}
      {guardianMismatch && (
        <div style={{
          background: "rgba(239,68,68,0.95)",
          borderBottom: "1px solid rgba(239,68,68,0.5)",
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          zIndex: 100,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>
              {guardianMismatchMsg}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setGuardianMismatch(false)}
              style={{
                padding: "6px 14px",
                background: "rgba(255,255,255,0.15)",
                border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: 6,
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Bỏ qua
            </button>
            <button
              onClick={handleForceRestartSteam}
              style={{
                padding: "6px 14px",
                background: "#fff",
                border: "none",
                borderRadius: 6,
                color: "#ef4444",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Khởi động lại Steam
            </button>
          </div>
        </div>
      )}

      <NavBar
        activePage={activePage}
        onNavigate={handleNavigate}
        onBrandClick={handleBrandClick}
        displayName={displayName}
        balance={balance}
        avatarUrl={avatarUrl}
        userRole={String(user.role ?? "user")}
        cartCount={cartCount}
        wishlistCount={wishlistCount}
        onAddFunds={() => setShowAddFunds(true)}
        onLogout={handleLogout}
        onRefreshSession={onRefreshSession}
        onReferral={() => setShowReferral(true)}
        onSteamLink={() => setShowSteamLink(true)}
      />

      {/* Sub-navbar — luôn hiện; btn bộ lọc + search chỉ hiện ở trang Store */}
      <div className="sub-navbar">
        <div className="sub-nav-arrows">
          <button type="button" className="sub-nav-arrow-btn" onClick={navBack} disabled={histIdx === 0}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button type="button" className="sub-nav-arrow-btn" onClick={navForward} disabled={histIdx >= history.length - 1}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        {activePage === "store" && (
          <div className="sub-nav-right">
            <FilterBar
              filters={storeState.filters}
              filterData={storeState.filterData}
              onChange={storeState.updateFilters}
            />
          </div>
        )}
      </div>

      <main className="app-shell-main">
        {activePage === "store" && (
          <StorePage
            store={storeState}
            onGameClick={handleGameClick}
          />
        )}
        {activePage === "library" && (
          <LibraryPage
            focusAppId={libraryFocusAppId}
            onSelectGame={(appid) => {
              if (isNavigatingRef.current) return;
              setLibraryFocusAppId(appid);
              pushHistory({ page: "library", libAppId: appid });
            }}
            onGoToStore={(appid) => {
              // Tìm game trong store để lấy đủ thông tin
              const g = storeState.allGames.find((x) => String(x.appid) === appid);
              if (g) {
                handleGameClick(g);
              } else {
                // Game chưa load trong store — navigate trực tiếp với appid
                setPrevPage("library");
                setDetailAppid(appid);
                setDetailGameId("");
                setDetailPrice(undefined);
                setDetailDrm(undefined);
                setDetailOriginalPrice(undefined);
                setDetailName(undefined);
                setDetailHeaderImage(undefined);
                setActivePage("game-detail");
                pushHistory({ page: "game-detail", detail: { appid, gameId: "" } });
              }
            }}
          />
        )}
        {activePage === "profile" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <ProfilePage
              user={user}
              onNavigateStore={() => handleNavigate("store")}
              onProfileUpdate={() => onRefreshSession?.()}
            />
          </div>
        )}
        {activePage === "admin" && (
          <AdminPage userRole={String(user.role ?? "user")} />
        )}
        {activePage === "cart" && (
          <CartPage
            cart={cart}
            currentBalance={balance}
            onPurchased={() => { onRefreshSession?.(); refreshOwned(); }}
            onGameClick={(appid) => {
              const g = storeState.allGames.find((x) => String(x.appid) === appid);
              if (g) handleGameClick(g);
            }}
          />
        )}
        {activePage === "wishlist" && (
          <WishlistPage
            wishlist={wishlist}
            onGameClick={(appid) => {
              const g = storeState.allGames.find((x) => String(x.appid) === appid);
              if (g) handleGameClick(g);
            }}
          />
        )}
        {activePage === "game-detail" && detailAppid && (
          <GameDetailPage
            appid={detailAppid}
            gameId={detailGameId}
            storePrice={detailPrice}
            originalPrice={detailOriginalPrice}
            gameName={detailName}
            headerImage={detailHeaderImage}
            drm={detailDrm}
            currentBalance={balance}
            onBack={() => setActivePage(prevPage)}
            onPurchased={() => {
              // Refresh session để cập nhật balance sau khi mua
              onRefreshSession?.();
              refreshOwned();
            }}
            onPlay={() => {
              setLibraryFocusAppId(detailAppid);
              setActivePage("library");
              pushHistory({ page: "library", libAppId: detailAppid });
            }}
            onDlcClick={(dlcAppid) => {
              setDlcDetailAppid(dlcAppid);
              setDlcDetailBaseAppid(detailAppid);
              setPrevPage("game-detail");
              setActivePage("dlc-detail");
              pushHistory({ page: "dlc-detail", detail: { appid: dlcAppid, gameId: "" } });
            }}
          />
        )}
        {activePage === "dlc-detail" && dlcDetailAppid && (
          <DlcDetailPage
            appid={dlcDetailAppid}
            baseAppid={dlcDetailBaseAppid}
            currentBalance={balance}
            onBack={() => setActivePage(prevPage)}
            onPurchased={() => {
              onRefreshSession?.();
              refreshOwned();
            }}
          />
        )}
      </main>

      {/* Referral Modal */}
      {showReferral && (
        <ReferralModal onClose={() => setShowReferral(false)} />
      )}

      {/* Add Funds Modal */}
      {showAddFunds && (
        <AddFundsModal          currentBalance={balance}
          onClose={() => setShowAddFunds(false)}
          onSuccess={(newBal) => {
            setBalance(newBal);
            onRefreshSession?.();
          }}
        />
      )}

      {/* Steam Link Modal */}
      {showSteamLink && (
        <SteamLinkModal
          onClose={() => setShowSteamLink(false)}
          onLinked={() => {
            // Refresh session after linking
            onRefreshSession?.();
          }}
        />
      )}
    </div>
  );
}
