-- Thêm cột email vào profiles nếu chưa có
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- Cập nhật trigger để lưu email khi user đăng ký mới
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, email, role, balance)
  VALUES (
    new.id,
    LOWER(COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))),
    COALESCE(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.email,
    'user',
    0
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bảng theo dõi việc sử dụng giftcode của từng user
CREATE TABLE IF NOT EXISTS giftcode_redemptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    giftcode_id UUID REFERENCES giftcodes(id) ON DELETE CASCADE,
    redeemed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, giftcode_id)
);

-- Bật RLS cho bảng mới
ALTER TABLE giftcode_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see their own redemptions" ON giftcode_redemptions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admin can see all redemptions" ON giftcode_redemptions
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );