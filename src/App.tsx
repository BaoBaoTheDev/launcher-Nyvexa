import { Navigate, Route, Routes } from "react-router-dom";
import { AuthPage } from "./pages/auth/AuthPage";
import { AppShellPage } from "./pages/app/AppShellPage";
import { useSessionBootstrap } from "./hooks/useSessionBootstrap";
import { BanOverlay } from "./components/BanOverlay";
import { tauriAPI } from "./lib/tauri-api";

export default function App() {
  const { session, loading, refreshSession } = useSessionBootstrap();

  if (loading) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card" style={{ textAlign: "center" }}>
          <p className="auth-subtitle">Đang khởi động Nyvexa Launcher...</p>
        </div>
      </div>
    );
  }

  // Kiểm tra ban: is_banned=true VÀ (ban_until null = vĩnh viễn HOẶC ban_until còn hạn)
  const isBanned = (() => {
    if (!session?.is_banned) return false;
    const until = session.ban_until;
    if (!until) return true; // vĩnh viễn
    try {
      return new Date(until).getTime() > Date.now();
    } catch {
      return true;
    }
  })();

  if (session && isBanned) {
    return <BanOverlay user={session} onLogout={() => tauriAPI.supabase.signOut()} />;
  }

  return (
    <Routes>
      <Route
        path="/login/*"
        element={session ? <Navigate to="/app" replace /> : <AuthPage />}
      />
      <Route
        path="/app/*"
        element={
          session ? (
            <AppShellPage user={session} onRefreshSession={refreshSession} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to={session ? "/app" : "/login"} replace />} />
    </Routes>
  );
}
