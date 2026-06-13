import { FormEvent, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import type { SessionUser } from "../../hooks/useSessionBootstrap";

interface LoginFormProps {
  hasSavedAccounts: boolean;
  onBanned: (message: string) => void;
  onLoginSuccess: (user: SessionUser) => void;
  onForgot: () => void;
  onRegister: () => void;
  onBackPicker: () => void;
}

export function LoginForm({
  hasSavedAccounts,
  onBanned,
  onLoginSuccess,
  onForgot,
  onRegister,
  onBackPicker,
}: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const { signIn, loading, error, setError } = useAuth(onLoginSuccess);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError("");
    const result = await signIn(email.trim().toLowerCase(), password, remember);
    if (result.banned) {
      onBanned(result.message || "Tài khoản đã bị khóa. Vui lòng liên hệ admin.");
    }
  };

  return (
    <form className="auth-card" onSubmit={handleSubmit}>
      <div className="auth-header">
        <h1 className="auth-title">ĐĂNG NHẬP</h1>
        <p className="auth-subtitle">Chào mừng bạn quay lại</p>
      </div>
      {error ? <p className="auth-error">{error}</p> : null}
      <div className="input-group">
        <label>ĐỊA CHỈ EMAIL</label>
        <input
          type="email"
          className="auth-input"
          placeholder="example@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>
      <div className="input-group">
        <label>MẬT KHẨU</label>
        <input
          type="password"
          className="auth-input"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      <div className="auth-options" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label className="checkbox-container">
          Ghi nhớ
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span className="checkmark" />
        </label>
        <button type="button" className="auth-link-btn" onClick={onForgot}>
          Quên mật khẩu?
        </button>
      </div>
      <button type="submit" className="auth-btn-submit" disabled={loading}>
        {loading ? "Đang đăng nhập..." : "Đăng nhập"}
      </button>
      {hasSavedAccounts ? (
        <button type="button" className="auth-btn-submit account-picker-alt-btn" style={{ marginTop: 10 }} onClick={onBackPicker}>
          Chọn tài khoản
        </button>
      ) : null}
      <p className="auth-footer-text">
        Chưa có tài khoản?{" "}
        <button type="button" className="auth-inline-link" onClick={onRegister}>
          Đăng ký miễn phí
        </button>
      </p>
    </form>
  );
}
