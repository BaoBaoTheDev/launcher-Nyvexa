import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { tauriAPI, SignInResult } from "../lib/tauri-api";
import { upsertSavedAccount } from "./useSavedAccounts";
import type { SessionUser } from "./useSessionBootstrap";

const LOGIN_TIMEOUT_MS = 60000;

function ensureClientDeviceId(): string {
  const existing = localStorage.getItem("deviceId")?.trim() ?? "";
  if (/^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const generated = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  localStorage.setItem("deviceId", generated);
  return generated;
}

function toFriendlyLoginErrorMessage(error: unknown, timeoutMs: number): string {
  const rawMessage = String((error as Error)?.message || "").trim();
  const timeoutMessage = `Yêu cầu timeout sau ${Math.round(timeoutMs / 1000)} giây, vui lòng kiểm tra kết nối mạng hoặc thử lại.`;
  if (!rawMessage) return "Lỗi đăng nhập, vui lòng thử lại.";
  if (/timeout/i.test(rawMessage)) return timeoutMessage;
  if (/fetch failed|network|failed to fetch|econn|enotfound|etimedout/i.test(rawMessage)) {
    return "Không thể kết nối máy chủ. Vui lòng kiểm tra mạng, VPN/Proxy hoặc DNS rồi thử lại.";
  }
  return rawMessage;
}

export function useAuth(onLoginSuccess?: (user: SessionUser) => void) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const completeLogin = useCallback(
    async (user: SessionUser, email: string, password: string, remember: boolean) => {
      if (remember) {
        upsertSavedAccount({
          email,
          password,
          id: user.id,
          displayName: String(user.displayName || user.display_name || user.username || email),
          username: String(user.username || email.split("@")[0]),
          avatarUrl: String(user.avatar_url || ""),
        });
      }
      await tauriAPI.app.postLoginSteamPrep();
      await tauriAPI.app.openMainWindow();
      onLoginSuccess?.(user);
      navigate("/app");
    },
    [navigate, onLoginSuccess]
  );

  const signIn = useCallback(
    async (email: string, password: string, remember: boolean) => {
      setError("");
      if (!email || !password) {
        setError("Vui lòng nhập đầy đủ email và mật khẩu.");
        return { success: false as const, banned: false };
      }
      if (navigator.onLine === false) {
        setError("Thiết bị đang ở chế độ offline. Vui lòng kết nối mạng rồi thử lại.");
        return { success: false as const, banned: false };
      }

      setLoading(true);
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Yêu cầu timeout sau ${Math.round(LOGIN_TIMEOUT_MS / 1000)} giây`)),
            LOGIN_TIMEOUT_MS
          )
        );
        const deviceId = ensureClientDeviceId();
        const res = (await Promise.race([
          tauriAPI.supabase.signIn({ email, password, deviceId }),
          timeoutPromise,
        ])) as SignInResult;

        if (res.success && res.user) {
          await completeLogin(res.user as SessionUser, email, password, remember);
          return { success: true as const, banned: false };
        }

        if (res.banned) {
          return { success: false as const, banned: true, message: res.message };
        }

        setError(res.message || "Đăng nhập thất bại, vui lòng thử lại.");
        return { success: false as const, banned: false };
      } catch (err) {
        setError(toFriendlyLoginErrorMessage(err, LOGIN_TIMEOUT_MS));
        return { success: false as const, banned: false };
      } finally {
        setLoading(false);
      }
    },
    [completeLogin]
  );

  return { signIn, loading, error, setError, completeLogin };
}
