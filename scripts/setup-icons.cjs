/**
 * Pre-build script: copy icon.ico → src-tauri/icons/ cho Tauri bundler.
 * Tìm icon ở: launcher-tauri/icon.ico (ưu tiên) → folder cha (../../icon.ico).
 */
const fs = require("fs");
const path = require("path");

const candidates = [
  path.resolve(__dirname, "..", "icon.ico"),          // launcher-tauri/icon.ico (độc lập)
  path.resolve(__dirname, "..", "..", "icon.ico"),    // folder cha launcher/icon.ico (legacy)
  path.resolve(__dirname, "..", "src-tauri", "icons", "icon.ico"), // đã có sẵn
];

const iconSrc = candidates.find((p) => fs.existsSync(p));
const iconDir = path.resolve(__dirname, "..", "src-tauri", "icons");
const iconDst = path.join(iconDir, "icon.ico");

if (!iconSrc) {
  console.error("[setup-icons] Không tìm thấy icon.ico ở:", candidates.join(", "));
  process.exit(1);
}

fs.mkdirSync(iconDir, { recursive: true });
// Tránh copy đè lên chính nó
if (path.resolve(iconSrc) !== path.resolve(iconDst)) {
  fs.copyFileSync(iconSrc, iconDst);
}
console.log("[setup-icons] Icon OK ->", iconDst);
