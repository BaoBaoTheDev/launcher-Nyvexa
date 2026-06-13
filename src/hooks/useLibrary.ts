import { useCallback, useEffect, useRef, useState } from "react";
import { tauriAPI, GameItem, SteamAppDetails, MovieHistoryItem } from "../lib/tauri-api";
import { steamAppAssetUrl, DEFAULT_STEAM_BACKGROUND_URL } from "../lib/runtimeUrls";

export type LibraryTab = "games" | "movies";

export interface OwnedGame extends GameItem {
  steamDetails?: SteamAppDetails | null;
}

export function useLibrary(focusAppId?: string) {
  const [tab, setTab] = useState<LibraryTab>("games");
  const [searchTerm, setSearchTerm] = useState("");
  const [games, setGames] = useState<OwnedGame[]>([]);
  const [movies, setMovies] = useState<MovieHistoryItem[]>([]);
  const [selectedGame, setSelectedGame] = useState<OwnedGame | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<MovieHistoryItem | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [steamDetails, setSteamDetails] = useState<SteamAppDetails | null>(null);
  const [ownedDlcIds, setOwnedDlcIds] = useState<string[]>([]);
  const [iconMap, setIconMap] = useState<Record<string, string>>({});
  const [heroMap, setHeroMap] = useState<Record<string, string>>({});
  const detailCancelRef = useRef<boolean>(false);

  // ── Sidebar filter ──────────────────────────────────────────────────────
  const filteredGames = games.filter((g) =>
    (g.name || "").toLowerCase().includes(searchTerm.toLowerCase())
  );
  const filteredMovies = movies.filter((m) =>
    (m.movie_name || m.origin_name || m.slug || "")
      .toLowerCase()
      .includes(searchTerm.toLowerCase())
  );

  // ── Load game list ──────────────────────────────────────────────────────
  const loadGames = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    setTab("games");
    try {
      const owned = await tauriAPI.userGames.listOwned();
      const sorted = [...(owned ?? [])].sort((a, b) =>
        (a.name || "").localeCompare(b.name || "")
      );
      setGames(sorted);

      // Khởi tạo icon/hero từ giá trị đã lưu trong DB (nếu có)
      const dbIcons: Record<string, string> = {};
      const dbHeroes: Record<string, string> = {};
      sorted.forEach((g) => {
        const id = String(g.appid || "").trim();
        if (!id) return;
        if (g.library_icon_url) dbIcons[id] = String(g.library_icon_url);
        if (g.library_hero_url) dbHeroes[id] = String(g.library_hero_url);
      });
      if (Object.keys(dbIcons).length) setIconMap((prev) => ({ ...dbIcons, ...prev }));
      if (Object.keys(dbHeroes).length) setHeroMap((prev) => ({ ...dbHeroes, ...prev }));

      // Chỉ fetch icon_hash cho game CHƯA có icon lưu trong DB
      const ids = sorted
        .map((g) => String(g.appid || "").trim())
        .filter((id) => /^\d+$/.test(id) && !dbIcons[id]);
      Promise.allSettled(ids.map((id) => tauriAPI.steam.getAppIcon(id))).then((results) => {
        const map: Record<string, string> = {};
        results.forEach((r, i) => {
          if (r.status === "fulfilled" && r.value?.icon_url) {
            const id = ids[i];
            map[id] = r.value.icon_url;
            // Lưu icon + hero (library_hero.jpg) vào DB để lần sau khỏi fetch
            const hero = `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_hero.jpg`;
            tauriAPI.games.setLibraryAssets(id, r.value.icon_url, hero).catch(() => {});
          }
        });
        if (Object.keys(map).length) setIconMap((prev) => ({ ...prev, ...map }));
      });

      // Auto-select: focusAppId or first
      const focusIndex = focusAppId
        ? sorted.findIndex((g) => String(g.appid || "").trim() === focusAppId)
        : -1;
      const activeGame = sorted[focusIndex >= 0 ? focusIndex : 0] ?? null;
      if (activeGame) {
        setSelectedGame(activeGame);
        loadGameDetail(activeGame);
      } else {
        setSelectedGame(null);
      }
    } catch (err) {
      const msg = typeof err === "string" ? err : String((err as Error)?.message ?? String(err) ?? "Lỗi tải thư viện game.");
      console.error("[useLibrary] loadGames error:", err, "→", msg);
      setListError(msg);
    } finally {
      setLoadingList(false);
    }
  }, [focusAppId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load movie list ─────────────────────────────────────────────────────
  const loadMovies = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    setTab("movies");
    try {
      const res = await tauriAPI.community.listMovieHistory();
      const items = res.data ?? [];
      setMovies(items);
      if (items.length > 0) {
        setSelectedMovie(items[0]);
      } else {
        setSelectedMovie(null);
      }
    } catch (err) {
      const msg = typeof err === "string" ? err : String((err as Error)?.message ?? String(err) ?? "Lỗi tải lịch sử phim.");
      setListError(msg);
    } finally {
      setLoadingList(false);
    }
  }, []);

  // ── Load game detail ────────────────────────────────────────────────────
  const loadGameDetail = useCallback(async (game: OwnedGame) => {
    detailCancelRef.current = true;
    const token = {};
    detailCancelRef.current = false;

    setSelectedGame(game);
    setSteamDetails(null);
    setOwnedDlcIds([]);
    setLoadingDetail(true);
    setSelectedMovie(null);

    try {
      const appid = String(game.appid ?? "");
      const [steamData, dlcRes] = await Promise.all([
        // fetchSteamFull (qua Rust) đáng tin cậy hơn edge function cho dev/pub/ngày phát hành
        tauriAPI.adminApi.fetchSteamFull(appid).catch(() => null),
        tauriAPI.dlc.listOwnedForBasegame(game.appid ?? "").catch(() => ({ data: [] })),
      ]);

      if ((token as { cancelled?: boolean }).cancelled) return;

      setSteamDetails((steamData as SteamAppDetails) ?? null);
      setOwnedDlcIds(dlcRes.data ?? []);
    } catch (_) {
      if (!(token as { cancelled?: boolean }).cancelled) {
        setSteamDetails(null);
      }
    } finally {
      if (!(token as { cancelled?: boolean }).cancelled) {
        setLoadingDetail(false);
      }
    }
  }, []);

  // ── DLC selection (localStorage) ───────────────────────────────────────
  const getDlcKey = (appId: string) => `Nyvexa:selected-dlcs:${appId}`;

  const loadSelectedDlcIds = useCallback((appId: string): string[] => {
    try {
      const raw = localStorage.getItem(getDlcKey(appId));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map((x) => String(x || "").trim()).filter((x) => /^\d+$/.test(x))
        : [];
    } catch (_) {
      return [];
    }
  }, []);

  const saveSelectedDlcIds = useCallback((appId: string, ids: string[]) => {
    try {
      const uniq = Array.from(
        new Set(ids.map((x) => String(x || "").trim()).filter((x) => /^\d+$/.test(x)))
      );
      localStorage.setItem(getDlcKey(appId), JSON.stringify(uniq));
    } catch (_) {}
  }, []);

  // ── Steam app asset helper (exposed to components) ──────────────────────
  const getGameImage = useCallback(
    (appId: string | number | undefined | null): string => {
      const id = String(appId || "").trim();
      if (!id) return DEFAULT_STEAM_BACKGROUND_URL;
      // Ưu tiên icon_hash thật từ ICommunityService, fallback capsule
      return iconMap[id] || steamAppAssetUrl(id, "capsule_184x69.jpg");
    },
    [iconMap]
  );

  const getGameHero = useCallback(
    (appId: string | number | undefined | null): string => {
      const id = String(appId || "").trim();
      if (!id) return DEFAULT_STEAM_BACKGROUND_URL;
      return heroMap[id] || `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_hero.jpg`;
    },
    [heroMap]
  );

  // ── Initial load ────────────────────────────────────────────────────────
  useEffect(() => {
    loadGames();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Đổi game khi focusAppId thay đổi (tiến/lùi tới game cụ thể) ──────────
  useEffect(() => {
    if (!focusAppId) return;
    if (selectedGame && String(selectedGame.appid || "").trim() === focusAppId) return;
    const target = games.find((g) => String(g.appid || "").trim() === focusAppId);
    if (target) loadGameDetail(target);
  }, [focusAppId, games]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    tab,
    searchTerm,
    setSearchTerm,
    games,
    filteredGames,
    filteredMovies,
    selectedGame,
    selectedMovie,
    steamDetails,
    ownedDlcIds,
    loadingList,
    loadingDetail,
    listError,
    loadGames,
    loadMovies,
    loadGameDetail,
    setSelectedMovie,
    loadSelectedDlcIds,
    saveSelectedDlcIds,
    getGameImage,
    getGameHero,
  };
}
