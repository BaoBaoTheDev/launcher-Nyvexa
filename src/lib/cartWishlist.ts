// ============================================================
// Cart + Wishlist store (localStorage-backed, games-only)
// Ported & adapted from Electron src/js/cart.js
// Uses a tiny pub/sub so all React components stay in sync
// within the same window (storage events don't fire same-tab).
// ============================================================

import { GameItem } from "./tauri-api";

const CART_KEY = "Nyvexa:cart:v1";
const WISHLIST_KEY = "Nyvexa:wishlist:v1";

export interface CartItem {
  gameId: string;
  appid: string;
  name: string;
  price: number;
  originalPrice: number;
  img?: string | null;
}

export interface WishlistItem {
  gameId: string;
  appid: string;
  name: string;
  price: number;
  originalPrice: number;
  img?: string | null;
}

// ─── Generic JSON storage helpers ────────────────────────────────────────────

function readList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, items: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items || []));
  } catch {
    /* ignore */
  }
}

// ─── Pub/sub ──────────────────────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

// ─── Owned games (để chặn thêm game đã sở hữu) ────────────────────────────────

let ownedIds = new Set<string>();

export function isOwned(gameId: string | number | undefined | null): boolean {
  const id = String(gameId ?? "").trim();
  return !!id && ownedIds.has(id);
}

/** Cập nhật danh sách game đã sở hữu; tự động loại các game này khỏi cart + wishlist. */
export function setOwnedIds(ids: (string | number)[]): void {
  ownedIds = new Set(ids.map((x) => String(x).trim()).filter(Boolean));
  pruneOwned();
}

/** Xoá khỏi cart + wishlist mọi game đã sở hữu. */
export function pruneOwned(): void {
  let changed = false;
  const cart = getCart().filter((x) => {
    if (ownedIds.has(String(x.gameId).trim())) { changed = true; return false; }
    return true;
  });
  const wishlist = getWishlist().filter((x) => {
    if (ownedIds.has(String(x.gameId).trim())) { changed = true; return false; }
    return true;
  });
  if (changed) {
    writeList(CART_KEY, cart);
    writeList(WISHLIST_KEY, wishlist);
    emit();
  }
}

// ─── Mapping helper ──────────────────────────────────────────────────────────

function toItem(game: GameItem): CartItem {
  return {
    gameId: String(game.id ?? ""),
    appid: String(game.appid ?? ""),
    name: game.name || `Game ${game.appid ?? ""}`,
    price: Number(game.price ?? 0),
    originalPrice: Number(game.original_price ?? 0),
    img:
      (game.custom_image as string) ||
      (game.header_image as string) ||
      null,
  };
}

// ─── Cart API ──────────────────────────────────────────────────────────────────

export function getCart(): CartItem[] {
  return readList<CartItem>(CART_KEY);
}

export function getCartCount(): number {
  return getCart().length;
}

export function isInCart(gameId: string | number | undefined | null): boolean {
  const id = String(gameId ?? "").trim();
  if (!id) return false;
  return getCart().some((x) => String(x.gameId).trim() === id);
}

/** Thêm game vào giỏ. Trả về true nếu thêm mới, false nếu đã có hoặc đã sở hữu. */
export function addToCart(game: GameItem): boolean {
  const item = toItem(game);
  if (!item.gameId) return false;
  if (isOwned(item.gameId)) return false;
  const items = getCart();
  if (items.some((x) => x.gameId === item.gameId)) return false;
  items.push(item);
  writeList(CART_KEY, items);
  emit();
  return true;
}

export function removeFromCart(gameId: string | number): void {
  const id = String(gameId).trim();
  writeList(
    CART_KEY,
    getCart().filter((x) => String(x.gameId).trim() !== id)
  );
  emit();
}

export function clearCart(): void {
  writeList<CartItem>(CART_KEY, []);
  emit();
}

// ─── Wishlist API ───────────────────────────────────────────────────────────

export function getWishlist(): WishlistItem[] {
  return readList<WishlistItem>(WISHLIST_KEY);
}

export function getWishlistCount(): number {
  return getWishlist().length;
}

export function isInWishlist(gameId: string | number | undefined | null): boolean {
  const id = String(gameId ?? "").trim();
  if (!id) return false;
  return getWishlist().some((x) => String(x.gameId).trim() === id);
}

/** Bật/tắt game trong wishlist. Trả về true nếu giờ đang nằm trong wishlist. */
export function toggleWishlist(game: GameItem): boolean {
  const item = toItem(game);
  if (!item.gameId) return false;
  const items = getWishlist();
  const exists = items.some((x) => x.gameId === item.gameId);
  if (exists) {
    writeList(
      WISHLIST_KEY,
      items.filter((x) => x.gameId !== item.gameId)
    );
    emit();
    return false;
  }
  // Không cho thêm game đã sở hữu
  if (isOwned(item.gameId)) return false;
  items.push(item);
  writeList(WISHLIST_KEY, items);
  emit();
  return true;
}

export function removeFromWishlist(gameId: string | number): void {
  const id = String(gameId).trim();
  writeList(
    WISHLIST_KEY,
    getWishlist().filter((x) => String(x.gameId).trim() !== id)
  );
  emit();
}

export function clearWishlist(): void {
  writeList<WishlistItem>(WISHLIST_KEY, []);
  emit();
}
