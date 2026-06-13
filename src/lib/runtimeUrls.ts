// ============================================================
// Runtime URL helpers (ported from src/js/runtimeUrls.js)
// Encoded base URLs are XOR'd against a runtime key to avoid
// plain-text secrets in the bundle.
// ============================================================

const RUNTIME_KEY = "Nyvexa-runtime-v1";

function decodeSecureText(encoded: string): string {
  const binary = window.atob(String(encoded || ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const key = Uint8Array.from(RUNTIME_KEY, (char) => char.charCodeAt(0));
  if (!bytes.length || !key.length) return "";
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = bytes[i] ^ key[i % key.length];
  }
  return new TextDecoder().decode(bytes);
}

function httpsFromHost(encodedHost: string): string {
  return `https://${decodeSecureText(encodedHost)}`;
}

const STEAM_CDN_BASE = httpsFromHost("DQEdWgRBHQAKEgUMF0hYQhoAEhkUWRMBBxdHDgpA");
const STEAM_COMMUNITY_BASE = httpsFromHost(
  "DQoeGRJDGwEXWgoBClgSVwIEARFJXgYQDxkaGQRZH1JABhwZ"
);
const STEAM_AKAMAI_BASE = httpsFromHost("HREWFQpOFhtDFUcMDkwbUAcNF1oJSAY=");
const PHIM_API_BASE = httpsFromHost("Hg0aGQZdG1sNGwQ=");
const PHIM_IMG_BASE = httpsFromHost("Hg0aGQ5AFVsNGwQ=");

export const DEFAULT_STEAM_BACKGROUND_URL = `${STEAM_COMMUNITY_BASE}/public/images/applications/store/default_app_background.jpg`;

function normalizeAppId(appId: string | number | undefined | null): string {
  const value = String(appId || "").trim();
  return /^\d+$/.test(value) ? value : "";
}

export function steamAppAssetUrl(
  appId: string | number | undefined | null,
  assetPath: string,
  options: { akamai?: boolean } = {}
): string {
  const id = normalizeAppId(appId);
  const asset = String(assetPath || "")
    .trim()
    .replace(/^\/+/, "");
  if (!id || !asset) return "";
  const base = options.akamai ? STEAM_AKAMAI_BASE : STEAM_CDN_BASE;
  return `${base}/steam/apps/${id}/${asset}`;
}

export function movieApiUrl(pathname = ""): string {
  const safePath = String(pathname || "")
    .trim()
    .replace(/^\/+/, "");
  return safePath ? `${PHIM_API_BASE}/${safePath}` : PHIM_API_BASE;
}

export function movieImageUrl(raw: string | undefined | null): string {
  const src = String(raw || "").trim();
  if (!src) return "";
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("//")) return `https:${src}`;
  const normalized = src.replace(/^\/+/, "");
  if (normalized.startsWith("upload/"))
    return `${PHIM_IMG_BASE}/${normalized}`;
  return `${PHIM_API_BASE}/${normalized}`;
}

export {
  STEAM_CDN_BASE,
  STEAM_COMMUNITY_BASE,
  STEAM_AKAMAI_BASE,
  PHIM_API_BASE,
  PHIM_IMG_BASE,
};
