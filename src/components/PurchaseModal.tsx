import { useEffect, useState } from "react";
import { tauriAPI } from "../lib/tauri-api";
import { formatMoney } from "../lib/utils";

export interface PurchaseItem {
  id: string;          // game.id hoặc dlc.id (UUID trong DB)
  appid: string;
  name: string;
  price: number;
  originalPrice?: number;
  type: "game" | "dlc";
  baseAppId?: string;  // chỉ cho dlc
}

interface AvailableDiscount {
  id: string;
  code: string;
  name?: string;
  description?: string;
  type: string;
  value: number;
  expires_at?: string | null;
  applies_to_sale: boolean;
  applies_to_all: boolean;
  min_price?: number | null;
  max_price?: number | null;
  max_uses?: number | null;
  current_uses: number;
}

interface PurchaseModalProps {
  items: PurchaseItem[];           // 1 item cho single buy, hoặc nhiều cho cart
  currentBalance: number;
  onClose: () => void;
  onPurchased: () => void;
}

export function PurchaseModal({ items, currentBalance, onClose, onPurchased }: PurchaseModalProps) {
  const [discountCode, setDiscountCode] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [purchasing, setPurchasing] = useState(false);
  const [availableDiscounts, setAvailableDiscounts] = useState<AvailableDiscount[]>([]);
  const [showDiscountList, setShowDiscountList] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  // Referral code state
  const [appliedReferralId, setAppliedReferralId] = useState<string | null>(null);

  const showToast = (msg: string, type: "success" | "error" = "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Tổng giá gốc
  const totalOriginalPrice = items.reduce((sum, it) => sum + (it.originalPrice || it.price), 0);
  const totalCurrentPrice = items.reduce((sum, it) => sum + it.price, 0);
  const saleAmount = Math.max(0, totalOriginalPrice - totalCurrentPrice);
  const finalPrice = Math.max(0, totalCurrentPrice - discountAmount);
  const balanceAfter = currentBalance - finalPrice;
  const insufficientBalance = balanceAfter < 0;

  // Load available discounts on mount
  useEffect(() => {
    tauriAPI.discount.listAvailable().then((res) => {
      if (res.success) setAvailableDiscounts(res.data || []);
    }).catch(() => {});
  }, []);

  const handleApplyCode = async (codeToApply?: string) => {
    const code = (codeToApply || discountCode).trim().toUpperCase();
    if (!code) {
      setValidationError("Vui lòng nhập mã giảm giá");
      return;
    }
    setValidating(true);
    setValidationError("");
    setAppliedReferralId(null);
    

    try {
      // Bước 1: thử validate như discount code thông thường
      let totalDiscount = 0;
      let discountOk = true;
      let discountError = "";

      for (const it of items) {
        const isOnSale = (it.originalPrice || 0) > it.price && (it.originalPrice || 0) > 0;
        try {
          const res = await tauriAPI.discount.validate({
            code,
            orderType: it.type,
            orderAmount: it.price,
            gameId: it.id,
            isOnSale,
          });
          if (!res.success) {
            discountOk = false;
            discountError = res.message || "Mã không hợp lệ";
            break;
          }
          totalDiscount += res.discount_amount || 0;
        } catch (discErr) {
          // discount.validate throw Err() → mã không tồn tại hoặc lỗi khác
          discountOk = false;
          discountError = (discErr as Error)?.message || "Mã không hợp lệ";
          break;
        }
      }

      if (discountOk) {
        setAppliedCode(code);
        setDiscountCode(code);
        setDiscountAmount(totalDiscount);
        setValidationError("");
        setShowDiscountList(false);
        showToast(`Đã áp dụng mã ${code} - giảm ${formatMoney(totalDiscount)}`, "success");
        setValidating(false);
        return;
      }

      // Bước 2: discount fail → luôn thử validate như referral code
      // (không chỉ khi "không tồn tại" — vì discount.validate có thể throw bất kỳ lỗi gì)
      try {
        const refRes = await tauriAPI.referral.validateCode(code);
        if (refRes.valid) {
          const refDiscount = Math.floor((totalCurrentPrice * refRes.discount_percent) / 100);
          setAppliedCode(code);
          setDiscountCode(code);
          setDiscountAmount(refDiscount);
          setAppliedReferralId(refRes.referral_code_id);
          setValidationError("");
          setShowDiscountList(false);
          showToast(`Mã giới thiệu ${code} - giảm ${refRes.discount_percent}% (${formatMoney(refDiscount)})`, "success");
          setValidating(false);
          return;
        }
      } catch (refErr) {
        // Referral cũng không hợp lệ → hiện lỗi referral nếu rõ hơn, không thì dùng lỗi discount
        const refMsg = (refErr as Error)?.message || "";
        const finalMsg = refMsg && !refMsg.toLowerCase().includes("không tồn tại")
          ? refMsg      // lỗi referral có nghĩa hơn (vd: đã dùng, không phải acc mới)
          : discountError; // fallback về lỗi discount gốc
        setValidationError(finalMsg || "Mã không hợp lệ");
        setAppliedCode(null);
        setDiscountAmount(0);
        setValidating(false);
        return;
      }

      // Cả hai đều fail với lỗi không rõ ràng
      setValidationError(discountError || "Mã không hợp lệ");
      setAppliedCode(null);
      setDiscountAmount(0);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error)?.message ?? "Lỗi validate mã";
      setValidationError(msg);
      setAppliedCode(null);
      setDiscountAmount(0);
    } finally {
      setValidating(false);
    }
  };

  const handleRemoveCode = () => {
    setAppliedCode(null);
    setDiscountAmount(0);
    setDiscountCode("");
    setValidationError("");
    setAppliedReferralId(null);
    
  };

  const handlePurchase = async () => {
    if (insufficientBalance) {
      showToast("Số dư không đủ. Vui lòng nạp thêm tiền.");
      return;
    }
    setPurchasing(true);
    try {
      let successCount = 0;
      let lastGame: PurchaseItem | null = null;
      for (const it of items) {
        if (it.type === "game") {
          // Nếu là referral code, không truyền vào purchase_game (không phải discount_code table)
          const codeToPass = appliedReferralId ? undefined : (appliedCode || undefined);
          const res = await tauriAPI.userGames.purchase(it.id, codeToPass);
          if (res.success) { successCount++; lastGame = it; }
        } else {
          if (!it.baseAppId) {
            throw new Error(`DLC ${it.name} thiếu base_appid`);
          }
          const codeToPass = appliedReferralId ? undefined : (appliedCode || undefined);
          const res = await tauriAPI.dlc.purchase({
            baseAppId: it.baseAppId,
            dlcAppId: it.appid,
            discountCode: codeToPass,
          });
          if (res.success) successCount++;
        }
      }

      // Ghi nhận referral use nếu có
      if (appliedReferralId && lastGame && successCount > 0) {
        try {
          const refRes = await tauriAPI.referral.recordUse({
            referralCodeId: appliedReferralId,
            gameId: lastGame.id,
            gameName: lastGame.name,
            orderAmount: lastGame.price,
            finalAmount: finalPrice,
          });
          if (refRes.success && (refRes as { warning?: string }).warning) {
            console.warn("Referral record warning:", (refRes as { warning?: string }).warning);
          }
        } catch (refErr) {
          // Không block purchase nếu record use fail
          console.error("referral_record_use error:", refErr);
        }
      }

      showToast(`Mua thành công ${successCount}/${items.length} sản phẩm!`, "success");
      setTimeout(() => {
        onPurchased();
        onClose();
      }, 1200);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error)?.message ?? "Lỗi mua";
      showToast("Lỗi: " + msg);
    } finally {
      setPurchasing(false);
    }
  };

  const formatDiscountLabel = (d: AvailableDiscount): string => {
    if (d.type === "percent") return `Giảm ${d.value}%`;
    return `Giảm ${formatMoney(d.value)}`;
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: 20,
      }}
      onClick={(e) => e.target === e.currentTarget && !purchasing && onClose()}
    >
      <div
        style={{
          background: "#161b22", borderRadius: 10, width: "100%", maxWidth: 560,
          border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "90vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, color: "#fff", fontSize: 18 }}>
            Xác nhận thanh toán
          </h2>
          <button
            onClick={onClose}
            disabled={purchasing}
            style={{ background: "none", border: "none", color: "#8f98a0", cursor: purchasing ? "wait" : "pointer", fontSize: 22, padding: 0, width: 28, height: 28 }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
          {/* Item list */}
          <div style={{ marginBottom: 20 }}>
            {items.map((it) => {
              const isOnSale = (it.originalPrice || 0) > it.price && (it.originalPrice || 0) > 0;
              return (
                <div key={it.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ color: "#c7d5e0", fontSize: 14, flex: 1, marginRight: 12 }}>
                    {it.name} {it.type === "dlc" && <span style={{ color: "#8f98a0", fontSize: 12 }}>(DLC)</span>}
                  </span>
                  <span style={{ color: "#fff", fontWeight: 600, fontSize: 14, whiteSpace: "nowrap" }}>
                    {isOnSale && (
                      <span style={{ color: "#8f98a0", textDecoration: "line-through", marginRight: 6, fontWeight: 400, fontSize: 12 }}>
                        {formatMoney(it.originalPrice!)}
                      </span>
                    )}
                    {formatMoney(it.price)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Discount code box */}
          <div style={{ background: "rgba(0,0,0,0.25)", padding: 14, borderRadius: 6, marginBottom: 16 }}>
            <div style={{ color: "#c7d5e0", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Mã giảm giá
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={discountCode}
                onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                placeholder="Nhập mã giảm giá..."
                disabled={!!appliedCode || validating}
                style={{
                  flex: 1, padding: "8px 12px",
                  background: appliedCode ? "rgba(16,185,129,0.1)" : "rgba(0,0,0,0.3)",
                  border: `1px solid ${appliedCode ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.1)"}`,
                  borderRadius: 4, color: appliedCode ? "#10b981" : "#fff",
                  fontFamily: "monospace", fontSize: 14, outline: "none",
                }}
              />
              {appliedCode ? (
                <button
                  type="button"
                  onClick={handleRemoveCode}
                  style={{ padding: "8px 14px", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#ef4444", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                >
                  Bỏ
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleApplyCode()}
                  disabled={validating || !discountCode.trim()}
                  style={{ padding: "8px 14px", background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 4, color: "#66c0f4", cursor: validating ? "wait" : "pointer", fontSize: 13, fontWeight: 600 }}
                >
                  {validating ? "..." : "Áp dụng"}
                </button>
              )}
            </div>
            {validationError && (
              <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{validationError}</div>
            )}

            {/* Toggle danh sách mã có sẵn */}
            {availableDiscounts.length > 0 && !appliedCode && (
              <>
                <button
                  type="button"
                  onClick={() => setShowDiscountList((v) => !v)}
                  style={{ marginTop: 8, background: "none", border: "none", color: "#66c0f4", fontSize: 12, cursor: "pointer", padding: 0 }}
                >
                  {showDiscountList ? "▲ Ẩn" : "▼ Xem"} mã giảm giá hiện có ({availableDiscounts.length})
                </button>

                {showDiscountList && (
                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {availableDiscounts.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => handleApplyCode(d.code)}
                        disabled={validating}
                        style={{
                          padding: "6px 10px",
                          background: "rgba(102,192,244,0.1)",
                          border: "1px solid rgba(102,192,244,0.25)",
                          borderRadius: 4, color: "#66c0f4",
                          fontSize: 12, cursor: "pointer", fontFamily: "monospace",
                          display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
                        }}
                        title={d.description || d.name || ""}
                      >
                        <span style={{ fontWeight: 700 }}>{d.code}</span>
                        <span style={{ color: "#a4d007", fontSize: 11 }}>{formatDiscountLabel(d)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bill */}
          <div style={{ background: "rgba(0,0,0,0.3)", padding: 16, borderRadius: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", color: "#8f98a0", fontSize: 13 }}>
              <span>Số dư hiện tại:</span>
              <span style={{ color: "#a4d007", fontWeight: 600 }}>{formatMoney(currentBalance)}</span>
            </div>
            {saleAmount > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", color: "#8f98a0", fontSize: 13 }}>
                <span>Giá gốc:</span>
                <span style={{ textDecoration: "line-through" }}>{formatMoney(totalOriginalPrice)}</span>
              </div>
            )}
            {saleAmount > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", color: "#a4d007", fontSize: 13 }}>
                <span>Giảm giá (sale):</span>
                <span>− {formatMoney(saleAmount)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", color: "#c7d5e0", fontSize: 13 }}>
              <span>Tạm tính:</span>
              <span>{formatMoney(totalCurrentPrice)}</span>
            </div>
            {discountAmount > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", color: "#a4d007", fontSize: 13 }}>
                <span>Mã giảm giá ({appliedCode}):</span>
                <span>− {formatMoney(discountAmount)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: 6, color: "#fff", fontSize: 16, fontWeight: 700 }}>
              <span>Thành tiền:</span>
              <span style={{ color: "#a4d007" }}>{formatMoney(finalPrice)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", color: insufficientBalance ? "#ef4444" : "#8f98a0", fontSize: 13 }}>
              <span>Số dư sau thanh toán:</span>
              <span style={{ fontWeight: 600 }}>{formatMoney(balanceAfter)}</span>
            </div>
          </div>

          {insufficientBalance && (
            <div style={{ marginTop: 12, padding: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#ef4444", fontSize: 13 }}>
              Số dư không đủ. Cần thêm {formatMoney(Math.abs(balanceAfter))}.
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onClose}
            disabled={purchasing}
            style={{ padding: "10px 20px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "#fff", cursor: purchasing ? "wait" : "pointer", fontSize: 14 }}
          >
            Hủy
          </button>
          <button
            onClick={handlePurchase}
            disabled={purchasing || insufficientBalance}
            style={{
              padding: "10px 24px",
              background: insufficientBalance ? "#3b4a6b" : "#a4d007",
              color: insufficientBalance ? "#8f98a0" : "#000",
              border: "none", borderRadius: 4,
              cursor: insufficientBalance || purchasing ? "not-allowed" : "pointer",
              fontSize: 14, fontWeight: 700, letterSpacing: 0.5,
            }}
          >
            {purchasing ? "Đang xử lý..." : `Thanh toán ${formatMoney(finalPrice)}`}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24,
          background: toast.type === "success" ? "rgba(16,185,129,0.95)" : "rgba(239,68,68,0.95)",
          color: "#fff", padding: "12px 18px", borderRadius: 8, fontSize: 13,
          maxWidth: 380, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 10001,
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
