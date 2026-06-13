import React from "react";
import { formatMoney } from "../lib/utils";

interface Props {
  detailLog: Record<string, unknown>;
  detailData: Record<string, unknown> | null;
}

const reasonLabel: Record<string, string> = {
  purchase_game: "Mua game",
  game_purchase: "Mua game",
  purchase: "Mua game",
  purchase_dlc: "Mua DLC",
  deposit: "Nạp tiền (tự động)",
  wallet_topup: "Nạp tiền (tự động)",
  topup: "Nạp tiền",
  admin_gift: "Payer tặng / trừ thủ công",
  admin_set: "Payer đặt số dư",
  rollback: "Hoàn tiền (rollback)",
  unknown: "Không rõ",
};

export function BalanceLogDetailBody({ detailLog, detailData }: Props): React.ReactElement {
  const amount = Number(detailLog.amount ?? 0);
  const before = Number(detailLog.balance_before ?? 0);
  const after = Number(detailLog.balance_after ?? 0);
  const amountColor = amount >= 0 ? "#4ade80" : "#f87171";
  const amountDisplay = (amount >= 0 ? "+" : "") + formatMoney(amount);
  const ts = detailLog.created_at ? new Date(String(detailLog.created_at)).toLocaleString("vi-VN") : "—";

  const ad = (detailData?.action_detail as Record<string, unknown> | undefined) ?? null;
  const du = (detailData?.discount_used as Record<string, unknown> | undefined) ?? null;
  const reason = String(detailData?.reason || detailLog.reason || "");
  const userInfo = detailData?.user as Record<string, unknown> | undefined;

  const userName = String(userInfo?.display_name || userInfo?.username || detailLog.user_id || "—");
  const reasonText = String(reasonLabel[reason] || reason || "—");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "10px 14px" }}>
        <div style={{ fontSize: 11, color: "#8f98a0", marginBottom: 4 }}>NGƯỜI DÙNG</div>
        <div style={{ color: "#66c0f4", fontWeight: 600 }}>{userName}</div>
        {userInfo?.email ? (
          <div style={{ fontSize: 12, color: "#8f98a0" }}>{String(userInfo.email)}</div>
        ) : null}
      </div>

      <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "10px 14px" }}>
        <div style={{ fontSize: 11, color: "#8f98a0", marginBottom: 4 }}>BIẾN ĐỘNG</div>
        <div style={{ fontWeight: 700, fontSize: 20, color: amountColor }}>{amountDisplay}</div>
        <div style={{ fontSize: 12, color: "#8f98a0", marginTop: 2 }}>
          {formatMoney(before)} {"->"} {formatMoney(after)}
        </div>
        <div style={{ fontSize: 12, color: "#c7d5e0", marginTop: 4 }}>
          {ts} · <span style={{ color: "#66c0f4" }}>{reasonText}</span>
        </div>
      </div>

      {ad ? <ActionDetail ad={ad} /> : null}
      {du && du.code ? <DiscountUsed du={du} /> : null}
    </div>
  );
}

function ActionDetail({ ad }: { ad: Record<string, unknown> }): React.ReactElement {
  const type = String(ad.type || "");

  if (type === "game_purchase") {
    const gameName = String(ad.game_name || "—");
    const appid = ad.game_appid != null ? String(ad.game_appid) : "";
    const purchaseTime = ad.purchase_time ? new Date(String(ad.purchase_time)).toLocaleString("vi-VN") : "";
    return (
      <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "10px 14px" }}>
        <div style={{ fontSize: 11, color: "#8f98a0", marginBottom: 6 }}>CHI TIẾT</div>
        <div style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>🎮 {gameName}</div>
        {appid ? (
          <div style={{ fontSize: 12, color: "#66c0f4", fontFamily: "monospace", marginTop: 2 }}>AppID: {appid}</div>
        ) : null}
        {purchaseTime ? (
          <div style={{ fontSize: 11, color: "#8f98a0", marginTop: 3 }}>Thời gian: {purchaseTime}</div>
        ) : null}
      </div>
    );
  }

  if (type === "dlc_purchase") {
    const dlcName = String(ad.dlc_name || `DLC ${String(ad.dlc_appid || "")}`);
    const appid = ad.dlc_appid != null ? String(ad.dlc_appid) : "";
    return (
      <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "10px 14px" }}>
        <div style={{ fontSize: 11, color: "#8f98a0", marginBottom: 6 }}>CHI TIẾT</div>
        <div style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>🧩 {dlcName}</div>
        {appid ? (
          <div style={{ fontSize: 12, color: "#66c0f4", fontFamily: "monospace", marginTop: 2 }}>AppID: {appid}</div>
        ) : null}
      </div>
    );
  }

  if (type === "deposit") {
    const dep = (ad.deposit as Record<string, unknown> | undefined) ?? null;
    return (
      <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "10px 14px" }}>
        <div style={{ fontSize: 11, color: "#8f98a0", marginBottom: 6 }}>CHI TIẾT</div>
        <div style={{ color: "#c7d5e0" }}>💳 Nạp tiền qua QR</div>
        {dep ? (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
            {dep.amount != null ? (
              <div style={{ fontSize: 12, color: "#8f98a0" }}>
                Giá trị nhận: <span style={{ color: "#4ade80" }}>{formatMoney(Number(dep.amount))}</span>
              </div>
            ) : null}
            {dep.pay_amount != null ? (
              <div style={{ fontSize: 12, color: "#8f98a0" }}>
                Thực trả: <span style={{ color: "#c7d5e0" }}>{formatMoney(Number(dep.pay_amount))}</span>
              </div>
            ) : null}
            {dep.discount_code != null ? (
              <div style={{ fontSize: 12, color: "#a4d007" }}>
                Mã giảm nạp: {String(dep.discount_code)} (-{formatMoney(Number(dep.discount_amount || 0))})
              </div>
            ) : null}
            {dep.order_code != null ? (
              <div style={{ fontSize: 12, color: "#66c0f4", fontFamily: "monospace" }}>
                Mã đơn: {String(dep.order_code)}
              </div>
            ) : null}
            {dep.status != null ? (
              <div style={{ fontSize: 11, color: "#8f98a0" }}>Trạng thái: {String(dep.status)}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (type === "admin_gift" || type === "admin_set") {
    return (
      <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "10px 14px" }}>
        <div style={{ fontSize: 11, color: "#8f98a0", marginBottom: 6 }}>CHI TIẾT</div>
        <div style={{ color: "#c7d5e0", fontSize: 13 }}>{String(ad.description || "—")}</div>
      </div>
    );
  }

  return (
    <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "#8f98a0", marginBottom: 6 }}>CHI TIẾT</div>
      <div style={{ fontSize: 12, color: "#c7d5e0" }}>{type || "—"}</div>
    </div>
  );
}

function DiscountUsed({ du }: { du: Record<string, unknown> }): React.ReactElement {
  const code = String(du.code || "");
  const name = du.name != null ? String(du.name) : "";
  const discountAmount = du.discount_amount != null ? Number(du.discount_amount) : null;
  const orderAmount = du.order_amount != null ? Number(du.order_amount) : null;
  const orderText = orderAmount != null ? ` / tổng đơn ${formatMoney(orderAmount)}` : "";

  return (
    <div style={{ background: "rgba(164,208,7,0.08)", borderRadius: 8, padding: "10px 14px", border: "1px solid rgba(164,208,7,0.2)" }}>
      <div style={{ fontSize: 11, color: "#8f98a0", marginBottom: 4 }}>MÃ GIẢM GIÁ ĐÃ DÙNG</div>
      <div style={{ fontFamily: "monospace", fontWeight: 700, color: "#a4d007", fontSize: 15 }}>{code}</div>
      {name ? <div style={{ fontSize: 12, color: "#8f98a0", marginTop: 2 }}>{name}</div> : null}
      {discountAmount != null ? (
        <div style={{ fontSize: 12, color: "#4ade80", marginTop: 4 }}>
          Đã giảm: -{formatMoney(discountAmount)}{orderText}
        </div>
      ) : null}
    </div>
  );
}
