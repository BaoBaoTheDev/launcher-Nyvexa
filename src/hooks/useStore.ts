import { useCallback, useEffect, useRef, useState } from "react";
import { tauriAPI, GameItem, StoreAsset } from "../lib/tauri-api";
import {
  FilterData,
  FilterState,
  applyFilters,
  generateFilterData,
} from "../lib/gameFilters";

const ITEMS_PER_PAGE = 20;
const STORE_STATE_KEY = "Nyvexa:store:return-state:v1";
const STEAM_TAG_CACHE_KEY = "Nyvexa:store:steam-tags:v1";
const STEAM_TAG_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface StoreReturnState {
  page: number;
  scrollTop: number;
  filters: FilterState | null;
}

interface ReviewSummary {
  up: number;
  down: number;
  total: number;
}

export function useStore() {
  const [allGames, setAllGames] = useState<GameItem[]>([]);
  const [storeAssets, setStoreAssets] = useState<StoreAsset[]>([]);
  const [filterData, setFilterData] = useState<FilterData>({
    genres: [],
    drms: [],
    priceMin: 0,
    priceMax: 500000,
    yearMin: 2000,
    yearMax: new Date().getFullYear(),
  });
  const [filters, setFilters] = useState<FilterState>({
    search: "",
    priceMin: 0,
    priceMax: 500000,
    yearMin: 2000,
    yearMax: new Date().getFullYear(),
    genres: [],
    drms: [],
  });
  const [filteredGames, setFilteredGames] = useState<GameItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [reviewMap, setReviewMap] = useState<Record<string, ReviewSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const gamesRef = useRef<GameItem[]>([]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filteredGames.length / ITEMS_PER_PAGE));
  const pageItems = filteredGames.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );
  const saleGames = allGames
    .filter((g) => Number(g.original_price || 0) > Number(g.price || 0))
    .sort((a, b) => {
      const aOrig = Number(a.original_price || 0);
      const bOrig = Number(b.original_price || 0);
      const aP = aOrig > 0 ? (aOrig - Number(a.price || 0)) / aOrig : 0;
      const bP = bOrig > 0 ? (bOrig - Number(b.price || 0)) / bOrig : 0;
      return bP - aP;
    });

  // ── Persist / restore scroll + filter state ─────────────────────────────
  const saveReturnState = useCallback(
    (scrollTop = 0, overrideFilters?: FilterState, overridePage?: number) => {
      try {
        const state: StoreReturnState = {
          page: overridePage ?? currentPage,
          scrollTop,
          filters: overrideFilters ?? filters,
        };
        sessionStorage.setItem(STORE_STATE_KEY, JSON.stringify(state));
      } catch (_) {}
    },
    [currentPage, filters]
  );

  const loadReturnState = (): StoreReturnState | null => {
    try {
      const raw = sessionStorage.getItem(STORE_STATE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as StoreReturnState;
    } catch (_) {
      return null;
    }
  };

  // ── Filter application ──────────────────────────────────────────────────
  const applyCurrentFilters = useCallback(
    (games: GameItem[], newFilters: FilterState, preservePage = false) => {
      const result = applyFilters(games, newFilters);
      setFilteredGames(result);
      if (!preservePage) setCurrentPage(1);
    },
    []
  );

  const updateFilters = useCallback(
    (partial: Partial<FilterState>) => {
      setFilters((prev) => {
        const next = { ...prev, ...partial };
        applyCurrentFilters(gamesRef.current, next);
        return next;
      });
      setCurrentPage(1);
    },
    [applyCurrentFilters]
  );

  // ── Steam tag cache helpers ────────────────────────────────────────────
  const loadTagCache = (): Record<string, { tags: string[]; fetchedAt: number }> => {
    try {
      return JSON.parse(localStorage.getItem(STEAM_TAG_CACHE_KEY) || "{}") ?? {};
    } catch (_) {
      return {};
    }
  };

  const saveTagCache = (cache: Record<string, { tags: string[]; fetchedAt: number }>) => {
    try {
      localStorage.setItem(STEAM_TAG_CACHE_KEY, JSON.stringify(cache));
    } catch (_) {}
  };

  // ── Initial data load ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Debug: xem token và Supabase URL
        const dbg = await tauriAPI.games.debugInfo();
        console.log("[useStore] debug info:", JSON.stringify(dbg));
        if (!dbg.has_token) {
          // Mất session → đăng xuất ngay để về màn login
          tauriAPI.supabase.signOut().catch(() => {});
          return;
        }

        const [gamesRes, assets] = await Promise.all([
          tauriAPI.games.list(),
          tauriAPI.admin.listStoreAssets(),
        ]);

        if (cancelled) return;

        const games: GameItem[] = gamesRes.data ?? [];
        gamesRef.current = games;

        const returnState = loadReturnState();
        const fd = generateFilterData(games);
        const initialFilters: FilterState = returnState?.filters ?? {
          search: "",
          priceMin: fd.priceMin,
          priceMax: fd.priceMax,
          yearMin: fd.yearMin,
          yearMax: fd.yearMax,
          genres: [],
          drms: [],
        };

        setAllGames(games);
        setStoreAssets(assets ?? []);
        setFilterData(fd);
        setFilters(initialFilters);
        const initialPage = returnState?.page ?? 1;
        setCurrentPage(initialPage);

        const result = applyFilters(games, initialFilters);
        setFilteredGames(result);

        // Background: review summaries
        tauriAPI.games
          .listReviewSummaries({ gameIds: games.map((g) => g.id ?? "") })
          .then((res) => {
            if (!cancelled && res.success && res.data) {
              // RPC trả mảng [{game_id, up, down, total}] → transform thành map
              if (Array.isArray(res.data)) {
                const map: Record<string, ReviewSummary> = {};
                for (const row of res.data as Array<{ game_id?: string; up?: number; down?: number; total?: number }>) {
                  if (row.game_id) map[row.game_id] = { up: Number(row.up || 0), down: Number(row.down || 0), total: Number(row.total || 0) };
                }
                setReviewMap(map);
              } else {
                setReviewMap(res.data);
              }
            }
          })
          .catch(() => {});

        // Background: steam tags
        const cache = loadTagCache();
        const now = Date.now();
        let cacheUpdated = false;
        const updated = games.map((g) => {
          const appid = String(g.appid || "").trim();
          if (!appid) return g;
          const cached = cache[appid];
          if (
            cached &&
            Array.isArray(cached.tags) &&
            now - cached.fetchedAt < STEAM_TAG_CACHE_TTL_MS
          ) {
            return { ...g, steam_tags: cached.tags.join(", ") };
          }
          return g;
        });
        if (JSON.stringify(updated) !== JSON.stringify(games)) {
          gamesRef.current = updated;
          if (!cancelled) {
            setAllGames(updated);
            const fd2 = generateFilterData(updated);
            setFilterData(fd2);
            const result2 = applyFilters(updated, initialFilters);
            setFilteredGames(result2);
          }
        }
        if (cacheUpdated) saveTagCache(cache);
      } catch (err) {
        if (!cancelled) {
          // Tauri v2: khi Rust trả về Err(String), invoke() throw string đó trực tiếp
          const msg = typeof err === "string" ? err : String((err as Error)?.message ?? err ?? "Lỗi tải cửa hàng.");
          console.error("[useStore] load error:", err, "→", msg);
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(totalPages, page));
      setCurrentPage(clamped);
    },
    [totalPages]
  );

  return {
    allGames,
    storeAssets,
    filterData,
    filters,
    filteredGames,
    pageItems,
    currentPage,
    totalPages,
    reviewMap,
    loading,
    error,
    saleGames,
    updateFilters,
    goToPage,
    saveReturnState,
    reload,
  };
}
