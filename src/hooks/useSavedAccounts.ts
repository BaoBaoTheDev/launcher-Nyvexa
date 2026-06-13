export interface SavedAccount {
  id: string;
  email: string;
  password: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  lastUsedAt: number;
}

const SAVED_ACCOUNTS_KEY = "savedAccounts";
const LEGACY_EMAIL_KEY = "savedEmail";
const LEGACY_PASSWORD_KEY = "savedPassword";
const LEGACY_REMEMBER_KEY = "rememberMe";

function normalizeAccount(account: Partial<SavedAccount>): SavedAccount | null {
  const email = String(account.email || "").trim().toLowerCase();
  const password = String(account.password || "");
  if (!email || !password) return null;
  return {
    id: account.id ? String(account.id) : "",
    email,
    password,
    displayName: String(account.displayName || account.username || "").trim(),
    username: String(account.username || "").trim(),
    avatarUrl: String(account.avatarUrl || "").trim(),
    lastUsedAt: Number(account.lastUsedAt || Date.now()),
  };
}

export function migrateLegacyRememberData() {
  const rememberMe = localStorage.getItem(LEGACY_REMEMBER_KEY) === "true";
  const savedEmail = String(localStorage.getItem(LEGACY_EMAIL_KEY) || "").trim().toLowerCase();
  const savedPassword = String(localStorage.getItem(LEGACY_PASSWORD_KEY) || "");
  if (!rememberMe || !savedEmail || !savedPassword) return;
  const accounts = readSavedAccounts();
  if (!accounts.some((a) => a.email === savedEmail)) {
    upsertSavedAccount({
      email: savedEmail,
      password: savedPassword,
      displayName: savedEmail,
      username: savedEmail.split("@")[0],
      avatarUrl: "",
    });
  }
}

export function readSavedAccounts(): SavedAccount[] {
  try {
    const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeAccount(item))
      .filter((item): item is SavedAccount => !!item)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  } catch {
    return [];
  }
}

export function writeSavedAccounts(accounts: SavedAccount[]) {
  localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function upsertSavedAccount(account: Partial<SavedAccount>) {
  const normalized = normalizeAccount(account);
  if (!normalized) return;
  const existing = readSavedAccounts().filter((item) => item.email !== normalized.email);
  writeSavedAccounts([normalized, ...existing].slice(0, 12));
}

export function removeSavedAccount(email: string) {
  const target = email.trim().toLowerCase();
  writeSavedAccounts(readSavedAccounts().filter((item) => item.email !== target));
}

export function createDefaultAvatarDataUrl(seedText = "N"): string {
  const text = String(seedText || "N").trim().slice(0, 1).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#66c0f4"/><stop offset="100%" stop-color="#1b2838"/></linearGradient></defs><rect width="256" height="256" fill="url(#g)"/><text x="50%" y="50%" dy="0.35em" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="120" font-weight="700">${text}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
