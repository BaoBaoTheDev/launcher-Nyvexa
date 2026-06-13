-- Đảm bảo mỗi user chỉ redeem 1 lần cho mỗi giftcode
-- Chạy migration này trên DB Supabase trước khi phát hành

create unique index if not exists giftcode_redemptions_user_giftcode_uidx
  on public.giftcode_redemptions (user_id, giftcode_id);
