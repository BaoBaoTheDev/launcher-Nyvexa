import { useCallback, useEffect, useState } from "react";
import {
  CartItem,
  WishlistItem,
  getCart,
  getWishlist,
  subscribe,
  setOwnedIds,
  addToCart as addToCartStore,
  removeFromCart as removeFromCartStore,
  clearCart as clearCartStore,
  toggleWishlist as toggleWishlistStore,
  removeFromWishlist as removeFromWishlistStore,
  clearWishlist as clearWishlistStore,
} from "../lib/cartWishlist";
import { GameItem, tauriAPI } from "../lib/tauri-api";

/** Hook đồng bộ cart + wishlist với localStorage qua pub/sub. */
export function useCartWishlist() {
  const [cart, setCart] = useState<CartItem[]>(() => getCart());
  const [wishlist, setWishlist] = useState<WishlistItem[]>(() => getWishlist());

  useEffect(() => {
    const refresh = () => {
      setCart(getCart());
      setWishlist(getWishlist());
    };
    refresh();
    return subscribe(refresh);
  }, []);

  // Tải danh sách game đã sở hữu để chặn thêm vào cart/wishlist + tự dọn
  const refreshOwned = useCallback(async () => {
    try {
      const owned = await tauriAPI.userGames.listOwned();
      const ids = (owned ?? []).map((g) => String(g.id ?? "")).filter(Boolean);
      setOwnedIds(ids);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshOwned();
  }, [refreshOwned]);

  const addToCart = useCallback((game: GameItem) => addToCartStore(game), []);
  const removeFromCart = useCallback((gameId: string | number) => removeFromCartStore(gameId), []);
  const clearCart = useCallback(() => clearCartStore(), []);
  const toggleWishlist = useCallback((game: GameItem) => toggleWishlistStore(game), []);
  const removeFromWishlist = useCallback((gameId: string | number) => removeFromWishlistStore(gameId), []);
  const clearWishlist = useCallback(() => clearWishlistStore(), []);

  return {
    cart,
    wishlist,
    cartCount: cart.length,
    wishlistCount: wishlist.length,
    refreshOwned,
    addToCart,
    removeFromCart,
    clearCart,
    toggleWishlist,
    removeFromWishlist,
    clearWishlist,
  };
}
