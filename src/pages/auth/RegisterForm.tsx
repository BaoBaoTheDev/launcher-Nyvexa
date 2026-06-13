import { useState } from "react";
import { tauriAPI } from "../../lib/tauri-api";
import { useOtpCooldown } from "../../hooks/useOtpCooldown";
import { validatePassword } from "../../lib/passwordValidation";

interface RegisterFormProps {
  onBackLogin: () => void;
}

export function RegisterForm({ onBackLogin }: RegisterFormProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const { cooldown, startCooldown, canResend } = useOtpCooldown();

  const sendOtp = async () => {
    setError("");
    if (!email || !username || !password) {
      setError("Vui lòng điền đầy đủ thông tin.");
      return;
    }
    if (username.trim().length < 3) {
      setError("Tên tài khoản phải có ít nhất 3 ký tự.");
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      setError("Tên tài khoản chỉ được dùng chữ, số và dấu gạch dưới (_).");
      return;
    }
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      setError(pwCheck.message);
      return;
    }
    setLoading(true);
    try {
      // Kiểm tra username tồn tại chưa trước khi gửi OTP
      const usernameCheck = await tauriAPI.supabase.checkUsername({ username: username.trim() });
      if (!usernameCheck.available) {
        setError("Tên tài khoản này đã được sử dụng. Vui lòng chọn tên khác.");
        setLoading(false);
        return;
      }

      const res = (await tauriAPI.supabase.sendOTP({ email: email.trim().toLowerCase(), purpose: "register" })) as {
        success: boolean;
        message?: string;
      };
      if (res.success) {
        startCooldown();
        setStep(2);
      } else {
        const msg = res.message || "Không thể gửi mã xác thực";
        // Map raw DB error thành message thân thiện
        if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique constraint")) {
          setError("Email hoặc tên tài khoản này đã được đăng ký. Vui lòng kiểm tra lại.");
        } else {
          setError(msg);
        }
      }
    } catch {
      setError("Lỗi kết nối máy chủ.");
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (!canResend) return;
    setError("");
    setResendLoading(true);
    try {
      const res = (await tauriAPI.supabase.sendOTP({ email: email.trim().toLowerCase(), purpose: "register" })) as {
        success: boolean;
        message?: string;
      };
      if (res.success) {
        startCooldown();
        setOtp("");
      } else {
        setError("Lỗi gửi lại mã: " + (res.message || "Không thể gửi mã xác thực"));
      }
    } catch {
      setError("Lỗi kết nối máy chủ.");
    } finally {
      setResendLoading(false);
    }
  };

  const completeRegister = async () => {
    setError("");
    if (otp.trim().length !== 8) {
      setError("Mã xác thực phải có 8 ký tự.");
      return;
    }
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const verifyRes = (await tauriAPI.supabase.verifyOTP({
        email: cleanEmail,
        code: otp.trim(),
      })) as { success: boolean; message?: string };
      if (!verifyRes.success) {
        setError("Mã xác thực không chính xác hoặc đã hết hạn.");
        return;
      }
      const res = (await tauriAPI.supabase.signUp({
        email: cleanEmail,
        password,
        displayName,
        username,
      })) as { success: boolean; message?: string };
      if (res.success) {
        onBackLogin();
      } else {
        setError(res.message || "Đăng ký thất bại.");
      }
    } catch {
      setError("Lỗi hệ thống.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="auth-header">
        <h1 className="auth-title">TẠO TÀI KHOẢN</h1>
        <p className="auth-subtitle">Tham gia cộng đồng Nyvexa</p>
      </div>
      {error ? <p className="auth-error">{error}</p> : null}

      {step === 1 ? (
        <>
          <div className="input-group">
            <label>TÊN HIỂN THỊ</label>
            <input className="auth-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="input-group">
            <label>TÊN TÀI KHOẢN (USERNAME)</label>
            <input className="auth-input" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="input-group">
            <label>ĐỊA CHỈ EMAIL</label>
            <input type="email" className="auth-input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="input-group">
            <label>MẬT KHẨU</label>
            <input type="password" className="auth-input" placeholder="Tối thiểu 8 ký tự (hoa, thường, số, đặc biệt)" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="button" className="auth-btn-submit" disabled={loading} onClick={sendOtp}>
            {loading ? "Đang gửi mã..." : "Tiếp theo"}
          </button>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "#acb2b8", marginBottom: 20, textAlign: "center" }}>
            Chúng tôi đã gửi mã xác thực đến <strong>{email}</strong>
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
          <button type="button" className="auth-btn-submit" disabled={loading} onClick={completeRegister}>
            {loading ? "Đang xác thực..." : "Hoàn tất đăng ký"}
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
          <button type="button" className="auth-back-btn" onClick={() => setStep(1)}>
            Quay lại
          </button>
        </>
      )}

      <p className="auth-footer-text">
        Đã có tài khoản?{" "}
        <button type="button" className="auth-inline-link" onClick={onBackLogin}>
          Quay lại đăng nhập
        </button>
      </p>
    </div>
  );
}
