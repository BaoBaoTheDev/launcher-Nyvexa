import { useEffect, useRef, useState } from "react";
import { tauriAPI } from "../lib/tauri-api";
import { useOtpCooldown } from "../hooks/useOtpCooldown";

export interface OtpVerifyModalProps {
  email: string;
  /** purpose gửi cho /supabase_send_otp, mặc định 'change_password' */
  purpose?: string;
  title?: string;
  description?: string;
  /** Tự động gửi OTP ngay khi modal mở. Mặc định true. */
  autoSend?: boolean;
  onCancel: () => void;
  /** Khi xác thực OTP thành công, parent sẽ thực hiện hành động cuối (vd: đổi mật khẩu) */
  onVerified: () => Promise<void> | void;
}

/**
 * Modal xác thực OTP 8 ký tự gửi qua email.
 * Dùng chung style của launcher (auth-card / auth-input / auth-btn-submit).
 */
export function OtpVerifyModal({
  email,
  purpose = "change_password",
  title = "Xác thực email",
  description,
  autoSend = true,
  onCancel,
  onVerified,
}: OtpVerifyModalProps) {
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const sentOnceRef = useRef(false);
  const { cooldown, startCooldown, canResend } = useOtpCooldown();

  const cleanEmail = email.trim().toLowerCase();

  const sendCode = async () => {
    setError("");
    setInfo("");
    setSending(true);
    try {
      const res = (await tauriAPI.supabase.sendOTP({
        email: cleanEmail,
        purpose,
      })) as { success: boolean; message?: string };
      if (res.success) {
        startCooldown();
        setInfo(`Mã đã được gửi đến ${cleanEmail}`);
      } else {
        setError(res.message || "Không thể gửi mã xác thực.");
      }
    } catch (e) {
      setError((e as Error)?.message || "Lỗi gửi mã xác thực.");
    } finally {
      setSending(false);
    }
  };

  // Tự động gửi OTP một lần khi modal mở
  useEffect(() => {
    if (autoSend && !sentOnceRef.current) {
      sentOnceRef.current = true;
      void sendCode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async () => {
    setError("");
    if (otp.trim().length !== 8) {
      setError("Mã xác thực phải có 8 ký tự.");
      return;
    }
    setVerifying(true);
    try {
      const res = (await tauriAPI.supabase.verifyOTP({
        email: cleanEmail,
        code: otp.trim(),
      })) as { success: boolean; message?: string };
      if (!res.success) {
        setError(res.message || "Mã xác thực không chính xác hoặc đã hết hạn.");
        return;
      }
      await onVerified();
    } catch (e) {
      setError((e as Error)?.message || "Lỗi xác thực mã.");
    } finally {
      setVerifying(false);
    }
  };

  const onBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !verifying && !sending) onCancel();
  };

  return (
    <div
      onClick={onBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
    >
      <div
        style={{
          background: "#161b22",
          borderRadius: 12,
          padding: 28,
          minWidth: 420,
          maxWidth: 460,
          width: "92%",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <h2 style={{ margin: 0, color: "#fff", fontSize: 20, fontWeight: 700 }}>{title}</h2>
          <button
            onClick={onCancel}
            disabled={verifying || sending}
            style={{
              background: "none",
              border: "none",
              color: "#8f98a0",
              cursor: verifying || sending ? "wait" : "pointer",
              fontSize: 20,
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ color: "#8f98a0", fontSize: 13, marginBottom: 20, lineHeight: 1.5 }}>
          {description ||
            "Để bảo vệ tài khoản, vui lòng nhập mã xác thực đã được gửi đến email của bạn."}
          <br />
          <span style={{ color: "#c7d5e0" }}>{cleanEmail}</span>
        </p>

        {error && (
          <div
            style={{
              color: "#ff7a7a",
              fontSize: 13,
              marginBottom: 12,
              padding: 10,
              background: "rgba(239,68,68,0.08)",
              borderLeft: "3px solid #ef4444",
              borderRadius: 4,
            }}
          >
            {error}
          </div>
        )}

        {info && !error && (
          <div
            style={{
              color: "#10b981",
              fontSize: 13,
              marginBottom: 12,
              padding: 10,
              background: "rgba(16,185,129,0.08)",
              borderLeft: "3px solid #10b981",
              borderRadius: 4,
            }}
          >
            {info}
          </div>
        )}

        <div style={{ marginBottom: 18 }}>
          <label
            style={{
              display: "block",
              fontSize: 11,
              color: "#9eb2c1",
              fontWeight: 700,
              marginBottom: 8,
              letterSpacing: 0.5,
            }}
          >
            MÃ XÁC THỰC (8 KÝ TỰ)
          </label>
          <input
            value={otp}
            onChange={(e) =>
              setOtp(e.target.value.replace(/[^0-9a-zA-Z]/g, "").slice(0, 8).toUpperCase())
            }
            inputMode="text"
            autoComplete="one-time-code"
            maxLength={8}
            placeholder="________"
            style={{
              width: "100%",
              padding: "14px 12px",
              background: "#121b26",
              border: "1px solid rgba(59,130,246,0.35)",
              borderRadius: 20,
              color: "#fff",
              fontSize: 22,
              letterSpacing: 8,
              textAlign: "center",
              outline: "none",
              fontFamily: "Consolas, Menlo, monospace",
              fontWeight: 700,
            }}
          />
        </div>

        <button
          onClick={verify}
          disabled={verifying || otp.length !== 8}
          style={{
            width: "100%",
            padding: 13,
            background:
              verifying || otp.length !== 8
                ? "#3b4a6b"
                : "linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 20,
            color: "#fff",
            fontSize: 15,
            fontWeight: 700,
            cursor: verifying || otp.length !== 8 ? "not-allowed" : "pointer",
            transition: "filter 0.2s",
          }}
        >
          {verifying ? "Đang xác thực..." : "Xác nhận"}
        </button>

        <div style={{ textAlign: "center", marginTop: 14 }}>
          {canResend ? (
            <button
              type="button"
              onClick={sendCode}
              disabled={sending}
              style={{
                background: "none",
                border: "none",
                color: "#66c0f4",
                fontWeight: 700,
                fontSize: 13,
                cursor: sending ? "wait" : "pointer",
              }}
            >
              {sending ? "Đang gửi..." : "Gửi lại mã"}
            </button>
          ) : (
            <span style={{ fontSize: 13, color: "#6b7280" }}>
              Có thể gửi lại sau{" "}
              <span style={{ color: "#c7d5e0", fontWeight: 700 }}>{cooldown}s</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
