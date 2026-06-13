-- ─────────────────────────────────────────────────────────────────
-- Trigger tự động ghi balance_logs khi balance thay đổi trên profiles
-- Trigger fires AFTER UPDATE trên profiles khi balance khác cũ.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_balance_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Chỉ log khi balance thực sự thay đổi
  IF OLD.balance IS DISTINCT FROM NEW.balance THEN
    INSERT INTO public.balance_logs (user_id, amount, balance_before, balance_after, reason, performed_by)
    VALUES (
      NEW.id,
      NEW.balance - OLD.balance,
      OLD.balance,
      NEW.balance,
      COALESCE(current_setting('app.balance_reason', true), 'unknown'),
      -- performed_by: nếu là service_role thì NULL (system), nếu là user thì auth.uid()
      CASE WHEN current_setting('request.jwt.claim.role', true) = 'service_role'
        THEN NULL
        ELSE auth.uid()
      END
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_balance_change ON public.profiles;
CREATE TRIGGER trg_log_balance_change
  AFTER UPDATE OF balance ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.log_balance_change();
