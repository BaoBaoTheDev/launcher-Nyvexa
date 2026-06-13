-- Thêm cột is_banned vào bảng profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;

-- Cập nhật RLS để admin có thể sửa cột này (thường đã có policy admin manage profiles)