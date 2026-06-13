-- Bảng lưu trữ các giao dịch nạp tiền
CREATE TABLE IF NOT EXISTS deposits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL,
  order_code BIGINT UNIQUE NOT NULL,
  status TEXT DEFAULT 'PENDING', -- PENDING, PAID, CANCELLED
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bật RLS
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;

-- Policy: User chỉ thấy giao dịch của chính mình
CREATE POLICY "Users can view own deposits" ON deposits
  FOR SELECT USING (auth.uid() = user_id);

-- Cho phép hệ thống (service role) cập nhật trạng thái
-- Trong thực tế, Webhook sẽ gọi qua một Edge Function dùng service_role