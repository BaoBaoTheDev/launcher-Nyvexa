import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { installElectronAPIBridge } from "./lib/tauri-api";
import "./styles/base.css";
import "./styles/auth.css";

installElectronAPIBridge();

// ─── Chặn DevTools / context menu / select toàn cục ─────────────────────────
//
// Lưu ý: chỉ áp dụng trong production. Ở dev (npm run tauri:dev) thì giữ nguyên
// để debug dễ. Vite expose import.meta.env.DEV.
if (!import.meta.env.DEV) {
  // Block right-click
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // Block F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U (view source),
  // Ctrl+S (save), Ctrl+P (print)
  document.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;

    // F12
    if (e.key === "F12") { e.preventDefault(); return; }
    // Ctrl+Shift+I/J/C
    if (ctrl && shift && (key === "i" || key === "j" || key === "c")) {
      e.preventDefault();
      return;
    }
    // Ctrl+U (view source)
    if (ctrl && key === "u") { e.preventDefault(); return; }
    // Ctrl+S, Ctrl+P
    if (ctrl && (key === "s" || key === "p")) { e.preventDefault(); return; }
  });

  // Block selection bằng JS (đã có CSS, thêm event để chắc chắn)
  document.addEventListener("selectstart", (e) => {
    const target = e.target as HTMLElement | null;
    // Cho phép select trong input/textarea/contenteditable
    const tag = target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
    e.preventDefault();
  });

  // Block drag ảnh (nhưng cho phép drag có data-draggable)
  document.addEventListener("dragstart", (e) => {
    const target = e.target as HTMLElement;
    const tag = target?.tagName?.toLowerCase();
    if (target?.getAttribute("draggable") === "true") return; // cho phép drag row admin
    if (target?.closest("[draggable=true]")) return; // child element của draggable row
    if (tag === "img" || tag === "a") e.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
