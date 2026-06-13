-- ====================================================================
-- Tạo bảng custom_otp để quản lý OTP cho forgot_password
-- Chạy trong Supabase SQL Editor
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.custom_otp (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email       text NOT NULL,
  code        text NOT NULL,
  purpose     text NOT NULL DEFAULT 'forgot_password',
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  used        boolean NOT NULL DEFAULT false
);

-- Index để lookup nhanh
CREATE INDEX IF NOT EXISTS custom_otp_email_idx ON public.custom_otp(email);
CREATE INDEX IF NOT EXISTS custom_otp_expires_idx ON public.custom_otp(expires_at);

-- RLS: chỉ service_role được đọc/ghi (backend dùng service_key)
ALTER TABLE public.custom_otp ENABLE ROW LEVEL SECURITY;

-- Cho phép service role full access
CREATE POLICY "service_role full access" ON public.custom_otp
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Auto-cleanup: xóa OTP hết hạn hơn 1 giờ
CREATE OR REPLACE FUNCTION public.cleanup_expired_otp()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM public.custom_otp WHERE expires_at < now() - interval '1 hour';
$$;
