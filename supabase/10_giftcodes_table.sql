-- Bảng lưu mã quà tặng
CREATE TABLE giftcodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER NOT NULL DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bật RLS
ALTER TABLE giftcodes ENABLE ROW LEVEL SECURITY;

-- Chỉ Admin mới có quyền xem/tạo/xóa giftcode
CREATE POLICY "Admin can manage giftcodes" ON giftcodes
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- User có thể đọc giftcode để kiểm tra khi nhập
CREATE POLICY "Users can read giftcodes" ON giftcodes
    FOR SELECT USING (true);