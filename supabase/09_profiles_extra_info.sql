-- Bổ sung các cột thông tin hồ sơ còn thiếu
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS avatar_url TEXT,
ADD COLUMN IF NOT EXISTS summary TEXT,
ADD COLUMN IF NOT EXISTS frame_url TEXT;

-- Cập nhật RLS để đảm bảo user có thể sửa các cột mới này
-- (Thường policy cũ đã cho phép sửa toàn bộ row, nhưng chạy lại cho chắc chắn)
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" 
ON public.profiles FOR UPDATE 
USING (auth.uid() = id);