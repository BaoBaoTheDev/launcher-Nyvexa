import { useEffect, useState, useCallback } from "react";
import { tauriAPI } from "../lib/tauri-api";

interface SteamAccountInfo {
  steam_id: number;
  persona_name: string | null;
  avatar_url: string | null;
  is_logged_in: boolean;
}

interface LinkedAccount {
  id: string;
  registry_id: string;
  steam_id?: string;
  persona_name: string | null;
  avatar_url: string | null;
  linked_at: string;
}

interface SteamLinkModalProps {
  onClose: () => void;
  onLinked: () => void;
}

type ModalStep = "idle" | "confirm_account" | "confirm_warning" | "linking" | "success" | "error";

export function SteamLinkModal({ onClose, onLinked }: SteamLinkModalProps) {
  const [step, setStep] = useState<ModalStep>("idle");
  const [loading, setLoading] = useState(true);
  const [checkingSteam, setCheckingSteam] = useState(false);
  const [activeUserInfo, setActiveUserInfo] = useState<{
    active: boolean;
    active_user: number | null;
    steam_id: number | null;
  } | null>(null);
  const [steamProfile, setSteamProfile] = useState<SteamAccountInfo | null>(null);
  const [linkedAccount, setLinkedAccount] = useState<LinkedAccount | null>(null);
  const [error, setError] = useState("");
  const [guardianRunning, setGuardianRunning] = useState(false);

  // Check current Steam user and linked account
  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    setSteamProfile(null);
    setActiveUserInfo(null);
    try {
      // Check active Steam user
      const userInfo = await tauriAPI.steamLink.getActiveUser();
      setActiveUserInfo(userInfo);

      // Check if already linked
      const linked = await tauriAPI.steamLink.getLinkedAccount();
      if (linked.linked && linked.link) {
        setLinkedAccount(linked.link);
        setStep("idle");
      } else {
        setLinkedAccount(null);
        
        // If user is logged into Steam, fetch profile directly from Steam API
        // The API will give us the correct SteamID
        if (userInfo.active && userInfo.active_user) {
          await fetchAndShowProfile(userInfo.active_user);
        } else {
          setStep("idle");
        }
      }
    } catch (e) {
      setError((e as Error)?.message || "Không kiểm tra được trạng thái Steam");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAndShowProfile = async (activeUser: number) => {
    setCheckingSteam(true);
    setSteamProfile(null);
    try {
      // Fetch profile from Steam API - this returns the correct SteamID
      const profile = await tauriAPI.steamLink.fetchProfile(activeUser);
      setSteamProfile(profile);
      setStep("confirm_account");
    } catch (e) {
      setError((e as Error)?.message || "Không lấy được thông tin tài khoản Steam");
      setStep("error");
    } finally {
      setCheckingSteam(false);
    }
  };

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  // Retry fetching Steam status - fetch fresh data
  const handleRetrySteam = async () => {
    setCheckingSteam(true);
    setSteamProfile(null);
    setActiveUserInfo(null);
    try {
      const userInfo = await tauriAPI.steamLink.getActiveUser();
      setActiveUserInfo(userInfo);
      if (userInfo.active && userInfo.active_user) {
        await fetchAndShowProfile(userInfo.active_user);
      } else {
        setStep("idle");
      }
    } catch (e) {
      setError((e as Error)?.message || "Không kiểm tra được Steam");
      setStep("error");
    } finally {
      setCheckingSteam(false);
    }
  };

  // Confirm account → proceed to warning
  const handleConfirmAccount = () => {
    setStep("confirm_warning");
  };

  // Confirm warning → link account
  const handleConfirmWarning = async () => {
    if (!steamProfile || !activeUserInfo?.active_user) return;
    
    setStep("linking");
    try {
      const result = await tauriAPI.steamLink.linkAccount({
        registryId: String(activeUserInfo.active_user),
        personaName: steamProfile.persona_name || undefined,
        avatarUrl: steamProfile.avatar_url || undefined,
      });

      if (result.success) {
        // Start the guardian process
        try {
          await tauriAPI.steamLink.guardianStart();
          setGuardianRunning(true);
        } catch {
          // Guardian might already be running or failed, that's okay
        }
        
        setStep("success");
        setTimeout(() => {
          onLinked();
          onClose();
        }, 1500);
      } else {
        setError(result.message || "Không thể liên kết tài khoản");
        setStep("error");
      }
    } catch (e) {
      console.error("Link account error:", e);
      setError((e as Error)?.message || "Lỗi khi liên kết tài khoản");
      setStep("error");
    }
  };

  // Cancel linking - reset to re-fetch on next open
  const handleCancel = () => {
    if (step === "confirm_warning") {
      // Go back to account confirmation - will re-fetch profile
      setSteamProfile(null);
      setActiveUserInfo(null);
      setStep("idle");
    } else {
      onClose();
    }
  };

  // Format date
  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && handleCancel()}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 10001,
      }}
    >
      <div style={{
        background: "#161b22",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
        width: "100%",
        maxWidth: 480,
        padding: "28px 28px 24px",
        maxHeight: "90vh",
        overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h2 style={{ margin: 0, color: "#fff", fontSize: 20, fontWeight: 700 }}>Liên Kết Tài Khoản Steam</h2>
          <button onClick={handleCancel} style={{ background: "none", border: "none", color: "#8f98a0", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>✕</button>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#8f98a0" }}>
            <div style={{ fontSize: 24, marginBottom: 12 }}>⏳</div>
            <div>Đang kiểm tra trạng thái...</div>
          </div>
        )}

        {/* Already linked */}
        {!loading && linkedAccount && (
          <>
            <div style={{
              background: "rgba(16,185,129,0.08)",
              border: "1px solid rgba(16,185,129,0.3)",
              borderRadius: 12,
              padding: 20,
              marginBottom: 20,
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: "50%",
                background: `url(${linkedAccount.avatar_url || "https://images.steamusercontent.com/ugc/868480752636433334/1D2881C5C9B3AD28A1D8852903A8F9E1FF45C2C8/"})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24, color: "#fff", fontWeight: 700,
                flexShrink: 0,
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
                  {linkedAccount.persona_name || "Tài khoản Steam"}
                </div>
                <div style={{ fontSize: 12, color: "#8f98a0", marginBottom: 6 }}>
                  SteamID: {linkedAccount.steam_id}
                </div>
                <div style={{ fontSize: 11, color: "#66c0f4" }}>
                  Đã liên kết: {formatDate(linkedAccount.linked_at)}
                </div>
              </div>
              <div style={{
                background: "rgba(16,185,129,0.2)",
                border: "1px solid rgba(16,185,129,0.4)",
                borderRadius: 8,
                padding: "6px 12px",
                color: "#34d399",
                fontSize: 12,
                fontWeight: 700,
              }}>
                ✓ Đã liên kết
              </div>
            </div>

            <div style={{ fontSize: 13, color: "#8f98a0", marginBottom: 20, lineHeight: 1.6 }}>
              Tài khoản Steam của bạn đã được liên kết. Mỗi khi bạn bấm <strong style={{ color: "#fff" }}>Chơi Ngay</strong>,
              hệ thống sẽ tự động kiểm tra tài khoản Steam hiện tại để đảm bảo bạn đang sử dụng đúng tài khoản.
            </div>

            <div style={{
              background: "rgba(251,191,36,0.08)",
              border: "1px solid rgba(251,191,36,0.2)",
              borderRadius: 10,
              padding: "14px 16px",
              marginBottom: 20,
              fontSize: 13,
              color: "#fbbf24",
              lineHeight: 1.6,
            }}>
              <strong style={{ display: "block", marginBottom: 4 }}>⚠️ Lưu ý quan trọng</strong>
              Nếu bạn cần thay đổi tài khoản Steam, vui lòng liên hệ admin để được hỗ trợ. Việc đổi tài khoản Steam cần có lý do hợp lý và phải được xác minh.
            </div>

            <button
              onClick={onClose}
              style={{
                width: "100%",
                padding: "12px 20px",
                background: "#2a2f38",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 10,
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Đóng
            </button>
          </>
        )}

        {/* Idle - Not linked, checking Steam */}
        {!loading && !linkedAccount && step === "idle" && (
          <>
            <div style={{
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
              padding: 24,
              textAlign: "center",
              marginBottom: 20,
            }}>
              {checkingSteam ? (
                <div>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>🔄</div>
                  <div style={{ color: "#fff", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                    Đang kết nối Steam...
                  </div>
                  <div style={{ color: "#8f98a0", fontSize: 13 }}>
                    Vui lòng đảm bảo Steam đang mở và bạn đã đăng nhập
                  </div>
                </div>
              ) : !activeUserInfo?.active ? (
                <div>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>🎮</div>
                  <div style={{ color: "#fff", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                    Chưa phát hiện tài khoản Steam
                  </div>
                  <div style={{ color: "#8f98a0", fontSize: 13, marginBottom: 16 }}>
                    Vui lòng đăng nhập Steam trước khi liên kết
                  </div>
                  <button
                    onClick={handleRetrySteam}
                    style={{
                      padding: "10px 24px",
                      background: "#66c0f4",
                      border: "none",
                      borderRadius: 8,
                      color: "#fff",
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Kiểm tra lại
                  </button>
                </div>
              ) : null}
            </div>

            <button
              onClick={onClose}
              style={{
                width: "100%",
                padding: "12px 20px",
                background: "#2a2f38",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 10,
                color: "#8f98a0",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Đóng
            </button>
          </>
        )}

        {/* Step 1: Confirm Account */}
        {!loading && !linkedAccount && step === "confirm_account" && steamProfile && (
          <>
            <div style={{
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
              padding: 24,
              textAlign: "center",
              marginBottom: 20,
            }}>
              <div style={{ fontSize: 13, color: "#8f98a0", marginBottom: 16 }}>
                Tài khoản Steam đang đăng nhập:
              </div>
              
              <div style={{
                width: 80, height: 80, borderRadius: "50%",
                background: `url(${steamProfile.avatar_url || "https://images.steamusercontent.com/ugc/868480752636433334/1D2881C5C9B3AD28A1D8852903A8F9E1FF45C2C8/"})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                margin: "0 auto 16px",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 32, color: "#fff", fontWeight: 700,
                border: "3px solid rgba(102,192,244,0.3)",
              }} />

              <div style={{ color: "#fff", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                {steamProfile.persona_name || "Tài khoản Steam"}
              </div>
              
              <div style={{ color: "#8f98a0", fontSize: 12, fontFamily: "monospace" }}>
                SteamID: {steamProfile.steam_id}
              </div>
            </div>

            <div style={{ fontSize: 13, color: "#c7d5e0", marginBottom: 20, lineHeight: 1.6 }}>
              Bạn có chắc chắn muốn liên kết tài khoản Steam này với tài khoản Nyvexa Launcher không?
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: "12px 20px",
                  background: "#2a2f38",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10,
                  color: "#8f98a0",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmAccount}
                style={{
                  flex: 1,
                  padding: "12px 20px",
                  background: "#66c0f4",
                  border: "none",
                  borderRadius: 10,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Xác nhận
              </button>
            </div>
          </>
        )}

        {/* Step 2: Warning */}
        {!loading && !linkedAccount && step === "confirm_warning" && steamProfile && (
          <>
            <div style={{
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 12,
              padding: 24,
              marginBottom: 20,
            }}>
              <div style={{ fontSize: 48, textAlign: "center", marginBottom: 16 }}>⚠️</div>
              
              <div style={{ color: "#fff", fontSize: 16, fontWeight: 700, marginBottom: 12, textAlign: "center" }}>
                Cảnh báo quan trọng
              </div>

              <div style={{ fontSize: 13, color: "#c7d5e0", lineHeight: 1.7, marginBottom: 16 }}>
                Sau khi liên kết, <strong style={{ color: "#fff" }}>bạn sẽ không thể thay đổi tài khoản Steam </strong>
                nếu không có lý do hợp lý và phải được admin xác minh.
              </div>

              <div style={{ fontSize: 13, color: "#c7d5e0", lineHeight: 1.7 }}>
                Hệ thống sẽ kiểm tra tài khoản Steam mỗi khi bạn bấm <strong style={{ color: "#66c0f4" }}>Chơi Ngay</strong>.
                Nếu phát hiện tài khoản không khớp, launcher sẽ yêu cầu bạn đăng nhập đúng tài khoản đã liên kết.
              </div>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={handleCancel}
                style={{
                  flex: 1,
                  padding: "12px 20px",
                  background: "#2a2f38",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10,
                  color: "#8f98a0",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Quay lại
              </button>
              <button
                onClick={handleConfirmWarning}
                style={{
                  flex: 1,
                  padding: "12px 20px",
                  background: "#ef4444",
                  border: "none",
                  borderRadius: 10,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Tôi hiểu, liên kết
              </button>
            </div>
          </>
        )}

        {/* Linking in progress */}
        {!loading && !linkedAccount && step === "linking" && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
            <div style={{ color: "#fff", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              Đang liên kết tài khoản...
            </div>
            <div style={{ color: "#8f98a0", fontSize: 13 }}>
              Vui lòng đợi trong giây lát
            </div>
          </div>
        )}

        {/* Success */}
        {!loading && !linkedAccount && step === "success" && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
            <div style={{ color: "#34d399", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Liên kết thành công!
            </div>
            <div style={{ color: "#8f98a0", fontSize: 13 }}>
              {guardianRunning ? "Helper Process đang chạy để theo dõi tài khoản Steam..." : "Tài khoản Steam đã được liên kết với Nyvexa Launcher."}
            </div>
          </div>
        )}

        {/* Error */}
        {!loading && !linkedAccount && step === "error" && (
          <>
            <div style={{
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 12,
              padding: 24,
              marginBottom: 20,
            }}>
              <div style={{ fontSize: 36, textAlign: "center", marginBottom: 12 }}>❌</div>
              <div style={{ color: "#f87171", fontSize: 14, textAlign: "center" }}>
                {error || "Đã xảy ra lỗi không xác định"}
              </div>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: "12px 20px",
                  background: "#2a2f38",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10,
                  color: "#8f98a0",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Đóng
              </button>
              <button
                onClick={() => { setError(""); setStep("idle"); void loadStatus(); }}
                style={{
                  flex: 1,
                  padding: "12px 20px",
                  background: "#66c0f4",
                  border: "none",
                  borderRadius: 10,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Thử lại
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
