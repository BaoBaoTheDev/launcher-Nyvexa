import { useEffect, useState } from "react";
import { tauriAPI } from "../lib/tauri-api";
import { formatMoney } from "../lib/utils";

interface ReferralInfo {
  code: string | null;
  id?: string;
  total_uses: number;
  total_earned: number;
  discount_percent: number;
  tier: number;
  username: string | null;
  referral_balance: number;
}

interface ReferralModalProps {
  onClose: () => void;
}

const TIER_LABEL = ["", "Cấp 1", "Cấp 2", "Cấp 3"];
const TIER_COLOR = ["", "#8f98a0", "#66c0f4", "#a4d007"];

export function ReferralModal({ onClose }: ReferralModalProps) {
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await tauriAPI.referral.getMyCode();
      setInfo(data as ReferralInfo);
    } catch (e) {
      setError((e as Error)?.message || "Không tải được thông tin mã giới thiệu.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleCreate = async () => {
    setCreating(true);
    setError("");
    try {
      await tauriAPI.referral.createCode();
      await load();
    } catch (e) {
      setError((e as Error)?.message || "Không tạo được mã.");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = () => {
    if (info?.code) {
      navigator.clipboard.writeText(info.code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const tier = info?.tier ?? 1;
  const usesLeft = tier < 3 ? (tier === 1 ? 20 : 30) - ((info?.total_uses ?? 0) - (tier === 1 ? 0 : 20)) : 0;
  const progressPct = tier < 3
    ? Math.min(100, tier === 1
        ? ((info?.total_uses ?? 0) / 20) * 100
        : (((info?.total_uses ?? 0) - 20) / 30) * 100)
    : 100;

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
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
          <h2 style={{ margin: 0, color: "#fff", fontSize: 20, fontWeight: 700 }}>Mã Giới Thiệu</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8f98a0", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>✕</button>
        </div>

        {/* Username */}
        <div style={{ color: "#66c0f4", fontSize: 14, fontWeight: 700, marginBottom: 14 }}>
          @{info?.username || "..."}
        </div>

        {/* Mô tả hệ thống */}
        <div style={{
          background: "rgba(59,130,246,0.08)",
          border: "1px solid rgba(59,130,246,0.2)",
          borderRadius: 10,
          padding: "14px 16px",
          marginBottom: 18,
          fontSize: 13,
          color: "#c7d5e0",
          lineHeight: 1.7,
        }}>
          <div style={{ fontWeight: 700, color: "#fff", marginBottom: 6, fontSize: 14 }}>Cách hoạt động</div>
          <p style={{ margin: "0 0 6px" }}>
            Khi <strong style={{ color: "#a4d007" }}>bạn bè nhập mã của bạn</strong> lúc mua game,
            họ được giảm giá và <strong style={{ color: "#a4d007" }}>bạn nhận cùng % đó</strong>.
          </p>
          <p style={{ margin: "0 0 6px" }}>
            Ví dụ: B mời A, A mua game 100.000₫ → A giảm <strong style={{ color: "#66c0f4" }}>15.000₫</strong> còn 85.000₫, B nhận <strong style={{ color: "#a4d007" }}>15.000₫</strong>.
          </p>
          <div style={{ marginTop: 6, padding: "8px 10px", background: "rgba(239,68,68,0.08)", borderLeft: "2px solid rgba(239,68,68,0.4)", borderRadius: "0 6px 6px 0" }}>
            <div style={{ fontSize: 11, color: "#f87171", fontWeight: 700, marginBottom: 3 }}>ĐIỀU KIỆN ÁP DỤNG MÃ</div>
            <ul style={{ margin: 0, paddingLeft: 14, display: "flex", flexDirection: "column", gap: 2, fontSize: 12, color: "#c7d5e0" }}>
              <li>Mỗi tài khoản chỉ được dùng mã giới thiệu <strong style={{ color: "#fff" }}>1 lần duy nhất</strong></li>
              <li>Tài khoản phải <strong style={{ color: "#fff" }}>chưa sở hữu game nào</strong> (lần mua đầu tiên)</li>
              <li>Không thể dùng mã của chính mình</li>
            </ul>
          </div>
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
            {[
              { tier: 1, pct: 15, req: "Mặc định" },
              { tier: 2, pct: 20, req: "20 người" },
              { tier: 3, pct: 25, req: "50 người" },
            ].map(t => (
              <div key={t.tier} style={{
                background: info?.tier === t.tier ? "rgba(59,130,246,0.15)" : "rgba(0,0,0,0.2)",
                border: `1px solid ${info?.tier === t.tier ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.06)"}`,
                borderRadius: 8, padding: "8px 10px", textAlign: "center",
              }}>
                <div style={{ fontSize: 11, color: TIER_COLOR[t.tier], fontWeight: 700 }}>CẤP {t.tier}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#fff", lineHeight: 1.1 }}>{t.pct}%</div>
                <div style={{ fontSize: 10, color: "#8f98a0", marginTop: 2 }}>{t.req}</div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ color: "#ff7a7a", fontSize: 13, marginBottom: 12, padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderLeft: "3px solid #ef4444", borderRadius: 4 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", color: "#8f98a0", padding: "24px 0" }}>Đang tải...</div>
        ) : (
          <>
            {/* Box 1: Mã giới thiệu */}
            <div style={{
              background: "#0d1117",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: "16px 18px",
              marginBottom: 12,
            }}>
              <div style={{ fontSize: 11, color: "#8f98a0", fontWeight: 700, letterSpacing: 0.5, marginBottom: 8, textTransform: "uppercase" }}>
                Mã của bạn
              </div>
              {info?.code ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    flex: 1,
                    fontFamily: "Consolas, monospace",
                    fontSize: 26,
                    fontWeight: 800,
                    letterSpacing: 4,
                    color: "#fff",
                  }}>
                    {info.code}
                  </div>
                  <button
                    onClick={handleCopy}
                    style={{
                      padding: "8px 14px",
                      background: copied ? "rgba(16,185,129,0.15)" : "rgba(59,130,246,0.15)",
                      border: `1px solid ${copied ? "rgba(16,185,129,0.35)" : "rgba(59,130,246,0.35)"}`,
                      borderRadius: 8,
                      color: copied ? "#10b981" : "#66c0f4",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {copied ? "✓ Đã chép" : "Sao chép"}
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    style={{
                      padding: "12px 28px",
                      background: creating ? "#3b4a6b" : "linear-gradient(180deg,#3b82f6,#2563eb)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: 20,
                      color: "#fff",
                      cursor: creating ? "wait" : "pointer",
                      fontSize: 14,
                      fontWeight: 700,
                    }}
                  >
                    {creating ? "Đang tạo..." : "✨ Tạo Mã"}
                  </button>
                </div>
              )}
            </div>

            {/* Box 2: Số tiền & cấp độ */}
            <div style={{
              background: "#0d1117",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: "16px 18px",
              marginBottom: 14,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#8f98a0", fontWeight: 700, letterSpacing: 0.5, marginBottom: 4, textTransform: "uppercase" }}>
                    Số dư từ giới thiệu
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: "#a4d007" }}>
                    {formatMoney(info?.referral_balance ?? 0)}
                  </div>
                  <div style={{ fontSize: 11, color: "#8f98a0", marginTop: 2 }}>
                    Tổng kiếm được: {formatMoney(info?.total_earned ?? 0)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#8f98a0", fontWeight: 700, letterSpacing: 0.5, marginBottom: 4, textTransform: "uppercase" }}>
                    Cấp độ
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: TIER_COLOR[tier] }}>{TIER_LABEL[tier]}</div>
                  <div style={{ fontSize: 12, color: "#66c0f4", fontWeight: 700 }}>{info?.discount_percent ?? 15}% hoa hồng</div>
                </div>
              </div>

              {/* Progress bar */}
              {tier < 3 && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8f98a0", marginBottom: 4 }}>
                    <span>{info?.total_uses ?? 0} người đã dùng</span>
                    <span>Cần thêm <strong style={{ color: "#fff" }}>{Math.max(0, usesLeft)}</strong> người → Cấp {tier + 1}</span>
                  </div>
                  <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${progressPct}%`,
                      background: `linear-gradient(90deg, ${TIER_COLOR[tier]}, ${TIER_COLOR[Math.min(3, tier + 1)]})`,
                      borderRadius: 999,
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                </div>
              )}
              {tier === 3 && (
                <div style={{ fontSize: 12, color: "#a4d007", fontWeight: 700, textAlign: "center", marginTop: 4 }}>
                  🏆 Đã đạt cấp cao nhất — {info?.total_uses ?? 0} người đã dùng mã
                </div>
              )}
            </div>

            {/* Hướng dẫn rút tiền */}
            <div style={{
              background: "rgba(239,68,68,0.07)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 8,
              padding: "12px 14px",
              fontSize: 12,
              color: "#c7d5e0",
              lineHeight: 1.7,
            }}>
              <div style={{ fontWeight: 700, color: "#f87171", marginBottom: 6 }}>💳 Rút tiền về ngân hàng</div>
              <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3 }}>
                <li>Mỗi lần rút tối thiểu <strong style={{ color: "#fff" }}>100.000₫</strong> và tối đa <strong style={{ color: "#fff" }}>1.900.000₫</strong></li>
                <li>Liên hệ qua Discord/Zalo của launcher tại <strong style={{ color: "#66c0f4" }}>nyvexa.online</strong></li>
                <li>Chụp màn hình toàn bộ popup này <span style={{ color: "#8f98a0" }}>(gồm username, số dư và mã)</span> để xác nhận</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
