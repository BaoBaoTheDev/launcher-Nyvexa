import { useCallback, useEffect, useState } from "react";
import { tauriAPI } from "../lib/tauri-api";

export interface SessionUser {
  id: string;
  email?: string;
  displayName?: string;
  username?: string;
  role?: string;
  is_banned?: boolean;
  ban_reason?: string | null;
  ban_until?: string | null;
  banned_at?: string | null;
  [key: string]: unknown;
}

export function useSessionBootstrap() {
  const [session, setSession] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const safeLoad = async () => {
      try {
        const data = await tauriAPI.supabase.getSession();
        if (mounted && data && typeof data === "object" && "id" in (data as object)) {
          setSession({ ...(data as SessionUser) });
        }
      } catch {
        if (mounted) setSession(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    // Khi app vừa mở (cold start) — luôn yêu cầu login lại để bảo mật.
    // Sau khi login lần đầu, các re-mount khác (vd HMR ở dev, navigation)
    // sẽ vẫn dùng session đã lưu.
    const isColdStart = !sessionStorage.getItem("nyvexa:bootstrapped");
    sessionStorage.setItem("nyvexa:bootstrapped", "1");

    if (isColdStart) {
      // Xoá session đã lưu trên disk → bắt user chọn account / login lại
      tauriAPI.supabase.signOut()
        .catch(() => {})
        .finally(() => {
          if (mounted) {
            setSession(null);
            setLoading(false);
          }
        });
    } else {
      safeLoad();
    }

    // Re-fetch khi tab lấy lại focus
    const onFocus = () => safeLoad();
    window.addEventListener("focus", onFocus);

    // Polling định kỳ mỗi 15s để đồng bộ balance/role thay đổi từ DB
    const pollTimer = setInterval(() => {
      if (mounted) safeLoad();
    }, 15000);

    const unlisten = tauriAPI.supabase.onAuthStateChange(({ event }) => {
      if (event === "SIGNED_OUT") {
        if (mounted) setSession(null);
      } else if (event === "SIGNED_IN") {
        safeLoad();
      }
    });

    return () => {
      mounted = false;
      window.removeEventListener("focus", onFocus);
      clearInterval(pollTimer);
      unlisten();
    };
  }, []);

  // refreshSession: gọi thủ công để re-fetch profile từ server
  const refreshSession = useCallback(async () => {
    try {
      const data = await tauriAPI.supabase.getSession();
      if (data && typeof data === "object" && "id" in (data as object)) {
        const user = data as SessionUser;

        // Bổ sung role/balance trực tiếp từ DB nếu session thiếu (fallback an toàn)
        if (!user.role || user.role === "user" || user.balance === undefined) {
          try {
            const dbg = await tauriAPI.adminApi.debugMyRole();
            const dbRows = dbg.db_result as Array<{ role?: string; display_name?: string; balance?: number | string }>;
            if (Array.isArray(dbRows) && dbRows.length > 0) {
              const row = dbRows[0];
              if (row.role && (!user.role || user.role === "user")) user.role = row.role;
              if (row.display_name && !user.display_name) user.display_name = row.display_name;
              if (row.balance !== undefined && user.balance === undefined) {
                user.balance = typeof row.balance === "string" ? Number(row.balance) : row.balance;
              }
            }
          } catch (_) {}
        }

        // Force new object reference to ensure re-render
        setSession({ ...user });
        return user;
      }
    } catch (e) {
      console.error("[refreshSession] error:", e);
    }
    return null;
  }, []);

  return { session, loading, setSession, refreshSession };
}
