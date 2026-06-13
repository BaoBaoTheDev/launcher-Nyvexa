-- Tạo bảng lưu mã OTP
CREATE TABLE IF NOT EXISTS public.custom_otps (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tạo index để tìm kiếm nhanh hơn
CREATE INDEX IF NOT EXISTS idx_custom_otps_email ON public.custom_otps(email);

-- Bật RLS nhưng không cần tạo policy vì chúng ta dùng Service Role từ Backend
ALTER TABLE public.custom_otps ENABLE ROW LEVEL SECURITY;