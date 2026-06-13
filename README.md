# NestG Launcher (Tauri + React)

Bản Tauri của NestG Launcher — Giai đoạn 1: Auth MVP.

## Yêu cầu

- Node.js 20+
- Rust stable + cargo
- Windows 10+ (target chính)

## Cấu hình

```bash
cp .env.example .env
# Hoặc copy .env từ thư mục Electron gốc (../.env)
```

Biến bắt buộc:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (đăng ký, reset mật khẩu admin)

## Chạy dev

```bash
npm install
npm run tauri:dev
```

Icon app dùng [`../icon.ico`](../icon.ico) (cùng file với bản Electron). Script `setup:icons` tự copy vào `src-tauri/icons/` trước mỗi lần chạy/build.

## Build

```bash
npm run tauri build
```

## Kiến trúc

- `src/` — React + TypeScript frontend
- `src/lib/tauri-api.ts` — wrapper mirror `preload.js` (Electron)
- `src-tauri/src/services/` — Supabase, env, crypto, device
- `src-tauri/src/commands/` — Tauri commands (auth, app)

## Test plan (Giai đoạn 1)

```bash
# Rust unit tests (crypto/TOTP/env)
cd src-tauri && cargo test

# Frontend typecheck + build
npm run build
```

Checklist thủ công:

- [ ] Login email/password
- [ ] Account picker lưu/xóa tài khoản local
- [ ] Đăng ký + OTP 5 ký tự
- [ ] Quên mật khẩu + OTP + đổi mật khẩu
- [ ] Session persist sau restart app
- [ ] Đăng xuất + redirect `/login`
- [ ] Tài khoản bị ban hiển thị màn hình banned

## Giai đoạn tiếp theo

Xem kế hoạch migration trong repo gốc — Store, Steam, Wallet, Market, Admin.
