import { useCallback, useEffect, useState } from "react";
import { tauriAPI } from "../lib/tauri-api";
import { formatMoney } from "../lib/utils";

interface AddFundsModalProps {
  currentBalance: number;
  onClose: () => void;
  onSuccess: (newBalance: number) => void;
}

interface PaymentInfo {
  qrUrl: string;
  amount: number;       // số tiền user nhận vào ví
  payAmount: number;    // số tiền user thực sự cần chuyển khoản (sau giảm)
  discountAmount: number;
  orderCode: string;
  depositId: string;
  bankId?: string;
  accountNo?: string;
  accountName?: string;
}

interface ConfirmDialog {
  title: string;
  message: string;
  onConfirm: () => void;
  variant?: "danger" | "primary";
}

const AMOUNTS = [50000, 100000, 150000, 200000, 250000, 300000, 350000, 400000, 450000, 500000];

export function AddFundsModal({ currentBalance, onClose, onSuccess }: AddFundsModalProps) {
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [paid, setPaid] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" | "info" | "warning" } | null>(null);

  // Discount code
  const [discountCode, setDiscountCode] = useState("");
  const [appliedCodeInfo, setAppliedCodeInfo] = useState<{ code: string; pay_amount: number; discount_amount: number } | null>(null);
  const [validating, setValidating] = useState(false);
  const [discountError, setDiscountError] = useState("");

  const showToast = (msg: string, type: "success" | "error" | "info" | "warning" = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Auto-poll when QR is shown
  useEffect(() => {
    if (!paymentInfo || paid) return;
    const interval = setInterval(async () => {
      try {
        const res = await tauriAPI.wallet.checkStatus(paymentInfo.depositId);
        const status = String(res?.status || "").toUpperCase();
        if (status === "PAID" || status === "SUCCESS" || status === "COMPLETED") {
          setPaid(true);
          // Lấy balance mới: ưu tiên giá trị do backend trả về sau khi check status,
          // fallback session lite
          let newBalance = currentBalance;
          if (typeof res?.balance === "number") {
            newBalance = Number(res.balance);
          } else {
            try {
              const session = await tauriAPI.supabase.getSessionLite();
              newBalance = Number((session as { balance?: number })?.balance ?? currentBalance);
            } catch (_) {}
          }
          onSuccess(newBalance);
        }
      } catch (_) {}
    }, 5000);
    return () => clearInterval(interval);
  }, [paymentInfo, paid, currentBalance, onSuccess]);

  const handleApplyDiscount = async () => {
    if (!selectedAmount || !discountCode.trim()) {
      setDiscountError("Vui lòng chọn số tiền và nhập mã");
      return;
    }
    setValidating(true);
    setDiscountError("");
    try {
      const res = await tauriAPI.discount.validateDeposit({
        code: discountCode.trim().toUpperCase(),
        depositAmount: selectedAmount,
      });
      if (!res.success) {
        setDiscountError(res.message || "Mã không hợp lệ");
        setAppliedCodeInfo(null);
        return;
      }
      setAppliedCodeInfo({
        code: res.code || discountCode.toUpperCase(),
        pay_amount: res.pay_amount ?? selectedAmount,
        discount_amount: res.discount_amount ?? 0,
      });
      showToast(`Đã áp dụng mã ${res.code}`, "success");
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error)?.message ?? "Lỗi";
      setDiscountError(msg);
      setAppliedCodeInfo(null);
    } finally {
      setValidating(false);
    }
  };

  const handleRemoveDiscount = () => {
    setAppliedCodeInfo(null);
    setDiscountCode("");
    setDiscountError("");
  };

  const handleGenerate = async () => {
    if (!selectedAmount) {
      showToast("Vui lòng chọn số tiền nạp", "warning");
      return;
    }
    setGenerating(true);
    try {
      const codeToUse = appliedCodeInfo?.code;
      const res = await tauriAPI.wallet.createPayment(selectedAmount, codeToUse);
      if (!res?.success) {
        showToast(res?.message || "Không thể tạo giao dịch", "error");
        return;
      }

      // Instant paid: discount 100% → balance đã được cộng ngay
      if (res.instantPaid) {
        setPaid(true);
        try {
          const session = await tauriAPI.supabase.getSessionLite();
          const newBalance = Number((session as { balance?: number })?.balance ?? currentBalance);
          onSuccess(newBalance);
        } catch (_) {}
        showToast("Đã nạp thành công bằng mã giảm giá!", "success");
        return;
      }

      if (!res.qrUrl) {
        showToast("Không nhận được mã QR từ máy chủ", "error");
        return;
      }
      setPaymentInfo({
        qrUrl: res.qrUrl,
        amount: res.amount ?? selectedAmount,
        payAmount: res.payAmount ?? res.amount ?? selectedAmount,
        discountAmount: res.discountAmount ?? 0,
        orderCode: res.orderCode ?? "",
        depositId: res.depositId ?? "",
        bankId: res.bankId,
        accountNo: res.accountNo,
        accountName: res.accountName,
      });
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error)?.message ?? "Lỗi không xác định";
      showToast("Lỗi: " + msg, "error");
    } finally {
      setGenerating(false);
    }
  };

  const cancelDeposit = useCallback(async () => {
    if (!paymentInfo?.depositId) return;
    try {
      await tauriAPI.wallet.cancelDeposit(paymentInfo.depositId);
    } catch (_) {}
  }, [paymentInfo?.depositId]);

  const handleClose = () => {
    if (paid) {
      onClose();
      return;
    }
    if (paymentInfo) {
      // Đã tạo QR — hỏi xác nhận
      setConfirmDialog({
        title: "Hủy giao dịch?",
        message: "Đã tạo mã QR. Đóng modal sẽ hủy giao dịch. Nếu bạn đã chuyển khoản, vui lòng chờ vài giây để hệ thống xác nhận.",
        variant: "danger",
        onConfirm: async () => {
          await cancelDeposit();
          setConfirmDialog(null);
          onClose();
        },
      });
      return;
    }
    onClose();
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Đã copy ${label}`, "success");
    } catch (_) {
      showToast("Không thể copy", "error");
    }
  };

  // Số tiền nạp được nhận (vào ví)
  const receivedAmount = selectedAmount ?? 0;
  // Số tiền user thực sự cần trả (sau discount nạp)
  const payAmount = paymentInfo?.payAmount ?? appliedCodeInfo?.pay_amount ?? receivedAmount;

  return (
    <>
      <div
        onClick={(e) => e.target === e.currentTarget && handleClose()}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: 20,
        }}
      >
        <div
          style={{
            background: "#161b22", borderRadius: 12, width: "100%", maxWidth: 880,
            border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            display: "flex", flexDirection: "column", maxHeight: "92vh", overflow: "hidden",
          }}
        >
          {/* Header */}
          <div style={{ padding: "18px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, color: "#fff", fontSize: 18, letterSpacing: 0.5 }}>NẠP TIỀN VÀO VÍ</h2>
            <button
              onClick={handleClose}
              style={{ background: "none", border: "none", color: "#8f98a0", cursor: "pointer", fontSize: 22, padding: 0, width: 28, height: 28 }}
            >
              ✕
            </button>
          </div>

          {/* Body — 2 columns */}
          <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
            {/* LEFT: Amount selection */}
            <div style={{ flex: 1, padding: 24, borderRight: "1px solid rgba(255,255,255,0.08)", overflowY: "auto", display: "flex", flexDirection: "column" }}>
              <div style={{ marginBottom: 8, color: "#c7d5e0", fontSize: 14, fontWeight: 600 }}>
                Chọn số tiền nạp
              </div>
              <div style={{ marginBottom: 14, color: "#8f98a0", fontSize: 12 }}>
                Số dư hiện tại: <span style={{ color: "#a4d007", fontWeight: 700 }}>{formatMoney(currentBalance)}</span>
              </div>

              {/* Amount grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 16 }}>
                {AMOUNTS.map((amt) => {
                  const isSelected = selectedAmount === amt;
                  const disabled = !!paymentInfo;
                  return (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => !disabled && setSelectedAmount(amt)}
                      disabled={disabled}
                      style={{
                        padding: "12px 8px", border: "1px solid",
                        borderColor: isSelected ? "#a4d007" : "rgba(255,255,255,0.1)",
                        background: isSelected ? "rgba(164,208,7,0.12)" : "rgba(0,0,0,0.2)",
                        borderRadius: 6, color: isSelected ? "#a4d007" : "#c7d5e0",
                        cursor: disabled ? "not-allowed" : "pointer",
                        fontSize: 14, fontWeight: 600,
                        opacity: disabled && !isSelected ? 0.4 : 1,
                        transition: "all 0.15s",
                      }}
                    >
                      {formatMoney(amt)}
                    </button>
                  );
                })}
              </div>

              {/* Discount code */}
              {selectedAmount && !paymentInfo && (
                <div style={{ marginBottom: 12, padding: 12, background: "rgba(0,0,0,0.25)", borderRadius: 6 }}>
                  <div style={{ color: "#c7d5e0", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    Mã giảm giá nạp tiền (tùy chọn)
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="text"
                      value={discountCode}
                      onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                      placeholder="VD: NAP10K"
                      disabled={!!appliedCodeInfo || validating}
                      style={{
                        flex: 1, padding: "8px 10px",
                        background: appliedCodeInfo ? "rgba(16,185,129,0.1)" : "rgba(0,0,0,0.3)",
                        border: `1px solid ${appliedCodeInfo ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.1)"}`,
                        borderRadius: 4, color: appliedCodeInfo ? "#10b981" : "#fff",
                        fontFamily: "monospace", fontSize: 12, outline: "none",
                      }}
                    />
                    {appliedCodeInfo ? (
                      <button onClick={handleRemoveDiscount} style={{ padding: "8px 12px", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#ef4444", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                        Bỏ
                      </button>
                    ) : (
                      <button onClick={handleApplyDiscount} disabled={validating || !discountCode.trim()} style={{ padding: "8px 12px", background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 4, color: "#66c0f4", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                        {validating ? "..." : "Áp dụng"}
                      </button>
                    )}
                  </div>
                  {discountError && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 4 }}>{discountError}</div>}
                  {appliedCodeInfo && (
                    <div style={{ marginTop: 6, color: "#a4d007", fontSize: 11 }}>
                      ✓ Tiết kiệm {formatMoney(appliedCodeInfo.discount_amount)} — chỉ trả {formatMoney(appliedCodeInfo.pay_amount)}
                    </div>
                  )}
                </div>
              )}

              {/* Spacer */}
              <div style={{ flex: 1 }} />

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button
                  onClick={handleClose}
                  style={{ flex: 1, padding: "11px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}
                >
                  HỦY
                </button>
                {!paymentInfo && (
                  <button
                    onClick={handleGenerate}
                    disabled={generating || !selectedAmount}
                    style={{
                      flex: 1, padding: "11px",
                      background: !selectedAmount ? "#3b4a6b" : "#a4d007",
                      color: !selectedAmount ? "#8f98a0" : "#000",
                      border: "none", borderRadius: 4,
                      cursor: !selectedAmount || generating ? "not-allowed" : "pointer",
                      fontSize: 14, fontWeight: 700, letterSpacing: 0.5,
                    }}
                  >
                    {generating ? "ĐANG TẠO..." : "NẠP"}
                  </button>
                )}
              </div>
            </div>

            {/* RIGHT: Payment info — dark theme matching modal */}
            <div style={{ flex: 1, padding: 24, display: "flex", alignItems: "center", justifyContent: "center", overflowY: "auto" }}>
              <div
                style={{
                  background: "rgba(0,0,0,0.25)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 12,
                  padding: 22,
                  width: "100%",
                  display: "flex", flexDirection: "column", alignItems: "center",
                  position: "relative",
                }}
              >
                {paid && (
                  <div style={{
                    position: "absolute", inset: 0, background: "rgba(16,185,129,0.97)", borderRadius: 12,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", padding: 24,
                  }}>
                    <div style={{ fontSize: 64, marginBottom: 12 }}>✓</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>THANH TOÁN THÀNH CÔNG</div>
                    <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 16 }}>Số tiền đã được cộng vào ví</div>
                    <button onClick={onClose} style={{ padding: "10px 24px", background: "#fff", border: "none", borderRadius: 6, color: "#10b981", cursor: "pointer", fontWeight: 700 }}>
                      Đóng
                    </button>
                  </div>
                )}

                {/* QR area — bo nền sáng tối thiểu để QR đọc được */}
                <div style={{
                  width: 220, height: 220,
                  background: paymentInfo ? "#fff" : "rgba(255,255,255,0.03)",
                  borderRadius: 10,
                  border: paymentInfo ? "none" : "1px dashed rgba(255,255,255,0.12)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 18, padding: paymentInfo ? 6 : 0,
                }}>
                  {paymentInfo ? (
                    <img src={paymentInfo.qrUrl} alt="QR" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 6 }} />
                  ) : (
                    <span style={{ color: "#8f98a0", fontSize: 13 }}>QR sẽ hiển thị tại đây</span>
                  )}
                </div>

                {/* Info rows */}
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
                  <InfoRow
                    label="Tên tài khoản"
                    value={paymentInfo?.accountName || ""}
                    onCopy={paymentInfo?.accountName ? () => copyText(paymentInfo.accountName!, "tên tài khoản") : undefined}
                  />
                  <InfoRow
                    label="Số tài khoản"
                    value={paymentInfo?.accountNo || ""}
                    valueStyle={{ fontFamily: "monospace" }}
                    onCopy={paymentInfo?.accountNo ? () => copyText(paymentInfo.accountNo!, "số tài khoản") : undefined}
                  />
                  <InfoRow
                    label="Mã giao dịch"
                    value={paymentInfo ? `NYV${paymentInfo.orderCode}` : ""}
                    valueStyle={{ fontFamily: "monospace", color: "#66c0f4" }}
                    onCopy={paymentInfo ? () => copyText(`NYV${paymentInfo.orderCode}`, "mã giao dịch") : undefined}
                  />
                  <InfoRow
                    label="Số tiền nạp"
                    value={paymentInfo ? formatMoney(paymentInfo.amount) : ""}
                    valueStyle={{ color: "#a4d007", fontWeight: 700 }}
                  />
                  {appliedCodeInfo && payAmount !== receivedAmount && (
                    <InfoRow
                      label="Số tiền thanh toán"
                      value={paymentInfo ? formatMoney(payAmount) : ""}
                      valueStyle={{ color: "#f87171", fontWeight: 700 }}
                    />
                  )}
                </div>

                {paymentInfo && !paid && (
                  <div style={{ marginTop: 18, fontSize: 11, color: "#8f98a0", textAlign: "center", lineHeight: 1.5 }}>
                    Đang chờ xác nhận từ ngân hàng...<br />
                    Hệ thống tự cập nhật sau khi nhận tiền.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm dialog */}
      {confirmDialog && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10002, backdropFilter: "blur(4px)" }}>
          <div style={{ background: "#161b22", borderRadius: 8, padding: 24, minWidth: 380, maxWidth: 480, border: "1px solid rgba(255,255,255,0.12)" }}>
            <h3 style={{ margin: "0 0 12px 0", color: "#fff", fontSize: 17 }}>{confirmDialog.title}</h3>
            <p style={{ color: "#c7d5e0", fontSize: 14, lineHeight: 1.6, margin: "0 0 20px 0" }}>{confirmDialog.message}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setConfirmDialog(null)} style={{ padding: "9px 18px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 13 }}>Tiếp tục</button>
              <button onClick={confirmDialog.onConfirm} style={{ padding: "9px 18px", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, background: confirmDialog.variant === "danger" ? "#ef4444" : "#2563eb" }}>Vẫn hủy</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24,
          background: toast.type === "success" ? "rgba(16,185,129,0.95)" : toast.type === "error" ? "rgba(239,68,68,0.95)" : toast.type === "warning" ? "rgba(245,158,11,0.95)" : "rgba(59,130,246,0.95)",
          color: "#fff", padding: "12px 18px", borderRadius: 8, fontSize: 13,
          maxWidth: 380, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 10003,
        }}>
          {toast.msg}
        </div>
      )}
    </>
  );
}

function InfoRow({ label, value, valueStyle, onCopy }: { label: string; value: string; valueStyle?: React.CSSProperties; onCopy?: () => void }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "9px 2px",
      borderBottom: "1px dashed rgba(255,255,255,0.08)",
    }}>
      <span style={{ color: "#8f98a0", fontSize: 12, fontWeight: 500 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "#c7d5e0", fontSize: 13, fontWeight: 600, ...valueStyle }}>
          {value || "—"}
        </span>
        {onCopy && value && (
          <button
            onClick={onCopy}
            style={{
              background: "rgba(102,192,244,0.1)",
              border: "1px solid rgba(102,192,244,0.25)",
              borderRadius: 4, padding: "2px 7px", fontSize: 10,
              cursor: "pointer", color: "#66c0f4", fontWeight: 600,
            }}
          >
            Copy
          </button>
        )}
      </div>
    </div>
  );
}
