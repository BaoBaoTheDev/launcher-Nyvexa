import { useMemo, useState } from "react";
import { CartItem, removeFromCart, clearCart } from "../../lib/cartWishlist";
import { steamAppAssetUrl, DEFAULT_STEAM_BACKGROUND_URL } from "../../lib/runtimeUrls";
import { formatMoney } from "../../lib/utils";
import { PurchaseModal, PurchaseItem } from "../../components/PurchaseModal";
import "../../styles/cart.css";

interface CartPageProps {
  cart: CartItem[];
  currentBalance?: number;
  onPurchased?: () => void;
  onGameClick?: (appid: string) => void;
}

type ToastType = "success" | "error" | "warning" | "info";

export function CartPage({ cart, currentBalance, onPurchased, onGameClick }: CartPageProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(cart.map((x) => x.gameId))
  );
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: ToastType } | null>(null);

  const showToast = (msg: string, type: ToastType) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const total = useMemo(
    () =>
      cart
        .filter((x) => selected.has(x.gameId))
        .reduce((sum, x) => sum + Number(x.price || 0), 0),
    [cart, selected]
  );

  const toggle = (gameId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(gameId) ? next.delete(gameId) : next.add(gameId);
      return next;
    });
  };

  const setAll = (flag: boolean) => {
    setSelected(flag ? new Set(cart.map((x) => x.gameId)) : new Set());
  };

  const handleRemoveSelected = () => {
    cart.forEach((x) => { if (selected.has(x.gameId)) removeFromCart(x.gameId); });
  };

  const handleCheckout = () => {
    if (selected.size === 0) {
      showToast("Vui lòng chọn ít nhất 1 sản phẩm.", "warning");
      return;
    }
    setShowPurchaseModal(true);
  };

  const handlePurchaseSuccess = () => {
    // Xóa các item đã mua khỏi cart
    cart.forEach((x) => {
      if (selected.has(x.gameId)) removeFromCart(x.gameId);
    });
    onPurchased?.();
    setShowPurchaseModal(false);
  };

  const purchaseItems: PurchaseItem[] = cart
    .filter((x) => selected.has(x.gameId))
    .map((x) => ({
      id: x.gameId,
      appid: String(x.appid || ""),
      name: x.name || `Game ${x.appid}`,
      price: Number(x.price || 0),
      originalPrice: Number(x.originalPrice || 0),
      type: "game",
    }));

  if (cart.length === 0) {
    return (
      <div className="cw-page">
        <div className="cw-title">Giỏ hàng</div>
        <div className="cw-empty">
          <div className="cw-empty-icon">🛒</div>
          <div>Giỏ hàng trống.</div>
        </div>
        {toast && <div className={`cw-toast ${toast.type}`}>{toast.msg}</div>}
      </div>
    );
  }

  return (
    <div className="cw-page">
      <div className="cw-title">Giỏ hàng ({cart.length})</div>

      <div className="cw-list">
        {cart.map((item) => {
          const appid = String(item.appid || "").trim();
          const img = item.img || steamAppAssetUrl(appid, "header.jpg");
          const isOnSale = Number(item.originalPrice || 0) > Number(item.price || 0);
          return (
            <div key={item.gameId} className="cw-row">
              <input
                type="checkbox"
                className="cw-check"
                checked={selected.has(item.gameId)}
                onChange={() => toggle(item.gameId)}
              />
              <img
                className="cw-logo"
                src={img}
                alt=""
                onClick={() => onGameClick?.(appid)}
                style={{ cursor: onGameClick ? "pointer" : "default" }}
                onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_STEAM_BACKGROUND_URL; }}
              />
              <div className="cw-meta">
                <div className="cw-name" onClick={() => onGameClick?.(appid)} style={{ cursor: onGameClick ? "pointer" : "default" }}>
                  {item.name}
                </div>
              </div>
              <div className="cw-right">
                <div className="cw-price">
                  {isOnSale && <span className="cw-orig">{formatMoney(item.originalPrice)}</span>}
                  <span className="cw-cur">{Number(item.price) === 0 ? "Miễn phí" : formatMoney(item.price)}</span>
                </div>
                <button className="btn-secondary" onClick={() => removeFromCart(item.gameId)}>Xoá</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="cw-footer">
        <button className="btn-secondary" onClick={() => setAll(true)}>Chọn tất cả</button>
        <button className="btn-secondary" onClick={() => setAll(false)}>Bỏ chọn</button>
        <button className="btn-secondary" onClick={handleRemoveSelected}>Xoá đã chọn</button>
        <button className="btn-secondary" onClick={() => clearCart()}>Xoá tất cả</button>
        <div className="cw-spacer" />
        <div className="cw-total">Tổng: <strong>{formatMoney(total)}</strong></div>
        <button
          className="btn-primary"
          disabled={selected.size === 0}
          onClick={handleCheckout}
        >
          Thanh toán đã chọn
        </button>
      </div>

      {toast && <div className={`cw-toast ${toast.type}`}>{toast.msg}</div>}

      {showPurchaseModal && purchaseItems.length > 0 && (
        <PurchaseModal
          items={purchaseItems}
          currentBalance={currentBalance ?? 0}
          onClose={() => setShowPurchaseModal(false)}
          onPurchased={handlePurchaseSuccess}
        />
      )}
    </div>
  );
}
