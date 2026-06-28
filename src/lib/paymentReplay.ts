// Pure builder that turns an audit-log `after` payload + a receipt_no from the
// URL into the `initial` prop the PaymentForm expects when replaying a blocked
// save. Extracted from Payments.tsx so the back-link sanity check can unit-test
// it without rendering the page.

import type { PaymentFormValue } from "@/components/PaymentForm";

export type ReplayInitial =
  (Partial<PaymentFormValue> & { booking_id?: string });

export function buildReplayInitial(
  openReceipt: string | null | undefined,
  after: Record<string, any> | null | undefined,
): ReplayInitial | null {
  if (!openReceipt) return null;
  const a = after ?? {};
  return {
    receipt_no: openReceipt,
    booking_id: typeof a.booking_id === "string" ? a.booking_id : "",
    payment_mode: a.payment_mode,
    amount: Number(a.amount) || 0,
    payment_head: a.payment_head,
  };
}
