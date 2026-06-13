// ============================================================
// Shared utility helpers (ported from src/js/utils.js)
// ============================================================

/** Format số với dấu "." sau mỗi 3 chữ số tính từ phải qua trái. */
export function formatThousands(n: number | string): string {
  const num = Math.round(Number(n) || 0);
  const sign = num < 0 ? "-" : "";
  return sign + Math.abs(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function formatMoney(n: number | string): string {
  return formatThousands(n) + " ₫";
}

export function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================
// Release date / Pre-order helpers
// ============================================================

/**
 * Parse chuỗi release_date của Steam (vd "25 Oct, 2024", "Oct 2024",
 * "Q1 2025", "2025", "Coming Soon") thành Date hoặc null nếu không parse được.
 */
export function parseSteamReleaseDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Các chuỗi không phải ngày cụ thể → coi như chưa có ngày (chưa ra mắt)
  if (/coming soon|sắp ra mắt|to be announced|tba|q[1-4]\b/i.test(s)) {
    return null;
  }

  // Thử parse trực tiếp (JS hiểu "25 Oct, 2024", "Oct 25, 2024"...)
  const direct = new Date(s);
  if (Number.isFinite(direct.getTime())) {
    return direct;
  }

  // Chỉ có năm → coi là 1/1 năm đó
  const yearOnly = s.match(/^\d{4}$/);
  if (yearOnly) {
    return new Date(Number(yearOnly[0]), 0, 1);
  }

  // "Tháng MM, YYYY" hoặc "MM/YYYY"
  const monthYear = s.match(/(\d{1,2})[\/\-](\d{4})/);
  if (monthYear) {
    return new Date(Number(monthYear[2]), Number(monthYear[1]) - 1, 1);
  }

  return null;
}

/**
 * Kiểm tra chuỗi release_date có chứa ngày ĐẦY ĐỦ (ngày + tháng + năm) không.
 * Vd "25 Oct, 2024", "Oct 25, 2024", "25/10/2024" → true.
 * "2024", "Oct 2024", "Q1 2025" → false (chỉ năm/tháng, không đủ chính xác).
 */
function hasFullDatePrecision(raw?: string | null): boolean {
  if (!raw) return false;
  const s = String(raw).trim();
  if (/\d{1,2}\s+[A-Za-zÀ-ỹ]+,?\s+\d{4}/.test(s)) return true; // 25 Oct, 2024
  if (/[A-Za-zÀ-ỹ]+\s+\d{1,2},?\s+\d{4}/.test(s)) return true; // Oct 25, 2024
  if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(s)) return true;  // 25/10/2024
  return false;
}

/**
 * Xác định game đã ra mắt chưa.
 * - Nếu parse được ngày cụ thể trong tương lai → chưa ra mắt.
 * - Nếu Steam đánh dấu coming_soon → chưa ra mắt, TRỪ KHI có ngày đầy đủ
 *   (ngày/tháng/năm) đã ở quá khứ (coming_soon cache cũ → coi như đã ra mắt).
 * - Còn lại → đã ra mắt.
 */
export function isGameReleased(comingSoon?: boolean, releaseDateStr?: string | null): boolean {
  const d = parseSteamReleaseDate(releaseDateStr);

  // Ngày cụ thể trong tương lai → chắc chắn chưa ra mắt
  if (d && d.getTime() > Date.now()) return false;

  if (comingSoon) {
    // Chỉ ghi đè coming_soon khi có ngày ĐẦY ĐỦ đã ở quá khứ (tránh cache stale)
    if (d && d.getTime() <= Date.now() && hasFullDatePrecision(releaseDateStr)) {
      return true;
    }
    return false;
  }

  return true;
}
