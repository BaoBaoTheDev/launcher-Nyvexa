-- ─────────────────────────────────────────────────────────────────
-- 1. Bảng balance_logs: ghi lại mọi biến động số dư
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.balance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL,           -- số tiền thay đổi (+/-)
  balance_before NUMERIC(14,2) NOT NULL,   -- số dư trước
  balance_after NUMERIC(14,2) NOT NULL,    -- số dư sau
  reason TEXT NOT NULL,                    -- mô tả: 'deposit', 'purchase_game', 'admin_gift', 'admin_set', etc.
  reference_id TEXT,                       -- ID tham chiếu (deposit_id, game_id, etc.)
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- ai thực hiện (null = system)
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_balance_logs_user ON public.balance_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_logs_created ON public.balance_logs(created_at DESC);

ALTER TABLE public.balance_logs ENABLE ROW LEVEL SECURITY;

-- Chỉ admin/manager/payer đọc được (qua service_key)
-- User thường không thấy log của người khác

-- ─────────────────────────────────────────────────────────────────
-- 2. Roles hợp lệ: 'user', 'admin', 'manager', 'payer'
-- Không cần ALTER cột role vì đã là TEXT tự do
-- Chỉ comment lại cho rõ
-- ─────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.profiles.role IS 'Role: user | admin | manager | payer';
