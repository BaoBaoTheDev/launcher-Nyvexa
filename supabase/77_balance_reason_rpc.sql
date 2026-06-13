-- ====================================================================
-- RPC để set app.balance_reason + cập nhật balance trong 1 transaction
-- Giúp trigger log_balance_change biết lý do thay đổi balance
-- ====================================================================

CREATE OR REPLACE FUNCTION public.set_balance_with_reason(
  p_user_id UUID,
  p_new_balance NUMERIC(14,2),
  p_reason TEXT,
  p_reference_id TEXT DEFAULT NULL,
  p_performed_by UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Set session var để trigger đọc
  PERFORM set_config('app.balance_reason', p_reason, true);

  -- Nếu có reference_id, inject vào trigger qua session var
  IF p_reference_id IS NOT NULL THEN
    PERFORM set_config('app.balance_reference_id', p_reference_id, true);
  END IF;

  IF p_performed_by IS NOT NULL THEN
    PERFORM set_config('app.balance_performed_by', p_performed_by::text, true);
  END IF;

  UPDATE public.profiles
  SET balance = p_new_balance
  WHERE id = p_user_id;
END;
$$;

-- Sửa trigger để đọc thêm reference_id và performed_by từ session vars
CREATE OR REPLACE FUNCTION public.log_balance_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reason TEXT;
  v_ref_id TEXT;
  v_performed_by UUID;
BEGIN
  IF OLD.balance IS DISTINCT FROM NEW.balance THEN
    v_reason := COALESCE(
      NULLIF(current_setting('app.balance_reason', true), ''),
      'unknown'
    );
    v_ref_id := NULLIF(current_setting('app.balance_reference_id', true), '');
    BEGIN
      v_performed_by := current_setting('app.balance_performed_by', true)::UUID;
    EXCEPTION WHEN OTHERS THEN
      v_performed_by := NULL;
    END;

    -- Fallback performed_by từ JWT nếu không có session var
    IF v_performed_by IS NULL THEN
      BEGIN
        v_performed_by := CASE
          WHEN current_setting('request.jwt.claim.role', true) = 'service_role' THEN NULL
          ELSE auth.uid()
        END;
      EXCEPTION WHEN OTHERS THEN
        v_performed_by := NULL;
      END;
    END IF;

    INSERT INTO public.balance_logs (
      user_id, amount, balance_before, balance_after,
      reason, reference_id, performed_by
    )
    VALUES (
      NEW.id,
      NEW.balance - OLD.balance,
      OLD.balance,
      NEW.balance,
      v_reason,
      v_ref_id,
      v_performed_by
    );

    -- Reset session vars sau khi dùng
    PERFORM set_config('app.balance_reason', '', true);
    PERFORM set_config('app.balance_reference_id', '', true);
    PERFORM set_config('app.balance_performed_by', '', true);
  END IF;
  RETURN NEW;
END;
$$;
