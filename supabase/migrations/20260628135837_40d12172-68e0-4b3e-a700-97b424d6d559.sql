-- Enforce: Adjustment/Asset payments must never contribute to Cash Received.
-- Cash Received is SUM(safe_cash_amount) across the payments table, so the only way
-- an Adjustment/Asset row can leave it unchanged is if its safe_cash_amount is 0
-- and its non_cash_adjustment flag is true. We also block converting an existing
-- Cash / Bank Transfer row into an Adjustment/Asset row (that would shift totals).

CREATE OR REPLACE FUNCTION public.enforce_adjustment_cash_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_old_mode text;
BEGIN
  IF NEW.payment_mode = 'Adjustment/Asset' THEN
    -- Force the cash-side fields onto the safe values.
    IF NEW.safe_cash_amount IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION
        'Adjustment/Asset payment % cannot have safe_cash_amount = % (must be 0 — would change Cash Received totals).',
        NEW.receipt_no, NEW.safe_cash_amount
        USING ERRCODE = 'check_violation';
    END IF;

    IF COALESCE(NEW.non_cash_adjustment, false) IS NOT TRUE THEN
      RAISE EXCEPTION
        'Adjustment/Asset payment % must have non_cash_adjustment = true.',
        NEW.receipt_no
        USING ERRCODE = 'check_violation';
    END IF;

    IF COALESCE(NEW.cash_bank_include, false) IS NOT FALSE THEN
      RAISE EXCEPTION
        'Adjustment/Asset payment % must have cash_bank_include = false.',
        NEW.receipt_no
        USING ERRCODE = 'check_violation';
    END IF;

    -- Block converting a Cash / Bank row into Adjustment/Asset (would shift totals).
    IF TG_OP = 'UPDATE' THEN
      v_old_mode := OLD.payment_mode;
      IF v_old_mode IS NOT NULL
         AND v_old_mode <> 'Adjustment/Asset'
         AND COALESCE(OLD.safe_cash_amount, 0) <> 0 THEN
        RAISE EXCEPTION
          'Cannot convert payment % from % to Adjustment/Asset — Cash Received would change.',
          NEW.receipt_no, v_old_mode
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSE
    -- Non-adjustment rows: safe_cash_amount must equal amount, and flags consistent.
    IF NEW.safe_cash_amount IS DISTINCT FROM NEW.amount THEN
      RAISE EXCEPTION
        'Payment %: safe_cash_amount (%) must equal amount (%) for Cash / Bank Transfer entries.',
        NEW.receipt_no, NEW.safe_cash_amount, NEW.amount
        USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(NEW.non_cash_adjustment, false) IS NOT FALSE THEN
      RAISE EXCEPTION
        'Payment % marked as % cannot have non_cash_adjustment = true.',
        NEW.receipt_no, NEW.payment_mode
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_adjustment_cash_invariant ON public.payments;
CREATE TRIGGER trg_payments_adjustment_cash_invariant
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_adjustment_cash_invariant();