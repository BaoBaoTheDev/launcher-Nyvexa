-- CTV program: ví CTV + form đăng ký + loại kênh

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ctv_balance BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.ctv_balance IS 'Số dư hoa hồng CTV có thể đối soát/thanh toán';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_ctv_balance_non_negative;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_ctv_balance_non_negative CHECK (ctv_balance >= 0);

CREATE TABLE IF NOT EXISTS public.ctv_channel_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.ctv_channel_types(name)
VALUES
  ('Youtube'),
  ('Facebook'),
  ('Twitch'),
  ('Tiktok'),
  ('Page Facebook')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ctv_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  policy_agreed BOOLEAN NOT NULL DEFAULT false,
  channel_type TEXT NOT NULL,
  other_channel_type TEXT,
  platform_username TEXT NOT NULL,
  real_name TEXT NOT NULL,
  social_profile_link TEXT NOT NULL,
  channel_links TEXT NOT NULL,
  bank_account_name TEXT NOT NULL,
  bank_account_number TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ctv_applications
  DROP CONSTRAINT IF EXISTS ctv_applications_status_chk;

ALTER TABLE public.ctv_applications
  ADD CONSTRAINT ctv_applications_status_chk CHECK (status IN ('pending', 'approved', 'rejected'));

ALTER TABLE public.ctv_channel_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ctv_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Everyone can read channel types" ON public.ctv_channel_types;
CREATE POLICY "Everyone can read channel types" ON public.ctv_channel_types
FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage channel types" ON public.ctv_channel_types;
CREATE POLICY "Admins manage channel types" ON public.ctv_channel_types
FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "Users read own ctv application" ON public.ctv_applications;
CREATE POLICY "Users read own ctv application" ON public.ctv_applications
FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own ctv application" ON public.ctv_applications;
CREATE POLICY "Users insert own ctv application" ON public.ctv_applications
FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own pending ctv application" ON public.ctv_applications;
CREATE POLICY "Users update own pending ctv application" ON public.ctv_applications
FOR UPDATE USING (auth.uid() = user_id AND status = 'pending')
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins manage all ctv applications" ON public.ctv_applications;
CREATE POLICY "Admins manage all ctv applications" ON public.ctv_applications
FOR ALL USING (is_admin());

CREATE INDEX IF NOT EXISTS idx_ctv_applications_status ON public.ctv_applications(status);
CREATE INDEX IF NOT EXISTS idx_ctv_applications_user_status ON public.ctv_applications(user_id, status);
