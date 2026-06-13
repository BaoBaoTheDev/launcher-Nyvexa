import { useState } from "react";
import { WishlistItem, removeFromWishlist, clearWishlist, addToCart, isInCart } from "../../lib/cartWishlist";
import { GameItem } from "../../lib/tauri-api";
import { steamAppAssetUrl, DEFAULT_STEAM_BACKGROUND_URL } from "../../lib/runtimeUrls";
import { formatMoney } from "../../lib/utils";
import "../../styles/cart.css";

interface WishlistPageProps {
  wishlist: WishlistItem[];
  onGameClick?: (appid: string) => void;
}

export function WishlistPage({ wishlist, onGameClick }: WishlistPageProps) {
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleAddToCart = (item: WishlistItem) => {
    const game: GameItem = {
      id: item.gameId,
      appid: item.appid,
      name: item.name,
      price: item.price,
      original_price: item.originalPrice,
      header_image: item.img ?? undefined,
    };
    if (isInCart(item.gameId)) {
      showToast("Game đã có trong giỏ hàng.");
      return;
    }
    if (addToCart(game)) showToast("Đã thêm vào giỏ hàng.");
  };

  if (wishlist.length === 0) {
    return (
      <div className="cw-page">
        <div className="cw-title">Danh sách yêu thích</div>
        <div className="cw-empty">
          <div className="cw-empty-icon">♡</div>
          <div>Chưa có game yêu thích nào.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="cw-page">
      <div className="cw-title">Danh sách yêu thích ({wishlist.length})</div>

      <div className="cw-list">
        {wishlist.map((item) => {
          const appid = String(item.appid || "").trim();
          const img = item.img || steamAppAssetUrl(appid, "header.jpg");
          const isOnSale = Number(item.originalPrice || 0) > Number(item.price || 0);
          return (
            <div key={item.gameId} className="cw-row">
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
                <div className="cw-row-actions">
                  <button className="btn-primary" onClick={() => handleAddToCart(item)}>Thêm vào giỏ</button>
                  <button className="btn-secondary" onClick={() => removeFromWishlist(item.gameId)}>Xoá</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="cw-footer">
        <div className="cw-spacer" />
        <button className="btn-secondary" onClick={() => clearWishlist()}>Xoá tất cả</button>
      </div>

      {toast && <div className="cw-toast info">{toast}</div>}
    </div>
  );
}
