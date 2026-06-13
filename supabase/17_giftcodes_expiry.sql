-- Thêm cột expires_at vào bảng giftcodes
ALTER TABLE public.giftcodes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

-- Cập nhật RLS nếu cần (thường đã có từ trước)