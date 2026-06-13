import { useEffect, useState } from "react";
import { tauriAPI } from "../../lib/tauri-api";
import type { SessionUser } from "../../hooks/useSessionBootstrap";
import { steamAppAssetUrl, DEFAULT_STEAM_BACKGROUND_URL } from "../../lib/runtimeUrls";
import { formatMoney } from "../../lib/utils";
import { getPasswordRules, isPasswordStrong } from "../../lib/passwordValidation";
import { OtpVerifyModal } from "../../components/OtpVerifyModal";
import "../../styles/profile.css";

// Dynamic avatar type from DB
interface DbAvatarPreset {
  id: string;
  name: string;
  image_url: string;
  sort_order?: number;
}

interface ProfilePageProps {
  user: SessionUser;
  onNavigateStore?: () => void;
  onProfileUpdate?: () => Promise<unknown> | void; // gọi để refresh session sau khi update profile
}

interface OwnedGame {
  id?: string;
  appid?: string | number;
  name?: string;
  custom_image?: string;
  header_image?: string;
}

// ─── Edit Profile Modal ────────────────────────────────────────────────────

interface EditProfileModalProps {
  user: SessionUser;
  onClose: () => void;
  onSaved: () => Promise<unknown> | void;
  /** Yêu cầu thoát modal tạm thời để hiện OTP, kèm dữ liệu đã chuẩn bị sẵn */
  onRequestOtp: (payload: { newPassword: string }) => void;
  /** Form state được persist từ ProfilePage để giữ giá trị khi mở/tắt modal qua OTP */
  initialDraft?: EditProfileDraft | null;
  /** Báo về parent mỗi khi draft thay đổi để parent lưu lại */
  onDraftChange?: (draft: EditProfileDraft) => void;
  /** Khi đổi mật khẩu thành công sau OTP, parent set flag này để modal hiện banner thành công */
  successMessage?: string | null;
  onClearSuccess?: () => void;
}

export interface EditProfileDraft {
  displayName: string;
  selectedAvatar: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

function EditProfileModal({
  user,
  onClose,
  onSaved,
  onRequestOtp,
  initialDraft,
  onDraftChange,
  successMessage,
  onClearSuccess,
}: EditProfileModalProps) {
  const [displayName, setDisplayName] = useState(
    initialDraft?.displayName ?? String(user.display_name || user.displayName || "")
  );
  const [currentPassword, setCurrentPassword] = useState(initialDraft?.currentPassword ?? "");
  const [newPassword, setNewPassword] = useState(initialDraft?.newPassword ?? "");
  const [confirmPassword, setConfirmPassword] = useState(initialDraft?.confirmPassword ?? "");
  const [selectedAvatar, setSelectedAvatar] = useState<string>(
    initialDraft?.selectedAvatar ?? String(user.avatar_url || "")
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(successMessage || "");
  const [avatarPresets, setAvatarPresets] = useState<DbAvatarPreset[]>([]);
  const [loadingAvatars, setLoadingAvatars] = useState(true);

  // Đồng bộ success từ parent (sau khi đổi mật khẩu xong qua OTP)
  useEffect(() => {
    if (successMessage) {
      setSuccess(successMessage);
      // Sau khi hiển thị, clear ra parent để không re-trigger
      const t = setTimeout(() => {
        onClearSuccess?.();
      }, 100);
      return () => clearTimeout(t);
    }
  }, [successMessage, onClearSuccess]);

  // Push draft lên parent mỗi khi giá trị form thay đổi
  useEffect(() => {
    onDraftChange?.({
      displayName,
      selectedAvatar,
      currentPassword,
      newPassword,
      confirmPassword,
    });
  }, [displayName, selectedAvatar, currentPassword, newPassword, confirmPassword, onDraftChange]);

  // Load avatar presets from DB
  useEffect(() => {
    tauriAPI.avatar
      .listPresets()
      .then((res) => {
        if (res.success && res.data) setAvatarPresets(res.data);
      })
      .catch(() => {})
      .finally(() => setLoadingAvatars(false));
  }, []);

  const passwordRules = getPasswordRules(newPassword);
  const wantsPasswordChange = Boolean(newPassword || confirmPassword || currentPassword);

  const handleSave = async () => {
    setError("");
    setSuccess("");

    // Validate password change inputs nếu user nhập
    if (wantsPasswordChange) {
      if (!currentPassword) {
        setError("Vui lòng nhập mật khẩu hiện tại để đổi mật khẩu.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("Mật khẩu xác nhận không khớp.");
        return;
      }
      if (!isPasswordStrong(newPassword)) {
        setError("Mật khẩu mới chưa đáp ứng tất cả yêu cầu bên dưới.");
        return;
      }
    }

    setSaving(true);
    try {
      // 1. Cập nhật thông tin profile (tên hiển thị, avatar) trước
      const updates: Record<string, unknown> = {};
      const trimmedName = displayName.trim();
      if (trimmedName && trimmedName !== (user.display_name || user.displayName || "")) {
        if (trimmedName.length > 15) {
          setError("Tên hiển thị tối đa 15 ký tự");
          setSaving(false);
          return;
        }
        const lastChanged = user.display_name_changed_at as string | undefined;
        if (lastChanged) {
          const diff = Date.now() - new Date(lastChanged).getTime();
          const daysLeft = Math.ceil(7 - diff / (1000 * 60 * 60 * 24));
          if (daysLeft > 0) {
            setError(`Bạn chỉ được đổi tên mỗi 7 ngày. Còn ${daysLeft} ngày nữa.`);
            setSaving(false);
            return;
          }
        }
        updates.display_name = trimmedName;
        updates.display_name_changed_at = new Date().toISOString();
      }

      if (selectedAvatar) {
        updates.avatar_url = selectedAvatar;
      }

      if (Object.keys(updates).length > 0) {
        const profileRes = (await tauriAPI.supabase.updateProfile(updates)) as {
          success?: boolean;
          message?: string;
        };
        if (!profileRes?.success) {
          throw new Error(profileRes?.message || "Cập nhật hồ sơ thất bại");
        }
      }

      // 2. Nếu đổi mật khẩu: verify current password rồi mở OTP
      if (wantsPasswordChange) {
        if (!user.email) {
          throw new Error("Tài khoản không có email, không thể đổi mật khẩu.");
        }
        const verifyRes = await tauriAPI.supabase.verifyPassword({
          email: String(user.email),
          password: currentPassword,
        });
        if (!verifyRes?.success) {
          setError(verifyRes?.message || "Mật khẩu hiện tại không đúng.");
          setSaving(false);
          return;
        }

        // Refresh thông tin profile (display_name / avatar) trước khi tạm tắt modal
        await onSaved();

        // Yêu cầu parent mở OTP modal — modal này sẽ tự đóng
        onRequestOtp({ newPassword });
        return;
      }

      // Không đổi mật khẩu: chỉ refresh + đóng modal
      setSuccess("Cập nhật thành công!");
      await onSaved();
      setTimeout(() => onClose(), 600);
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error)?.message || "Lỗi không xác định");
    } finally {
      setSaving(false);
    }
  };

  // Preview: selectedAvatar giờ là URL trực tiếp
  const currentAvatarUrl = selectedAvatar || (typeof user.avatar_url === "string" ? user.avatar_url : "");

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "#161b22",
          borderRadius: 8,
          padding: 24,
          minWidth: 480,
          maxWidth: 560,
          width: "90%",
          maxHeight: "90vh",
          overflowY: "auto",
          border: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, color: "#fff", fontSize: 20 }}>Chỉnh sửa hồ sơ</h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#8f98a0", cursor: "pointer", fontSize: 20 }}
          >
            ✕
          </button>
        </div>

        {/* Avatar — chọn từ preset cố định */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 10, color: "#c7d5e0", fontSize: 13, fontWeight: 600, textAlign: "center" }}>
            Avatar hiện tại
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <div
              style={{
                width: 100, height: 100, borderRadius: "50%", overflow: "hidden",
                background: "linear-gradient(135deg, #1e3a5f, #2563eb)",
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "3px solid rgba(102,192,244,0.4)",
                boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
              }}
            >
              {currentAvatarUrl ? (
                <img
                  src={currentAvatarUrl}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span style={{ color: "#fff", fontSize: 40 }}>?</span>
              )}
            </div>
          </div>
          <div style={{ marginBottom: 8, color: "#8f98a0", fontSize: 12, textAlign: "center" }}>
            Chọn 1 trong các avatar bên dưới
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
              gap: 8,
              padding: 10,
              background: "rgba(0,0,0,0.25)",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.08)",
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {loadingAvatars ? (
              <div style={{ color: "#8f98a0", fontSize: 12, gridColumn: "1/-1", textAlign: "center", padding: 12 }}>Đang tải avatar...</div>
            ) : avatarPresets.length === 0 ? (
              <div style={{ color: "#8f98a0", fontSize: 12, gridColumn: "1/-1", textAlign: "center", padding: 12 }}>Admin chưa thêm avatar nào</div>
            ) : avatarPresets.map((preset) => {
              const isSelected = preset.image_url === selectedAvatar;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedAvatar(preset.image_url)}
                  title={preset.name}
                  style={{
                    aspectRatio: "1 / 1",
                    background: "transparent",
                    border: isSelected ? "2px solid #66c0f4" : "2px solid transparent",
                    borderRadius: "50%",
                    cursor: "pointer",
                    padding: 2,
                    overflow: "hidden",
                    boxShadow: isSelected ? "0 0 0 3px rgba(102,192,244,0.25)" : undefined,
                    transition: "transform 0.15s, border-color 0.15s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.06)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
                >
                  <img
                    src={preset.image_url}
                    alt={preset.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%", display: "block" }}
                    onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* Display name */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "#c7d5e0", fontSize: 13, marginBottom: 6 }}>
            <span>Tên hiển thị</span>
            <span style={{ fontSize: 11, color: "#8f98a0", fontWeight: 400 }}>{displayName.length}/15 ký tự</span>
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value.slice(0, 15))}
            placeholder="Nhập tên hiển thị..."
            maxLength={15}
            style={{
              width: "100%", padding: "10px 12px",
              background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4, color: "#fff", fontSize: 14, outline: "none",
            }}
          />
          <div style={{ fontSize: 11, color: "#8f98a0", marginTop: 4 }}>
            Bạn chỉ có thể đổi tên hiển thị 7 ngày 1 lần
          </div>
        </div>

        {/* Password */}
        <div style={{
          padding: 16, background: "rgba(0,0,0,0.2)", borderRadius: 6, marginBottom: 16,
          border: "1px solid rgba(255,255,255,0.05)",
        }}>
          <div style={{ color: "#c7d5e0", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            Đổi mật khẩu (để trống nếu không đổi)
          </div>
          <div style={{ marginBottom: 10 }}>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Mật khẩu hiện tại"
              autoComplete="current-password"
              style={{
                width: "100%", padding: "10px 12px",
                background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4, color: "#fff", fontSize: 14, outline: "none",
              }}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mật khẩu mới"
              autoComplete="new-password"
              style={{
                width: "100%", padding: "10px 12px",
                background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4, color: "#fff", fontSize: 14, outline: "none",
              }}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Xác nhận mật khẩu mới"
              autoComplete="new-password"
              style={{
                width: "100%", padding: "10px 12px",
                background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4, color: "#fff", fontSize: 14, outline: "none",
              }}
            />
          </div>

          {/* Bảng yêu cầu mật khẩu — đỏ khi chưa đáp ứng, xanh khi đáp ứng */}
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              background: "rgba(0,0,0,0.25)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 6,
            }}
          >
            <div style={{ fontSize: 11, color: "#8f98a0", fontWeight: 700, letterSpacing: 0.5, marginBottom: 8 }}>
              YÊU CẦU MẬT KHẨU
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
              {passwordRules.map((r) => {
                const color = r.passed ? "#10b981" : "#ef4444";
                return (
                  <li
                    key={r.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12.5,
                      color,
                      fontWeight: 600,
                      transition: "color 0.2s",
                    }}
                  >
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: r.passed ? "rgba(16,185,129,0.18)" : "rgba(239,68,68,0.18)",
                        border: `1px solid ${color}`,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {r.passed ? "✓" : "✕"}
                    </span>
                    <span>{r.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {wantsPasswordChange && (
            <div style={{ marginTop: 10, fontSize: 11.5, color: "#8f98a0", lineHeight: 1.5 }}>
              💡 Sau khi xác nhận, hệ thống sẽ gửi mã OTP 8 ký tự về email của bạn để xác thực
              trước khi đổi mật khẩu.
            </div>
          )}
        </div>

        {/* Error / Success */}
        {error && (
          <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12, padding: 10, background: "rgba(239,68,68,0.1)", borderRadius: 4 }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ color: "#10b981", fontSize: 13, marginBottom: 12, padding: 10, background: "rgba(16,185,129,0.1)", borderRadius: 4 }}>
            {success}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: "10px 20px", background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4,
              color: "#fff", cursor: "pointer", fontSize: 14,
            }}
          >
            Hủy
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "10px 20px", background: saving ? "#3b4a6b" : "#2563eb",
              border: "none", borderRadius: 4,
              color: "#fff", cursor: saving ? "wait" : "pointer", fontSize: 14, fontWeight: 600,
            }}
          >
            {saving ? "Đang lưu..." : "💾 Lưu thay đổi"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ProfilePage ──────────────────────────────────────────────────────

export function ProfilePage({ user, onNavigateStore, onProfileUpdate }: ProfilePageProps) {
  const [ownedGames, setOwnedGames] = useState<OwnedGame[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [balance, setBalance] = useState<number>(Number(user.balance ?? 0));
  const [showEdit, setShowEdit] = useState(false);
  // Draft của form Edit (giữ giá trị khi tạm tắt modal để mở OTP)
  const [editDraft, setEditDraft] = useState<EditProfileDraft | null>(null);
  // Pending password change đang chờ xác thực OTP
  const [pendingPassword, setPendingPassword] = useState<string | null>(null);
  // Thông báo thành công sau khi OTP -> đổi mật khẩu xong (truyền vào EditModal)
  const [editSuccess, setEditSuccess] = useState<string | null>(null);

  const displayName =
    (user.display_name as string) ||
    user.displayName ||
    (user.username as string) ||
    user.email ||
    "Người dùng";

  // Avatar: dùng URL trực tiếp từ DB
  const avatarUrl = (user.avatar_url as string) || "";
  const summary = (user.summary as string) || "Chào mừng đến với hồ sơ của tôi.";
  const role = String(user.role || "user");

  useEffect(() => {
    setBalance(Number(user.balance ?? 0));
  }, [user.balance]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const games = await tauriAPI.userGames.listOwned();
        if (!cancelled) setOwnedGames((games ?? []) as OwnedGame[]);
      } catch (_) {
        if (!cancelled) setOwnedGames([]);
      } finally {
        if (!cancelled) setLoadingGames(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="profile-container">
      <div className="profile-page-bg-layer" />
      <div className="profile-shell">

        {/* Header */}
        <div className="profile-header">
          <div className="profile-header-overlay" />
          <div className="profile-avatar-wrap">
            {avatarUrl ? (
              <img
                key={avatarUrl}
                src={avatarUrl}
                alt={displayName}
                className="profile-avatar-img"
                referrerPolicy="no-referrer"
                onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_STEAM_BACKGROUND_URL; }}
              />
            ) : (
              <div
                className="profile-avatar-img"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 36,
                  fontWeight: 700,
                  color: "#fff",
                  background: "linear-gradient(135deg, #1e3a5f, #2563eb)",
                }}
              >
                {initials || "?"}
              </div>
            )}
          </div>
          <div className="profile-info">
            <h1 className="profile-name">{displayName}</h1>
            <div className="profile-status">
              {role === "admin" ? "🛡️ Admin" : role === "ctv" ? "🎙️ CTV" : "🟢 Trực tuyến"}
            </div>
            <div className="profile-summary">{summary}</div>
          </div>
          <div className="profile-header-actions" style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            <div
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                background: "rgba(164,208,7,0.15)",
                border: "1px solid rgba(164,208,7,0.3)",
                color: "#a4d007",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {formatMoney(balance)}
            </div>
            <button
              onClick={() => setShowEdit(true)}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                background: "rgba(59,130,246,0.15)",
                border: "1px solid rgba(59,130,246,0.3)",
                color: "#66c0f4",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ✏️ Chỉnh sửa hồ sơ
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="profile-content-grid">
          {/* Main */}
          <div className="profile-main-col">
            <div className="profile-section">
              <div className="profile-section-header">
                Trò chơi đã sở hữu ({ownedGames.length})
              </div>
              <div className="profile-game-showcase">
                {loadingGames ? (
                  <div style={{ color: "#8f98a0", fontSize: 13, padding: "10px 0" }}>Đang tải...</div>
                ) : ownedGames.length === 0 ? (
                  <div style={{ color: "#8f98a0", fontSize: 13 }}>
                    Chưa có game.{" "}
                    {onNavigateStore && (
                      <button
                        type="button"
                        onClick={onNavigateStore}
                        style={{ background: "none", border: "none", color: "#66c0f4", cursor: "pointer", fontSize: 13, padding: 0 }}
                      >
                        Ghé thăm cửa hàng →
                      </button>
                    )}
                  </div>
                ) : (
                  ownedGames.map((g) => {
                    const appid = String(g.appid || "");
                    const img = (g.custom_image as string)
                      || (g.header_image as string)
                      || (appid ? steamAppAssetUrl(appid, "header.jpg") : DEFAULT_STEAM_BACKGROUND_URL);
                    return (
                      <div key={String(g.id || appid)} className="showcase-item" title={g.name || `Game ${appid}`}>
                        <img
                          src={img}
                          alt={g.name || ""}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            if (target.src !== DEFAULT_STEAM_BACKGROUND_URL && appid && !target.src.includes("steam/apps")) {
                              target.src = steamAppAssetUrl(appid, "header.jpg");
                            } else {
                              target.src = DEFAULT_STEAM_BACKGROUND_URL;
                            }
                          }}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="profile-sidebar">
            <div className="profile-section">
              <div className="profile-section-header">Thông tin</div>
              <div className="profile-sidebar-item">
                <div className="sidebar-label">Số dư ví</div>
                <div className="sidebar-value" style={{ color: "#a4d007" }}>
                  {formatMoney(balance)}
                </div>
              </div>
              <div className="profile-sidebar-item">
                <div className="sidebar-label">Vai trò</div>
                <div className="sidebar-value" style={{ textTransform: "capitalize", fontSize: 14 }}>
                  {role === "admin" ? "Admin" : role === "ctv" ? "Cộng tác viên" : "Người dùng"}
                </div>
              </div>
              {user.username && (
                <div className="profile-sidebar-item">
                  <div className="sidebar-label">Username</div>
                  <div className="sidebar-value" style={{ fontSize: 14, color: "#66c0f4" }}>
                    @{String(user.username)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit modal */}
      {showEdit && (
        <EditProfileModal
          user={user}
          onClose={() => {
            setShowEdit(false);
            setEditDraft(null);
            setEditSuccess(null);
          }}
          onSaved={() => onProfileUpdate?.()}
          initialDraft={editDraft}
          onDraftChange={setEditDraft}
          successMessage={editSuccess}
          onClearSuccess={() => setEditSuccess(null)}
          onRequestOtp={({ newPassword }) => {
            // Tạm ẩn modal Edit, lưu pending password để sau OTP áp dụng
            setPendingPassword(newPassword);
            setShowEdit(false);
          }}
        />
      )}

      {/* OTP modal — chỉ hiện khi đang chờ xác thực để đổi mật khẩu */}
      {pendingPassword !== null && user.email && (
        <OtpVerifyModal
          email={String(user.email)}
          purpose="change_password"
          title="Xác thực đổi mật khẩu"
          description="Mã OTP 8 ký tự đã được gửi đến email của bạn. Vui lòng nhập mã để hoàn tất đổi mật khẩu."
          onCancel={() => {
            // User hủy: bỏ pending, mở lại Edit (giữ nguyên draft)
            setPendingPassword(null);
            setShowEdit(true);
          }}
          onVerified={async () => {
            try {
              const res = (await tauriAPI.supabase.updatePasswordAdmin({
                email: String(user.email),
                password: pendingPassword,
              })) as { success?: boolean; message?: string };
              if (!res?.success) {
                // Đóng OTP, mở lại Edit để hiện lỗi
                setPendingPassword(null);
                setEditSuccess(null);
                // Xoá password ra khỏi draft cho an toàn
                setEditDraft((d) =>
                  d ? { ...d, currentPassword: "", newPassword: "", confirmPassword: "" } : d
                );
                setShowEdit(true);
                // Nhồi lỗi vào success-banner đỏ thông qua alert state — đơn giản hoá: dùng alert
                setTimeout(() => alert(res?.message || "Đổi mật khẩu thất bại"), 50);
                return;
              }
              // Thành công: clear password fields trong draft, mở lại Edit với banner success
              setEditDraft((d) =>
                d
                  ? { ...d, currentPassword: "", newPassword: "", confirmPassword: "" }
                  : d
              );
              setPendingPassword(null);
              setEditSuccess("Đổi mật khẩu thành công!");
              setShowEdit(true);
              // Refresh session để cập nhật token (nếu cần)
              await onProfileUpdate?.();
            } catch (e) {
              const msg = (e as Error)?.message || "Lỗi đổi mật khẩu";
              setPendingPassword(null);
              setShowEdit(true);
              setTimeout(() => alert(msg), 50);
            }
          }}
        />
      )}
    </div>
  );
}
