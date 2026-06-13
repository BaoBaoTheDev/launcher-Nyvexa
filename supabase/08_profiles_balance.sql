-- Ví tiền giả để test mua game (số dư trong profiles)
-- Chạy sau 07_reviews.sql

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS balance NUMERIC(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.balance IS 'Số dư ví (tiền giả) để test mua game';
