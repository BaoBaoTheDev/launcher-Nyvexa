// ============================================================
// Game tag / filter helpers (ported from src/js/filters.js)
// ============================================================

// Re-export GameItem from the single source of truth
export type { GameItem } from "./tauri-api";
import type { GameItem } from "./tauri-api";

export interface FilterData {
  genres: string[];
  drms: string[];
  priceMin: number;
  priceMax: number;
  yearMin: number;
  yearMax: number;
}

export interface FilterState {
  search: string;
  priceMin: number;
  priceMax: number;
  yearMin: number;
  yearMax: number;
  genres: string[];
  drms: string[];
}

export function extractGameTags(game: GameItem): string[] {
  if (!game || typeof game !== "object") return [];
  const tags = new Set<string>();
  const collect = (value: unknown) => {
    String(value || "")
      .split(",")
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .forEach((item) => tags.add(item));
  };
  collect(game.genres);
  collect(game.steam_tags);
  return Array.from(tags);
}

export function generateFilterData(games: GameItem[]): FilterData {
  const genres = new Set<string>();
  const drms = new Set<string>();
  let maxPrice = 0;
  let minYear = Infinity;
  let maxYear = 0;

  games.forEach((g) => {
    // Genres: gộp từ cả genres và steam_tags
    extractGameTags(g).forEach((t) => genres.add(t));

    if (g.release_date) {
      const yearMatch = String(g.release_date).match(/\d{4}/);
      if (yearMatch) {
        const year = parseInt(yearMatch[0]);
        minYear = Math.min(minYear, year);
        maxYear = Math.max(maxYear, year);
      }
    }

    if (g.drm) {
      String(g.drm)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .forEach((p) => drms.add(p));
    }

    const price = Number(g.price ?? 0);
    if (Number.isFinite(price)) {
      maxPrice = Math.max(maxPrice, price);
    }
  });

  // Giá tối đa = đúng giá game cao nhất (không làm tròn)
  const finalMaxPrice = maxPrice > 0 ? maxPrice : 500000;
  const currentYear = new Date().getFullYear();
  const finalMinYear = minYear === Infinity ? 2000 : minYear;
  const finalMaxYear = maxYear === 0 ? currentYear : maxYear;

  return {
    genres: Array.from(genres).sort((a, b) => a.localeCompare(b)),
    drms: Array.from(drms).sort(),
    priceMin: 0,
    priceMax: finalMaxPrice,
    yearMin: finalMinYear,
    yearMax: finalMaxYear,
  };
}

export function applyFilters(
  games: GameItem[],
  filters: FilterState
): GameItem[] {
  const searchTerm = filters.search.toLowerCase();

  return games.filter((g) => {
    const matchesSearch =
      (g.name || "").toLowerCase().includes(searchTerm) ||
      String(g.appid || "").includes(searchTerm);

    const price = Number(g.price ?? 0);
    const matchesPrice =
      price >= filters.priceMin && price <= filters.priceMax;

    let matchesYear = true;
    if (g.release_date) {
      const yearMatch = String(g.release_date).match(/\d{4}/);
      if (yearMatch) {
        const gameYear = parseInt(yearMatch[0]);
        matchesYear =
          gameYear >= filters.yearMin && gameYear <= filters.yearMax;
      }
    }

    let matchesDrm = true;
    if (filters.drms.length > 0) {
      const gameDrms = String(g.drm || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      matchesDrm = filters.drms.some((d) => gameDrms.includes(d));
    }

    let matchesGenre = true;
    if (filters.genres.length > 0) {
      const gameTags = extractGameTags(g);
      matchesGenre = filters.genres.every((selected) =>
        gameTags.includes(selected)
      );
    }

    return (
      matchesSearch &&
      matchesPrice &&
      matchesYear &&
      matchesDrm &&
      matchesGenre
    );
  });
}
