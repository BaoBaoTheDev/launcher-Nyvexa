import { useEffect, useRef, useState } from "react";
import { useLibrary } from "../../hooks/useLibrary";
import { OwnedGame } from "../../hooks/useLibrary";
import { tauriAPI, SteamAppDetails, DlcItem } from "../../lib/tauri-api";
import {
  steamAppAssetUrl,
  DEFAULT_STEAM_BACKGROUND_URL,
} from "../../lib/runtimeUrls";
import { isGameReleased } from "../../lib/utils";
import "../../styles/library.css";

// ─── Types ─────────────────────────────────────────────────────────────────

interface LibraryPageProps {
  focusAppId?: string;
  onSelectGame?: (appid: string) => void;
  onGoToStore?: (appid: string) => void;
}

// ─── Sub: Play button ───────────────────────────────────────────────────────

interface PlayButtonProps {
  game: OwnedGame;
  allOwnedGames: OwnedGame[];
  steamDetails: SteamAppDetails | null;
  ownedDlcIds: string[];
  loadSelectedDlcIds: (appId: string) => string[];
  onMessage: (msg: string, type: "success" | "error" | "warning" | "info") => void;
}

function PlayButton({
  game,
  allOwnedGames,
  steamDetails,
  ownedDlcIds,
  loadSelectedDlcIds,
  onMessage,
}: PlayButtonProps) {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const appId = String(game.appid || "").trim();
  // Game chưa ra mắt: dùng coming_soon flag + release_date string từ Steam
  const releaseDateStr =
    steamDetails?.release_date?.date ||
    (game as { release_date?: string }).release_date ||
    null;
  // Tick mỗi 30s để tự cập nhật trạng thái khi game ra mắt mà không cần reload
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const isComingSoon = !isGameReleased(
    steamDetails?.release_date?.coming_soon,
    releaseDateStr
  );

  const handlePlay = async () => {
    setBusy(true);
    try {
      if (isComingSoon) {
        onMessage(
          "Game đang ở trạng thái Pre-order. Vui lòng chờ đến ngày phát hành.",
          "info"
        );
        return;
      }

      // ── 0: Kiểm tra tài khoản Steam đã liên kết chưa ───────────────────
      setStep("Đang kiểm tra tài khoản Steam...");
      try {
        const linked = await tauriAPI.steamLink.getLinkedAccount();
        if (linked.linked && linked.link) {
          // Có tài khoản đã liên kết → kiểm tra khớp
          const verifyRes = await tauriAPI.steamLink.verifyLinkedAccount();
          if (!verifyRes.verified) {
            if (verifyRes.reason === "mismatch") {
              onMessage(
                `Tài khoản Steam hiện tại không khớp với tài khoản đã liên kết. Vui lòng đăng nhập đúng tài khoản Steam đã liên kết (${linked.link.persona_name || linked.link.steam_id}).`,
                "error"
              );
              return;
            } else {
              onMessage(
                "Bạn chưa liên kết tài khoản Steam. Vui lòng liên kết Steam trong menu tài khoản trước khi chơi.",
                "error"
              );
              return;
            }
          }
        } else {
          // Chưa liên kết
          onMessage(
            "Bạn chưa liên kết tài khoản Steam. Vui lòng liên kết Steam trong menu tài khoản trước khi chơi.",
            "error"
          );
          return;
        }
      } catch (linkErr) {
        // Nếu lỗi kiểm tra link, vẫn cho phép chơi (để không block user)
        console.warn("Steam link check failed:", linkErr);
      }

      const ownedAppids = allOwnedGames
        .map((g) => String(g.appid || "").trim())
        .filter((id) => /^\d+$/.test(id));

      // DLC được user chọn (giao giữa ownedDlcIds và selectedDlcIds từ localStorage)
      const selectedDlcIds = loadSelectedDlcIds(appId).filter((id) =>
        ownedDlcIds.includes(id)
      );

      // ── 1: Đọc SteamPath ──────────────────────────────────────────────────
      setStep("Đang tìm Steam...");
      const pathRes = await tauriAPI.steamIntegration.getPath().catch(() => null);
      if (!pathRes?.success || !pathRes.steam_path) {
        onMessage("Không tìm thấy Steam trên máy. Vui lòng cài Steam trước.", "error");
        return;
      }
      const steamPath = pathRes.steam_path;

      // ── 2: Cài file tĩnh (DLL + steam.cfg) từ resource dir ───────────────
      setStep("Đang cài đặt file...");
      await tauriAPI.steamIntegration.installDll(steamPath).catch(() => null);

      // ── 3: Đảm bảo thư mục stplug-in ─────────────────────────────────────
      const folderRes = await tauriAPI.steamIntegration.ensureStpluginFolder(steamPath);
      const folderExisted = folderRes?.existed ?? false;

      // ── 4: Dọn lua game không sở hữu (giữ lại DLC đang dùng) ─────────────
      if (folderExisted) {
        const luaList = await tauriAPI.steamIntegration.listLuaFiles(steamPath).catch(() => ({ success: true, appids: [] as string[] }));
        for (const luaAppid of (luaList.appids ?? [])) {
          if (!ownedAppids.includes(luaAppid) && !selectedDlcIds.includes(luaAppid)) {
            await tauriAPI.steamIntegration.removeLuaFile(steamPath, luaAppid).catch(() => null);
          }
        }
      }

      // ── 5: Tải lua game nếu chưa có ──────────────────────────────────────
      const preCheck = await tauriAPI.steamIntegration.checkFiles(steamPath, appId);
      if (!preCheck.lua_ready) {
        setStep("Đang tải dữ liệu game...");
        const luaRes = await tauriAPI.steamIntegration.downloadLua(steamPath, appId);
        if (!luaRes?.success) {
          const status = luaRes?.status;
          if (status === 404) {
            onMessage("Không tìm thấy dữ liệu game trên server.", "error");
          } else {
            onMessage(`Lỗi tải dữ liệu game: ${luaRes?.reason ?? "unknown"}`, "error");
          }
          return;
        }
      }

      // ── 6: Tải lua DLC được chọn nếu chưa có ─────────────────────────────
      if (selectedDlcIds.length > 0) {
        setStep(`Đang tải dữ liệu DLC (${selectedDlcIds.length})...`);
        for (const dlcId of selectedDlcIds) {
          const dlcCheck = await tauriAPI.steamIntegration.checkFilesWithDlc(steamPath, appId, [dlcId]).catch(() => null);
          const dlcHasLua = dlcCheck?.missing?.every((f) => !f.endsWith(".lua") || f === `${appId}.lua`) ?? false;
          if (!dlcHasLua) {
            const dlcLuaRes = await tauriAPI.steamIntegration.downloadDlcLua(steamPath, appId, dlcId).catch(() => null);
            // 404 = server chưa có lua cho DLC này → bỏ qua
            if (dlcLuaRes && !dlcLuaRes.success && dlcLuaRes.status !== 404) {
              onMessage(`Lỗi tải DLC ${dlcId}: ${dlcLuaRes.reason ?? "unknown"}`, "warning");
            }
          }
        }
      }

      // ── 7: Kiểm tra ĐỦ FILE (DLL/cfg + lua game + lua DLC) ───────────────
      setStep("Đang kiểm tra file...");
      // Chỉ verify DLC nào đã tải thành công (bỏ qua DLC 404)
      const existingDlcLuas = await Promise.all(
        selectedDlcIds.map(async (id) => {
          const check = await tauriAPI.steamIntegration.checkFilesWithDlc(steamPath, appId, [id]).catch(() => null);
          return check?.missing?.includes(`${id}.lua`) === false ? id : null;
        })
      );
      const availableDlcIds = existingDlcLuas.filter((id): id is string => id !== null);

      const finalCheck = await tauriAPI.steamIntegration.checkFilesWithDlc(steamPath, appId, availableDlcIds);
      if (!finalCheck.ready) {
        const missing = finalCheck.missing ?? [];
        const missingStatic = missing.filter((f) => !f.endsWith(".lua"));
        if (missingStatic.length > 0) {
          onMessage(`Không thể cài file: ${missingStatic.join(", ")}. Vui lòng cài lại launcher.`, "error");
        } else {
          onMessage(`Thiếu file: ${missing.join(", ")}`, "error");
        }
        return;
      }

      // ── 8: Restart Steam (luôn luôn) ──────────────────────────────────────
      setStep("Đang khởi động lại Steam...");
      await tauriAPI.steamIntegration.restart(steamPath).catch(() => null);

      // ── 9: Chạy game qua steam://run ──────────────────────────────────────
      setStep("Đang khởi động game...");
      await tauriAPI.steamIntegration.runGame(appId);
      if (selectedDlcIds.length > 0) {
        if (availableDlcIds.length === selectedDlcIds.length) {
          onMessage(`Đang khởi động trò chơi với ${availableDlcIds.length} DLC...`, "success");
        } else if (availableDlcIds.length > 0) {
          onMessage(
            `Đang khởi động trò chơi với ${availableDlcIds.length}/${selectedDlcIds.length} DLC (${selectedDlcIds.length - availableDlcIds.length} DLC chưa có dữ liệu trên server)...`,
            "warning"
          );
        } else {
          onMessage(
            `Đang khởi động trò chơi (server chưa có dữ liệu cho ${selectedDlcIds.length} DLC bạn chọn)...`,
            "warning"
          );
        }
      } else {
        onMessage("Đang khởi động trò chơi...", "success");
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onMessage("Lỗi: " + msg, "error");
    } finally {
      setBusy(false);
      setStep("");
    }
  };

  return (
    <button
      className="play-btn"
      disabled={busy || (isComingSoon && true)}
      onClick={handlePlay}
    >
      {busy
        ? (step || "ĐANG XỬ LÝ...")
        : isComingSoon
        ? "Chưa ra mắt"
        : "Chơi ngay"}
    </button>
  );
}

// ─── Sub: Activate (Game Fix) button ────────────────────────────────────────

interface ActivateButtonProps {
  game: OwnedGame;
  onMessage: (msg: string, type: "success" | "error" | "warning" | "info") => void;
}

function ActivateButton({ game, onMessage }: ActivateButtonProps) {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");

  const appId = String(game.appid || "").trim();
  const fixFolderName = String((game as Record<string, unknown>).fix_folder_name || "").trim();
  const fixExeName = String((game as Record<string, unknown>).fix_exe_name || "").trim();
  const fixDllNameRaw = String((game as Record<string, unknown>).fix_dll_name || "").trim();
  const fixDllName = fixDllNameRaw || "steam_api64.dll";
  const fixZipUrl = String((game as Record<string, unknown>).fix_zip_url || "").trim();

  const isConfigured = !!(appId && fixFolderName && fixExeName && fixZipUrl);

  // Ẩn hoàn toàn nút nếu chưa cấu hình — không hiện toast cảnh báo
  if (!isConfigured) return null;

  const askUserForFolder = async (defaultPath?: string): Promise<string | null> => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const result = await open({
        directory: true,
        multiple: false,
        title: `Chọn folder cài đặt của ${game.name || appId}`,
        defaultPath,
      });
      if (typeof result === "string") return result;
      return null;
    } catch (e) {
      console.error("[Activate] open dialog error:", e);
      return null;
    }
  };

  const runActivate = async (gamePath: string) => {
    setStep("Đang tải file kích hoạt...");
    const res = await tauriAPI.gameFix.activate({
      appid: appId,
      fixZipUrl,
      fixExeName,
      fixDllName,
      gamePath,
    });
    if (!res?.success) {
      onMessage(res?.message || "Kích hoạt thất bại", "error");
      return;
    }
    onMessage(res.message || "Đã kích hoạt thành công!", "success");
  };

  const handleActivate = async () => {
    setBusy(true);
    try {
      // 1. Precheck — auto dò SteamPath\steamapps\common\<folder>
      setStep("Đang kiểm tra Steam...");
      const pre = await tauriAPI.gameFix.precheck({
        appid: appId,
        fixFolderName,
        fixExeName,
        fixDllName,
      });

      // Lỗi không thể tiếp tục (không có Steam, hoặc thiếu config)
      if (!pre?.success && pre?.reason === "no_steam") {
        onMessage(pre.message || "Không tìm thấy Steam trên máy.", "error");
        return;
      }
      if (!pre?.success && pre?.reason === "config_missing") {
        onMessage(pre.message || "Game chưa được cấu hình", "error");
        return;
      }

      // 2. Nếu auto OK → activate luôn
      if (pre.ready && pre.game_path) {
        await runActivate(pre.game_path);
        return;
      }

      // 3. Auto-dò fail (không tìm thấy folder, thiếu file, hoặc thiếu manifest)
      //    → luôn mở dialog cho user chọn folder thủ công
      onMessage(
        pre.message || "Không tự dò được folder cài đặt. Vui lòng chọn folder thủ công.",
        "info"
      );
      const defaultPath = pre.steam_path
        ? `${pre.steam_path}\\steamapps\\common`
        : undefined;
      const chosen = await askUserForFolder(defaultPath);
      if (!chosen) {
        onMessage("Đã hủy chọn folder.", "info");
        return;
      }

      // 4. Verify folder do user chọn (kiểm tra cả file game và appmanifest)
      setStep("Đang kiểm tra folder...");
      const verify = await tauriAPI.gameFix.verifyPath({
        appid: appId,
        fixExeName,
        fixDllName,
        chosenPath: chosen,
      });
      if (!verify?.success || !verify.game_path) {
        onMessage(
          verify?.message || `Folder không hợp lệ — thiếu file game hoặc appmanifest_${appId}.acf.`,
          "error"
        );
        return;
      }

      // 5. Activate trên folder user chọn
      await runActivate(verify.game_path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onMessage("Lỗi: " + msg, "error");
    } finally {
      setBusy(false);
      setStep("");
    }
  };

  return (
    <button
      type="button"
      className="activate-btn"
      onClick={handleActivate}
      disabled={busy}
      title="Tự động cài file bypass vào folder game"
    >
      {busy ? (step || "ĐANG KÍCH HOẠT...") : "⚡ Kích hoạt"}
    </button>
  );
}

// ─── Sub: DLC floating panel ────────────────────────────────────────────────

interface DlcBoxProps {
  appId: string;
  ownedDlcIds: string[];
  loadSelected: (appId: string) => string[];
  saveSelected: (appId: string, ids: string[]) => void;
  onMessage: (msg: string, type: "success" | "error" | "warning" | "info") => void;
  onClose: () => void;
}

function DlcBox({
  appId,
  ownedDlcIds,
  loadSelected,
  saveSelected,
  onMessage,
  onClose,
}: DlcBoxProps) {
  const [loading, setLoading] = useState(true);
  const [dlcDetails, setDlcDetails] = useState<{ id: string; name: string; img: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(loadSelected(appId))
  );

  // Load DLC details on mount: ưu tiên DB, fallback Steam batch API
  useEffect(() => {
    if (ownedDlcIds.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      // Fetch DB + Steam batch in parallel
      const [dbRes, steamBatchRes] = await Promise.all([
        tauriAPI.dlc.listForBasegame(appId).catch(() => ({ success: true, data: [] as DlcItem[] })),
        tauriAPI.steam.getAppsBatch(ownedDlcIds).catch(() => ({ success: false, apps: [] })),
      ]);
      if (cancelled) return;

      const dbMap = new Map<string, DlcItem>(
        (dbRes.data ?? []).map((d) => [String(d.appid || ""), d])
      );
      const steamMap = new Map<string, { name: string; header_image: string }>(
        (steamBatchRes.apps ?? []).map((app) => [
          String(app.appid || ""),
          { name: app.name || "", header_image: app.header_image || "" },
        ])
      );

      const details = ownedDlcIds.map((id) => {
        const dbItem = dbMap.get(id);
        const steamData = steamMap.get(id);
        return {
          id,
          name: dbItem?.name || steamData?.name || `DLC ${id}`,
          img: (dbItem?.custom_image as string)
            || (dbItem?.header_image as string)
            || steamData?.header_image
            || steamAppAssetUrl(id, "header.jpg"),
        };
      });
      setDlcDetails(details);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [appId, ownedDlcIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleOk = () => {
    saveSelected(appId, Array.from(selected));
    onMessage("Đã lưu lựa chọn DLC.", "success");
    onClose();
  };

  return (
    <div className="dlc-floating-box">
      <div className="dlc-box-header">
        <div className="dlc-box-title">DLCs đã mua</div>
        <button type="button" className="dlc-box-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="dlc-box-body">
        {loading ? (
          <div className="dlc-box-loading">Đang tải…</div>
        ) : (
          dlcDetails.map((d) => (
            <label key={d.id} className="dlc-box-item">
              <input
                type="checkbox"
                checked={selected.has(d.id)}
                onChange={() => toggle(d.id)}
              />
              <img
                className="dlc-box-img"
                src={d.img}
                alt={d.name}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = DEFAULT_STEAM_BACKGROUND_URL;
                }}
              />
              <span className="dlc-box-name">{d.name}</span>
            </label>
          ))
        )}
      </div>
      <div className="dlc-box-actions">
        <button type="button" className="dlc-box-ok" onClick={handleOk}>
          OK
        </button>
      </div>
    </div>
  );
}

// ─── Sub: Game detail panel ─────────────────────────────────────────────────

interface GameDetailPanelProps {
  game: OwnedGame;
  allOwnedGames: OwnedGame[];
  steamDetails: SteamAppDetails | null;
  loadingDetail: boolean;
  ownedDlcIds: string[];
  loadSelectedDlcIds: (appId: string) => string[];
  saveSelectedDlcIds: (appId: string, ids: string[]) => void;
  onMessage: (msg: string, type: "success" | "error" | "warning" | "info") => void;
  getGameHero: (appId: string | number | undefined | null) => string;
  onGoToStore?: (appid: string) => void;
}

function GameDetailPanel({
  game,
  allOwnedGames,
  steamDetails,
  loadingDetail,
  ownedDlcIds,
  loadSelectedDlcIds,
  saveSelectedDlcIds,
  onMessage,
  getGameHero,
  onGoToStore,
}: GameDetailPanelProps) {
  const [showDlcBox, setShowDlcBox] = useState(false);
  const appId = String(game.appid || "").trim();
  const gameId = String(game.id || "");

  // ── Library Review state ──────────────────────────────────
  const [libReview, setLibReview] = useState<{ recommended: boolean } | null | "loading">("loading");
  const [libReviewChoice, setLibReviewChoice] = useState<boolean | null>(null);
  const [libReviewText, setLibReviewText] = useState("");
  const [libSubmitting, setLibSubmitting] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    setLibReview("loading");
    setLibReviewChoice(null);
    setLibReviewText("");
    tauriAPI.reviews.my(gameId).then(res => {
      if (res.success && res.data) setLibReview({ recommended: res.data.recommended });
      else setLibReview(null);
    }).catch(() => setLibReview(null));
  }, [gameId]);

  const handleLibReviewSubmit = async () => {
    if (!gameId || libReviewChoice === null) return;
    setLibSubmitting(true);
    try {
      await tauriAPI.reviews.submit({ gameId, recommended: libReviewChoice, content: libReviewText.trim() || undefined });
      setLibReview({ recommended: libReviewChoice });
      onMessage("Đã gửi đánh giá!", "success");
    } catch (e) {
      onMessage(typeof e === "string" ? e : "Lỗi gửi đánh giá", "error");
    } finally {
      setLibSubmitting(false);
    }
  };
  const name = steamDetails?.name || game.name || `Game ${appId}`;
  // Ảnh custom của admin > banner thư viện (DB/Steam)
  const banner = (game.custom_image as string) || getGameHero(appId);
  const fallback =
    (steamDetails?.background as string) ||
    steamAppAssetUrl(appId, "header.jpg");
  const shortDesc = String(steamDetails?.short_description || "").trim();
  const developers = Array.isArray(steamDetails?.developers)
    ? steamDetails.developers
    : [];
  const publishers = Array.isArray(steamDetails?.publishers)
    ? steamDetails.publishers
    : [];
  const releaseDate = steamDetails?.release_date?.date || "TBA";

  if (loadingDetail) {
    return (
      <div style={{ padding: "100px", textAlign: "center", color: "#8f98a0" }}>
        Đang tải...
      </div>
    );
  }

  return (
    <div
      className="library-main-content bg-fade"
      style={
        {
          "--library-bg": fallback
            ? `linear-gradient(180deg, rgba(11,14,20,0.66), rgba(11,14,20,0.9)), url("${fallback}") center/cover no-repeat fixed`
            : undefined,
        } as React.CSSProperties
      }
    >
      {/* Hero */}
      <div className="library-hero">
        <img
          src={banner}
          className="hero-banner"
          alt={name}
          onError={(e) => {
            (e.target as HTMLImageElement).src = fallback;
          }}
          loading="lazy"
        />
        <div className="hero-overlay">
          <div className="hero-game-title">{name}</div>
        </div>
      </div>

      {/* Action bar */}
      <div className="library-action-bar">
        <PlayButton
          game={game}
          allOwnedGames={allOwnedGames}
          steamDetails={steamDetails}
          ownedDlcIds={ownedDlcIds}
          loadSelectedDlcIds={loadSelectedDlcIds}
          onMessage={onMessage}
        />
        <ActivateButton game={game} onMessage={onMessage} />
        {ownedDlcIds.length > 0 && (
          <button
            type="button"
            className="dlc-btn"
            onClick={() => setShowDlcBox((v) => !v)}
          >
            DLC đã mua ({ownedDlcIds.length})
          </button>
        )}
        <div className="library-action-links">
          <button
            type="button"
            className="lib-link-btn"
            onClick={() => onGoToStore?.(appId)}
            title="Trang cửa hàng"
          >
            🛒 Store
          </button>
          <button
            type="button"
            className="lib-link-btn"
            onClick={() => tauriAPI.app.openExternal(`https://steamcommunity.com/app/${appId}/discussions`)}
            title="Thảo luận"
          >
            💬 Discussion
          </button>
          <button
            type="button"
            className="lib-link-btn"
            onClick={() => tauriAPI.app.openExternal(`https://steamcommunity.com/app/${appId}`)}
            title="Community Hub"
          >
            👥 Community
          </button>
          <button
            type="button"
            className="lib-link-btn"
            onClick={() => tauriAPI.app.openExternal(`https://steamcommunity.com/app/${appId}/guides`)}
            title="Hướng dẫn"
          >
            📖 Guides
          </button>
        </div>
      </div>

      {/* Library Review Box */}
      {libReview !== "loading" && (
        <div style={{ padding: "0 28px", marginBottom: 16 }}>
          {libReview === null ? (
            <div style={{ background: "rgba(22,27,34,0.7)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 10 }}>
                Bạn nghĩ gì về game này?
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => setLibReviewChoice(true)}
                  disabled={libSubmitting}
                  style={{
                    flex: 1, padding: "9px 12px", border: "1px solid",
                    borderColor: libReviewChoice === true ? "#4ade80" : "rgba(255,255,255,0.12)",
                    background: libReviewChoice === true ? "rgba(74,222,128,0.15)" : "rgba(0,0,0,0.2)",
                    borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    color: libReviewChoice === true ? "#4ade80" : "#c7d5e0", fontWeight: 600, fontSize: 12,
                    transition: "all 0.15s",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={libReviewChoice === true ? "#4ade80" : "currentColor"}><path d="M2 21h4V9H2v12zm20.29-11.29a1 1 0 0 0-.83-.42H15V5a3 3 0 0 0-3-3l-1 5-3 4v10h10.46a2 2 0 0 0 1.94-1.5l1.6-7a2 2 0 0 0-.31-1.71z"/></svg>
                  Recommend
                </button>
                <button
                  type="button"
                  onClick={() => setLibReviewChoice(false)}
                  disabled={libSubmitting}
                  style={{
                    flex: 1, padding: "9px 12px", border: "1px solid",
                    borderColor: libReviewChoice === false ? "#f87171" : "rgba(255,255,255,0.12)",
                    background: libReviewChoice === false ? "rgba(248,113,113,0.15)" : "rgba(0,0,0,0.2)",
                    borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    color: libReviewChoice === false ? "#f87171" : "#c7d5e0", fontWeight: 600, fontSize: 12,
                    transition: "all 0.15s",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={libReviewChoice === false ? "#f87171" : "currentColor"}><path d="M22 3h-4v12h4V3zM1.71 14.29a1 1 0 0 0 .83.42H9v4.29a3 3 0 0 0 3 3l1-5 3-4V3H5.54a2 2 0 0 0-1.94 1.5l-1.6 7a2 2 0 0 0 .31 1.71z"/></svg>
                  Not Recommend
                </button>
              </div>
              <textarea
                value={libReviewText}
                onChange={(e) => setLibReviewText(e.target.value)}
                placeholder="Viết nhận xét (không bắt buộc)..."
                maxLength={500}
                style={{
                  width: "100%", minHeight: 50, resize: "vertical",
                  background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6, padding: "8px 10px", color: "#c7d5e0", fontSize: 12,
                  outline: "none", fontFamily: "inherit",
                }}
              />
              <button
                type="button"
                onClick={handleLibReviewSubmit}
                disabled={libSubmitting || libReviewChoice === null}
                style={{
                  marginTop: 8, width: "100%", padding: "9px",
                  background: libReviewChoice === null ? "rgba(255,255,255,0.05)" : "rgba(59,130,246,0.8)",
                  border: "none", borderRadius: 6, cursor: libReviewChoice === null ? "not-allowed" : "pointer",
                  color: "#fff", fontWeight: 700, fontSize: 12, opacity: libReviewChoice === null ? 0.5 : 1,
                }}
              >
                {libSubmitting ? "Đang gửi..." : "Đăng đánh giá"}
              </button>
            </div>
          ) : (
            <div style={{ background: "rgba(22,27,34,0.7)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 10, padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 6, color: "#4ade80" }}>✓</div>
              <div style={{ color: "#c7d5e0", fontSize: 12, lineHeight: 1.6 }}>
                Cảm ơn vì đánh giá của bạn, đánh giá của bạn đã được ghi nhận
              </div>
            </div>
          )}
        </div>
      )}

      {/* Details grid */}
      <div className="library-details-grid">
        {/* Main col */}
        <div className="main-col">
          <h4 className="library-section-title">Giới thiệu</h4>
          <div
            style={{
              background: "rgba(0,0,0,0.2)",
              padding: 20,
              borderRadius: 4,
              color: "#acb2b8",
              lineHeight: 1.6,
              fontSize: 13,
            }}
          >
            {shortDesc || "Không có mô tả."}
          </div>
        </div>

        {/* Side col */}
        <div className="side-col">
          <h4 className="library-section-title">Thông tin</h4>
          <div
            style={{
              background: "rgba(0,0,0,0.2)",
              padding: 20,
              borderRadius: 4,
            }}
          >
            <div style={{ marginBottom: 15 }}>
              <div className="stat-label">Nhà phát triển</div>
              <div className="stat-value" style={{ color: "#66c0f4" }}>
                {developers.length > 0 ? developers.join(", ") : "N/A"}
              </div>
            </div>
            <div style={{ marginBottom: 15 }}>
              <div className="stat-label">Nhà phát hành</div>
              <div className="stat-value" style={{ color: "#66c0f4" }}>
                {publishers.length > 0 ? publishers.join(", ") : "N/A"}
              </div>
            </div>
            <div>
              <div className="stat-label">Ngày phát hành</div>
              <div className="stat-value">{releaseDate}</div>
            </div>
          </div>
        </div>
      </div>

      {/* DLC floating box */}
      {showDlcBox && (
        <DlcBox
          appId={appId}
          ownedDlcIds={ownedDlcIds}
          loadSelected={loadSelectedDlcIds}
          saveSelected={saveSelectedDlcIds}
          onMessage={onMessage}
          onClose={() => setShowDlcBox(false)}
        />
      )}
    </div>
  );
}

// ─── Sub: Empty state ───────────────────────────────────────────────────────

function EmptyContent() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#8f98a0" }}>
      <div style={{ fontSize: 64, marginBottom: 20, opacity: 0.2 }}>🎮</div>
      <h3 style={{ color: "#fff", marginBottom: 10 }}>Bạn chưa có game nào</h3>
      <p>Mua game tại Cửa hàng để bắt đầu trải nghiệm.</p>
    </div>
  );
}

// ─── Sub: Toast ─────────────────────────────────────────────────────────────

interface ToastMsg {
  id: number;
  msg: string;
  type: "success" | "error" | "warning" | "info";
}

// ─── Main LibraryPage ────────────────────────────────────────────────────────

export function LibraryPage({ focusAppId, onSelectGame, onGoToStore }: LibraryPageProps) {
  const {
    searchTerm,
    setSearchTerm,
    filteredGames,
    games,
    selectedGame,
    steamDetails,
    ownedDlcIds,
    loadingList,
    loadingDetail,
    listError,
    loadSelectedDlcIds,
    saveSelectedDlcIds,
    getGameImage,
    getGameHero,
    loadGameDetail,
  } = useLibrary(focusAppId);

  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  let toastCounter = 0;

  // Cuộn sidebar tới game đang chọn (khi vào từ trang detail "Chơi ngay")
  const activeItemRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedGame]);

  const showToast = (
    msg: string,
    type: "success" | "error" | "warning" | "info"
  ) => {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  const handleSelectGame = (g: OwnedGame) => {
    loadGameDetail(g);
    onSelectGame?.(String(g.appid || "").trim());
  };

  const renderContent = () => {
    if (filteredGames.length === 0 && !loadingList) {
      return <EmptyContent />;
    }
    if (!selectedGame) {
      return (
        <div style={{ padding: "100px", textAlign: "center", color: "#8f98a0" }}>
          Chọn game để xem chi tiết.
        </div>
      );
    }
    return (
      <GameDetailPanel
        game={selectedGame}
        allOwnedGames={games}
        steamDetails={steamDetails}
        loadingDetail={loadingDetail}
        ownedDlcIds={ownedDlcIds}
        loadSelectedDlcIds={loadSelectedDlcIds}
        saveSelectedDlcIds={saveSelectedDlcIds}
        onMessage={showToast}
        getGameHero={getGameHero}
        onGoToStore={onGoToStore}
      />
    );
  };

  return (
    <div className="library-layout">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <div className="library-sidebar">
        <div className="sidebar-header">
          <input
            type="text"
            className="library-search"
            placeholder="Tìm trong thư viện..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="sidebar-game-list">
          {loadingList && (
            <div className="loading-msg" style={{ padding: 20, textAlign: "center", color: "#8f98a0", fontSize: 12 }}>
              Đang tải...
            </div>
          )}
          {listError && <div style={{ padding: 20, color: "red", fontSize: 11 }}>{listError}</div>}

          {!loadingList && filteredGames.map((g) => {
            const appid = String(g.appid || "").trim();
            const isActive = selectedGame && String(selectedGame.appid) === String(g.appid);
            return (
              <div
                key={String(g.id || appid)}
                ref={isActive ? activeItemRef : undefined}
                className={`sidebar-game-item${isActive ? " active" : ""}`}
                onClick={() => handleSelectGame(g)}
              >
                <img
                  className="sidebar-game-logo"
                  src={getGameImage(appid)}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_STEAM_BACKGROUND_URL; }}
                />
                <span className="sidebar-game-name">{g.name || `Game ${appid}`}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div className="library-content-box">
        {renderContent()}
      </div>

      {/* ── Toasts ───────────────────────────────────────────────────── */}
      <div
        id="toast-container"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.type}`}
            role="status"
            aria-live={t.type === "error" ? "assertive" : "polite"}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
