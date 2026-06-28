// Pure predicate that mirrors the Postgres enforce_adjustment_cash_invariant
// trigger so the Payment form can re-evaluate a blocked save against the
// current form values without round-tripping to the database.
//
// Extracted from PaymentForm so it can be unit-tested in isolation.

export type LiveBlockInput = {
  /** Form values currently entered by the user. */
  form: {
    payment_mode: string;
    amount: number;
    payment_head: string;
    receipt_no: string;
  };
  /** Payload that was attempted when the block originally fired. */
  attempted: {
    payment_mode?: string;
    amount?: number;
    payment_head?: string;
    receipt_no?: string;
  } | null;
  /** Existing DB row for this receipt, if any (only relevant on edit). */
  prev: {
    payment_mode?: string;
    safe_cash_amount?: number;
    non_cash_adjustment?: boolean;
  } | null;
  /** failed_condition tag from the original blocked-save audit row. */
  failedCondition: string;
};

export type LiveBlockStatus =
  | { active: false }
  | { active: true; stillFails: boolean; reason: string; failed: string };

export function computeLiveBlockStatus(
  input: LiveBlockInput | null,
): LiveBlockStatus {
  if (!input) return { active: false };
  const { form, attempted, prev, failedCondition } = input;
  const failed = failedCondition || "unknown";
  const isAdj = form.payment_mode === "Adjustment/Asset";
  const amt = Number(form.amount) || 0;
  const attemptedAmt = Number(attempted?.amount) || 0;
  const attemptedMode = attempted?.payment_mode;

  let stillFails = false;
  let reason = "";

  switch (failed) {
    case "type_conversion_blocked": {
      if (isAdj && prev && prev.payment_mode && prev.payment_mode !== "Adjustment/Asset") {
        stillFails = true;
        reason = `Existing row is ${prev.payment_mode} — converting to Adjustment/Asset would shift Cash Received.`;
      }
      break;
    }
    case "adjustment_safe_cash_not_zero":
    case "adjustment_flag_missing":
    case "cash_bank_include_inconsistent": {
      if (isAdj && prev && Math.abs(Number(prev.safe_cash_amount) || 0) > 0.005) {
        stillFails = true;
        reason = "Saving as Adjustment/Asset on top of a row whose cash side is non-zero still violates the invariant.";
      }
      break;
    }
    case "non_cash_flag_on_cash_row":
    case "cash_amount_mismatch": {
      // Form normalises these on save, so any setting passes the predicate.
      stillFails = false;
      break;
    }
    case "duplicate_receipt": {
      if (form.receipt_no === attempted?.receipt_no) {
        stillFails = true;
        reason = "Receipt number is unchanged — saving will collide again.";
      }
      break;
    }
    default: {
      const changed =
        form.payment_mode !== attemptedMode ||
        amt !== attemptedAmt ||
        form.payment_head !== attempted?.payment_head;
      stillFails = !changed;
      if (stillFails) reason = "Form values still match the attempt that was blocked.";
    }
  }

  return { active: true, stillFails, reason, failed };
}
