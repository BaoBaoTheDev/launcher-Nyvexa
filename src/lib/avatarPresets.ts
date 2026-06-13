export interface AvatarPreset {
  url: string;
  label?: string;
}

// Legacy — sẽ không dùng nữa (avatar giờ từ DB)
export const AVATAR_PRESETS: AvatarPreset[] = [];
