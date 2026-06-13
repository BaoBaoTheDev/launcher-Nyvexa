-- 1. Thêm cột purchase_count vào bảng games
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS purchase_count INTEGER DEFAULT 0;

-- 2. Hàm cập nhật số lượt mua
CREATE OR REPLACE FUNCTION public.update_game_purchase_count()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE public.games 
        SET purchase_count = purchase_count + 1 
        WHERE id = NEW.game_id;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE public.games 
        SET purchase_count = GREATEST(0, purchase_count - 1) 
        WHERE id = OLD.game_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Tạo trigger trên bảng user_games
DROP TRIGGER IF EXISTS on_user_game_purchased ON public.user_games;
CREATE TRIGGER on_user_game_purchased
AFTER INSERT OR DELETE ON public.user_games
FOR EACH ROW EXECUTE FUNCTION public.update_game_purchase_count();

-- 4. Cập nhật lại số liệu thực tế cho các game hiện có
UPDATE public.games g
SET purchase_count = (
    SELECT count(*) 
    FROM public.user_games ug 
    WHERE ug.game_id = g.id
);