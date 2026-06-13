import { useCallback, useEffect, useRef, useState } from "react";
import { tauriAPI } from "../lib/tauri-api";

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  required: boolean;
}

/**
 * UpdateGate — kiểm tra phiên bản khi khởi động và định kỳ.
 * Khi manager set phiên bản mới trong dashboard, popup này hiện lên và (nếu bắt buộc)
 * chặn toàn bộ app cho tới khi user cập nhật.
 *
 * Luồng cập nhật: tải installer từ direct link manager set -> chạy file -> launcher tự thoát
 * để bản cài mới ghi đè/gỡ bản cũ.
 */
export function UpdateGate() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const dismissedRef = useRef(false);

  const check = useCallback(async () => {
    try {
      const res = await tauriAPI.app.checkUpdate();
      if (!res.success || !res.update_available) {
        setInfo(null);
        return;
      }
      // Nếu user đã tạm tắt popup (bản không bắt buộc) thì không bật lại
      if (dismissedRef.current && !res.update_required) return;

      setInfo({
        currentVersion: res.current_version ?? "",
        latestVersion: res.latest_version ?? "",
        downloadUrl: res.download_url ?? "",
        required: !!res.update_required,
      });
    } catch (e) {
      // Log để chẩn đoán (vd: command chưa có do chưa rebuild, lỗi mạng, ...)
      console.warn("[UpdateGate] checkUpdate failed:", e);
    }
  }, []);

  useEffect(() => {
    check();
    // Poll mỗi 60s để bắt thay đổi
    const id = setInterval(check, 60_000);
    // Nghe sự kiện khi manager bấm "Lưu cài đặt" -> kiểm tra ngay lập tức
    const onSaved = () => {
      dismissedRef.current = false; // reset để popup hiện lại
      check();
    };
    window.addEventListener("nyvexa:settings-saved", onSaved);
    return () => {
      clearInterval(id);
      window.removeEventListener("nyvexa:settings-saved", onSaved);
    };
  }, [check]);

  const handleUpdate = async () => {
    if (!info?.downloadUrl) {
      setError("Manager chưa cấu hình link tải. Vui lòng liên hệ quản trị viên.");
      return;
    }
    setDownloading(true);
    setError("");
    try {
      await tauriAPI.app.downloadAndInstallUpdate(info.downloadUrl);
      // Backend sẽ tự thoát app sau khi chạy installer
    } catch (e) {
      setError(typeof e === "string" ? e : "Cập nhật thất bại. Thử lại sau.");
      setDownloading(false);
    }
  };

  const handleDismiss = () => {
    dismissedRef.current = true;
    setInfo(null);
  };

  if (!info) return null;

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🚀</div>
        <div style={title}>
          {info.required ? "Bắt buộc cập nhật" : "Có phiên bản mới"}
        </div>
        <div style={subtitle}>
          {info.required
            ? "Phiên bản bạn đang dùng không còn được hỗ trợ. Vui lòng cập nhật để tiếp tục sử dụng launcher."
            : "Một phiên bản mới của Nyvexa Launcher đã sẵn sàng."}
        </div>

        <div style={versionRow}>
          <div style={versionBox}>
            <div style={versionLabel}>Đang dùng</div>
            <div style={{ ...versionValue, color: "#8f98a0" }}>v{info.currentVersion || "?"}</div>
          </div>
          <div style={{ color: "#66c0f4", fontSize: 22 }}>→</div>
          <div style={versionBox}>
            <div style={versionLabel}>Mới nhất</div>
            <div style={{ ...versionValue, color: "#a4d007" }}>v{info.latestVersion || "?"}</div>
          </div>
        </div>

        {error && <div style={errorBox}>{error}</div>}

        <button
          style={{ ...primaryBtn, opacity: downloading ? 0.7 : 1, cursor: downloading ? "default" : "pointer" }}
          onClick={handleUpdate}
          disabled={downloading}
        >
          {downloading ? "Đang tải & cài đặt..." : "Cập nhật ngay"}
        </button>

        {!info.required && !downloading && (
          <button style={secondaryBtn} onClick={handleDismiss}>
            Để sau
          </button>
        )}

        {downloading && (
          <div style={{ color: "#8f98a0", fontSize: 12, marginTop: 10 }}>
            Launcher sẽ tự đóng để hoàn tất cài đặt. Vui lòng đợi...
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(8,10,14,0.92)",
  backdropFilter: "blur(4px)",
  zIndex: 99999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const card: React.CSSProperties = {
  width: "min(420px, 90%)",
  background: "linear-gradient(160deg, #1b2838 0%, #171a21 100%)",
  border: "1px solid rgba(102,192,244,0.25)",
  borderRadius: 14,
  padding: "28px 26px",
  textAlign: "center",
  boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
};

const title: React.CSSProperties = {
  color: "#fff",
  fontSize: 21,
  fontWeight: 800,
  marginBottom: 8,
};

const subtitle: React.CSSProperties = {
  color: "#c7d5e0",
  fontSize: 13.5,
  lineHeight: 1.5,
  marginBottom: 20,
};

const versionRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 16,
  marginBottom: 22,
};

const versionBox: React.CSSProperties = {
  background: "rgba(0,0,0,0.25)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  padding: "10px 18px",
  minWidth: 90,
};

const versionLabel: React.CSSProperties = {
  color: "#8f98a0",
  fontSize: 11,
  marginBottom: 4,
};

const versionValue: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  fontFamily: "monospace",
};

const primaryBtn: React.CSSProperties = {
  width: "100%",
  background: "linear-gradient(90deg, #66c0f4, #417a9b)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "12px 0",
  fontSize: 15,
  fontWeight: 700,
  fontFamily: "inherit",
};

const secondaryBtn: React.CSSProperties = {
  width: "100%",
  background: "transparent",
  color: "#8f98a0",
  border: "none",
  borderRadius: 8,
  padding: "10px 0 2px",
  fontSize: 13,
  fontFamily: "inherit",
  cursor: "pointer",
};

const errorBox: React.CSSProperties = {
  background: "rgba(220,53,69,0.12)",
  border: "1px solid rgba(220,53,69,0.4)",
  color: "#ff8a8a",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 12.5,
  marginBottom: 14,
};
