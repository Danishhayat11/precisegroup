// Robust mapping from Postgres error codes / trigger messages to user-friendly
// inline + toast text for the Payment form.
//
// Source of truth for trigger conditions: public.enforce_adjustment_cash_invariant
//   - safe_cash_amount = 0 (Adjustment/Asset)
//   - non_cash_adjustment = true
//   - cash_bank_include = false
//   - Cannot convert payment ... to Adjustment/Asset
//   - safe_cash_amount must equal amount (Cash / Bank)
//   - non_cash_adjustment = true on Cash / Bank rows
//
// Postgres SQLSTATE reference:
//   23514 check_violation        — our cash-invariant trigger
//   23505 unique_violation       — duplicate receipt_no
//   23503 fk_violation           — missing booking / dealer
//   23502 not_null_violation     — required field missing
//   22P02 invalid_text_repr      — bad number / uuid / date
//   42501 insufficient_privilege — RLS / GRANT denied
//   P0001 raise_exception        — generic RAISE EXCEPTION fallback

export type FailedCondition =
  | "adjustment_safe_cash_not_zero"
  | "adjustment_flag_missing"
  | "cash_bank_include_inconsistent"
  | "type_conversion_blocked"
  | "cash_amount_mismatch"
  | "non_cash_flag_on_cash_row"
  | "cash_invariant.generic"
  | "duplicate_receipt"
  | "missing_reference"
  | "missing_required_field"
  | "bad_value_format"
  | "permission_denied"
  | "unknown";

export interface PaymentErrorMapping {
  /** Stable tag for audit logs */
  failedCondition: FailedCondition;
  /** SQLSTATE if known */
  code?: string;
  /** Whether this is the cash-invariant trigger (drives focus / highlight) */
  isCashInvariant: boolean;
  /** Toast title */
  toastTitle: string;
  /** Toast description */
  toastDescription: string;
  /** Inline errors keyed by form field name */
  fieldErrors: Record<string, string>;
}

interface SupabaseLikeError {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

const ADJ_INLINE =
  "Adjustment/Asset payments must not affect Cash Received. Switch the type to Cash or Bank Transfer for real cash receipts, or keep it as Adjustment — the amount is tracked on the Adjustments register.";
const CASH_INLINE =
  "This change would alter Cash Received totals and was blocked by the database. Review the payment type and amount.";

export function mapPaymentError(
  err: SupabaseLikeError | null | undefined,
  ctx: { paymentMode?: string } = {},
): PaymentErrorMapping {
  const raw = (err?.message || "").trim();
  const code = (err?.code || "").trim();
  const isAdj = ctx.paymentMode === "Adjustment/Asset";

  // ── Cash-invariant trigger (SQLSTATE 23514, raised by our function) ─────
  const triggerFingerprint =
    /Cash Received/i.test(raw) ||
    /Adjustment\/Asset payment/i.test(raw) ||
    /Cannot convert payment/i.test(raw) ||
    /safe_cash_amount/i.test(raw);

  if (code === "23514" || triggerFingerprint) {
    let failedCondition: FailedCondition = "cash_invariant.generic";
    const fieldErrors: Record<string, string> = {};

    if (/Cannot convert payment/i.test(raw)) {
      failedCondition = "type_conversion_blocked";
      fieldErrors.payment_mode =
        "Cannot convert a Cash / Bank payment into Adjustment/Asset — Cash Received totals would shift. Delete and re-create the entry instead.";
    } else if (/safe_cash_amount\s*=\s*0/i.test(raw) || /safe_cash_amount\s*=\s*\S+\s*\(must be 0/i.test(raw)) {
      failedCondition = "adjustment_safe_cash_not_zero";
      fieldErrors.payment_mode = ADJ_INLINE;
      fieldErrors.amount = "Amount is tracked on the Adjustments register, not Cash Received.";
    } else if (/non_cash_adjustment\s*=\s*true/i.test(raw) && isAdj) {
      failedCondition = "adjustment_flag_missing";
      fieldErrors.payment_mode = ADJ_INLINE;
    } else if (/non_cash_adjustment\s*=\s*true/i.test(raw)) {
      failedCondition = "non_cash_flag_on_cash_row";
      fieldErrors.payment_mode =
        "Cash / Bank payments cannot be flagged as non-cash adjustments. Switch the type to Adjustment/Asset if this is not a real cash receipt.";
    } else if (/cash_bank_include\s*=\s*false/i.test(raw)) {
      failedCondition = "cash_bank_include_inconsistent";
      fieldErrors.payment_mode = ADJ_INLINE;
    } else if (/safe_cash_amount.*must equal amount/i.test(raw)) {
      failedCondition = "cash_amount_mismatch";
      fieldErrors.amount =
        "Amount and the cash-side amount disagree. Re-enter the amount or change the payment type.";
    } else {
      fieldErrors.payment_mode = isAdj ? ADJ_INLINE : CASH_INLINE;
      if (isAdj) fieldErrors.amount = "Amount is tracked on the Adjustments register, not Cash Received.";
    }

    return {
      failedCondition,
      code: code || "23514",
      isCashInvariant: true,
      toastTitle: "Save blocked — Cash Received would change",
      toastDescription: "See the highlighted fields for details.",
      fieldErrors,
    };
  }

  // ── Other well-known Postgres errors ────────────────────────────────────
  if (code === "23505" || /duplicate key|already exists/i.test(raw)) {
    return {
      failedCondition: "duplicate_receipt",
      code: code || "23505",
      isCashInvariant: false,
      toastTitle: "Duplicate receipt number",
      toastDescription: "A payment with this receipt number already exists.",
      fieldErrors: { receipt_no: "This receipt number is already used." },
    };
  }

  if (code === "23503" || /foreign key|violates foreign key/i.test(raw)) {
    const m = raw.match(/Key \((\w+)\)=/i);
    const field = m?.[1] ?? "booking_id";
    return {
      failedCondition: "missing_reference",
      code: code || "23503",
      isCashInvariant: false,
      toastTitle: "Linked record not found",
      toastDescription: "The booking, dealer, or related record could not be found.",
      fieldErrors: { [field]: "Referenced record does not exist." },
    };
  }

  if (code === "23502" || /null value in column/i.test(raw)) {
    const m = raw.match(/null value in column "(\w+)"/i);
    const field = m?.[1] ?? "amount";
    return {
      failedCondition: "missing_required_field",
      code: code || "23502",
      isCashInvariant: false,
      toastTitle: "Missing required field",
      toastDescription: `Please fill in "${field}".`,
      fieldErrors: { [field]: "This field is required." },
    };
  }

  if (code === "22P02" || /invalid input syntax/i.test(raw)) {
    return {
      failedCondition: "bad_value_format",
      code: code || "22P02",
      isCashInvariant: false,
      toastTitle: "Invalid value",
      toastDescription: "One of the fields has an invalid format. Check numbers and dates.",
      fieldErrors: {},
    };
  }

  if (code === "42501" || /permission denied|row-level security/i.test(raw)) {
    return {
      failedCondition: "permission_denied",
      code: code || "42501",
      isCashInvariant: false,
      toastTitle: "Not allowed",
      toastDescription: "Your role does not permit this change. Contact an admin.",
      fieldErrors: {},
    };
  }

  return {
    failedCondition: "unknown",
    code: code || undefined,
    isCashInvariant: false,
    toastTitle: "Save failed",
    toastDescription: raw || "Unexpected error.",
    fieldErrors: {},
  };
}
