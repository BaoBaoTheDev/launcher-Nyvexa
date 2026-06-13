import { tauriAPI } from "../../lib/tauri-api";

interface BannedFormProps {
  message: string;
  onBackLogin: () => void;
}

export function BannedForm({ message, onBackLogin }: BannedFormProps) {
  return (
    <div className="auth-card">
      <div className="auth-header">
        <h1 className="auth-title" style={{ color: "#ff4d4d" }}>
          TÀI KHOẢN BỊ KHÓA
        </h1>
        <p className="auth-subtitle">Bạn không thể tiếp tục sử dụng launcher với tài khoản này.</p>
      </div>
      <p className="auth-error" style={{ display: "block" }}>
        {message || "Tài khoản đã bị khóa. Vui lòng liên hệ admin."}
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" className="auth-btn-submit" style={{ background: "#3d4450" }} onClick={onBackLogin}>
          Quay lại đăng nhập
        </button>
        <button
          type="button"
          className="auth-btn-submit"
          style={{ background: "#ff4d4d", color: "#000" }}
          onClick={() => tauriAPI.app.confirmClose(true)}
        >
          Thoát
        </button>
      </div>
    </div>
  );
}
