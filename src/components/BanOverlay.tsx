import { tauriAPI } from "../lib/tauri-api";
import type { SessionUser } from "../hooks/useSessionBootstrap";

const DISCORD_INVITE = "https://discord.gg/a7SKKxdydg";

interface BanOverlayProps {
  user: SessionUser;
  onLogout: () => void;
}

export function BanOverlay({ user, onLogout }: BanOverlayProps) {
  const reason = (user.ban_reason as string) || "Không có lý do cụ thể.";
  const banUntil = user.ban_until as string | null | undefined;

  let durationText = "Vĩnh viễn";
  if (banUntil) {
    try {
      const until = new Date(banUntil);
      durationText = `Đến ${until.toLocaleString("vi-VN")}`;
    } catch { /* keep default */ }
  }

  const handleAppeal = () => {
    tauriAPI.app.openExternal(DISCORD_INVITE).catch(() => {});
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100000,
      background: "rgba(0,0,0,0.55)", backdropFilter: "blur(10px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{
        background: "#161b22", borderRadius: 14, padding: 32, maxWidth: 460, width: "100%",
        border: "1px solid rgba(248,113,113,0.3)", boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>🚫</div>
        <h2 style={{ margin: "0 0 8px 0", color: "#f87171", fontSize: 22, fontWeight: 700 }}>
          Tài khoản đã bị khóa
        </h2>
        <p style={{ color: "#8f98a0", fontSize: 13, margin: "0 0 20px 0" }}>
          Bạn không thể sử dụng launcher cho đến khi lệnh khóa được gỡ bỏ.
        </p>

        <div style={{ textAlign: "left", background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#8f98a0", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Lý do</div>
            <div style={{ color: "#fff", fontSize: 14, lineHeight: 1.5 }}>{reason}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#8f98a0", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Thời hạn</div>
            <div style={{ color: banUntil ? "#fbbf24" : "#f87171", fontSize: 14, fontWeight: 600 }}>{durationText}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={handleAppeal}
            style={{
              flex: 1, padding: "11px", background: "rgba(88,101,242,0.85)",
              border: "none", borderRadius: 8, color: "#fff", cursor: "pointer",
              fontSize: 14, fontWeight: 700,
            }}
          >
            Kháng cáo
          </button>
          <button
            type="button"
            onClick={onLogout}
            style={{
              flex: 1, padding: "11px", background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#fff", cursor: "pointer",
              fontSize: 14, fontWeight: 700,
            }}
          >
            Đăng xuất
          </button>
        </div>
      </div>
    </div>
  );
}
