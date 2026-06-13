/**
 * Validate mật khẩu:
 *   - >8 ký tự
 *   - Có chữ viết hoa
 *   - Có chữ viết thường
 *   - Có số
 *   - Có ký tự đặc biệt
 */
export function validatePassword(pw: string): { valid: boolean; message: string } {
  if (pw.length < 8) return { valid: false, message: "Mật khẩu phải có ít nhất 8 ký tự" };
  if (!/[A-Z]/.test(pw)) return { valid: false, message: "Mật khẩu phải có ít nhất 1 chữ viết hoa" };
  if (!/[a-z]/.test(pw)) return { valid: false, message: "Mật khẩu phải có ít nhất 1 chữ viết thường" };
  if (!/[0-9]/.test(pw)) return { valid: false, message: "Mật khẩu phải có ít nhất 1 số" };
  if (!/[^A-Za-z0-9]/.test(pw)) return { valid: false, message: "Mật khẩu phải có ít nhất 1 ký tự đặc biệt (!@#$%...)" };
  return { valid: true, message: "" };
}

/**
 * Trả về trạng thái từng yêu cầu mật khẩu để render checklist trong UI.
 * Tất cả khi `passed = false` sẽ hiển thị màu đỏ, chuyển xanh lá khi đáp ứng.
 */
export interface PasswordRule {
  key: string;
  label: string;
  passed: boolean;
}

export function getPasswordRules(pw: string): PasswordRule[] {
  return [
    { key: "len", label: "Ít nhất 8 ký tự", passed: pw.length >= 8 },
    { key: "upper", label: "Có chữ viết HOA (A-Z)", passed: /[A-Z]/.test(pw) },
    { key: "lower", label: "Có chữ viết thường (a-z)", passed: /[a-z]/.test(pw) },
    { key: "digit", label: "Có chữ số (0-9)", passed: /[0-9]/.test(pw) },
    { key: "special", label: "Có ký tự đặc biệt (!@#$%...)", passed: /[^A-Za-z0-9]/.test(pw) },
  ];
}

export function isPasswordStrong(pw: string): boolean {
  return getPasswordRules(pw).every((r) => r.passed);
}
