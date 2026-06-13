import { useState } from "react";
import { tauriAPI } from "../../lib/tauri-api";
import { useOtpCooldown } from "../../hooks/useOtpCooldown";
import { validatePassword } from "../../lib/passwordValidation";

interface ForgotPasswordFormProps {
  onBackLogin: () => void;
}

export function ForgotPasswordForm({ onBackLogin }: ForgotPasswordFormProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const { cooldown, startCooldown, canResend } = useOtpCooldown();

  const sendOtp = async () => {
    setError("");
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Vui lòng nhập email.");
      return;
    }
    setLoading(true);
    try {
      const res = (await tauriAPI.supabase.sendOTP({ email: cleanEmail, purpose: "forgot_password" })) as {
        success: boolean;
        message?: string;
      };
      if (res.success) {
        startCooldown();
        setStep(2);
      } else {
        setError(res.message || "Không thể gửi mã xác thực.");
      }
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (!canResend) return;
    setError("");
    setResendLoading(true);
    try {
      const res = (await tauriAPI.supabase.sendOTP({
        email: email.trim().toLowerCase(),
        purpose: "forgot_password",
      })) as { success: boolean; message?: string };
      if (res.success) {
        startCooldown();
        setOtp("");
      } else {
        setError(res.message || "Không thể gửi lại mã xác thực.");
      }
    } finally {
      setResendLoading(false);
    }
  };

  const verifyOtp = async () => {
    setError("");
    const cleanEmail = email.trim().toLowerCase();
    if (otp.trim().length !== 8) {
      setError("Mã xác thực phải có 8 ký tự.");
      return;
    }
    setLoading(true);
    try {
      const res = (await tauriAPI.supabase.verifyOTP({
        email: cleanEmail,
        code: otp.trim(),
      })) as { success: boolean; message?: string };
      if (res.success) {
        setStep(3);
      } else {
        setError(res.message || "Mã xác thực không chính xác hoặc đã hết hạn.");
      }
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    setError("");
    if (newPassword.length < 8) {
      setError("Mật khẩu phải có ít nhất 8 ký tự.");
      return;
    }
    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.valid) {
      setError(pwCheck.message);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Mật khẩu nhập lại không khớp.");
      return;
    }
    setLoading(true);
    try {
      const res = (await tauriAPI.supabase.updatePasswordAdmin({
        email: email.trim().toLowerCase(),
        password: newPassword,
      })) as { success: boolean; message?: string };
      if (res.success) {
        onBackLogin();
      } else {
        setError(res.message || "Không thể đổi mật khẩu.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="auth-header">
        <h1 className="auth-title">KHÔI PHỤC</h1>
        <p className="auth-subtitle">Đặt lại mật khẩu của bạn</p>
      </div>
      {error ? <p className="auth-error">{error}</p> : null}

      {step === 1 && (
        <>
          <p style={{ fontSize: 13, color: "#acb2b8", marginBottom: 20 }}>
            Nhập email của bạn để nhận mã xác thực đặt lại mật khẩu.
          </p>
          <div className="input-group">
            <label>ĐỊA CHỈ EMAIL</label>
            <input type="email" className="auth-input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button type="button" className="auth-btn-submit" disabled={loading} onClick={sendOtp}>
            {loading ? "Đang gửi mã..." : "Gửi mã xác thực"}
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <p style={{ fontSize: 13, color: "#acb2b8", marginBottom: 20, textAlign: "center" }}>
            Mã xác thực đã được gửi đến <strong>{email}</strong>
          </p>
          <div className="input-group">
            <label>MÃ XÁC THỰC (8 KÝ TỰ)</label>
            <input
              className="auth-input auth-input--otp"
              style={{ textAlign: "center", fontSize: 24, letterSpacing: 10 }}
              maxLength={8}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))}
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </div>
          <button type="button" className="auth-btn-submit" disabled={loading} onClick={verifyOtp}>
            {loading ? "Đang xác thực..." : "Xác thực mã"}
          </button>
          <div style={{ textAlign: "center", marginTop: 12 }}>
            {canResend ? (
              <button
                type="button"
                className="auth-inline-link"
                disabled={resendLoading}
                onClick={resendOtp}
              >
                {resendLoading ? "Đang gửi lại..." : "Gửi lại mã"}
              </button>
            ) : (
              <span style={{ fontSize: 13, color: "#6b7280" }}>
                Gửi lại sau{" "}
                <span style={{ color: "#acb2b8", fontWeight: 600 }}>{cooldown}s</span>
              </span>
            )}
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <p style={{ fontSize: 13, color: "#acb2b8", marginBottom: 20 }}>
            Mã xác thực hợp lệ. Vui lòng nhập mật khẩu mới của bạn.
          </p>
          <div className="input-group">
            <label>MẬT KHẨU MỚI</label>
            <input type="password" className="auth-input" placeholder="Tối thiểu 6 ký tự" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div className="input-group">
            <label>NHẬP LẠI MẬT KHẨU MỚI</label>
            <input type="password" className="auth-input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>
          <button type="button" className="auth-btn-submit" disabled={loading} onClick={resetPassword}>
            {loading ? "Đang cập nhật..." : "Đổi mật khẩu"}
          </button>
        </>
      )}

      <p className="auth-footer-text">
        <button type="button" className="auth-inline-link" onClick={onBackLogin}>
          Quay lại đăng nhập
        </button>
      </p>
    </div>
  );
}
