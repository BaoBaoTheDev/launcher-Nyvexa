-- Thêm cột game_id vào bảng giftcodes
ALTER TABLE giftcodes ADD COLUMN IF NOT EXISTS game_id UUID REFERENCES games(id) ON DELETE CASCADE;

-- Cập nhật comment để phân biệt
COMMENT ON COLUMN giftcodes.amount IS 'Số tiền tặng (nếu là mã tiền)';
COMMENT ON COLUMN giftcodes.game_id IS 'ID game tặng (nếu là mã game)';