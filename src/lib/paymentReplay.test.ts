import { describe, it, expect } from "vitest";
import { buildReplayInitial } from "./paymentReplay";

// These tests are the "sanity check" the user asked for: regardless of whether
// the Payments page is hit fresh or via a browser refresh, the same URL params
// must produce the same prefilled initial values, pointing at the exact same
// receipt + attempt payload.

const AUDIT_AFTER = {
  receipt_no: "PAY-00012",
  booking_id: "BK-2025-001",
  payment_mode: "Adjustment/Asset",
  amount: 25_000,
  payment_head: "Installment",
  failed_condition: "type_conversion_blocked",
  raw_error: "Cannot convert payment PAY-00012 from Cash to Adjustment/Asset",
};

describe("buildReplayInitial — back-link prefill sanity", () => {
  it("returns null when no receipt is in the URL", () => {
    expect(buildReplayInitial(null, AUDIT_AFTER)).toBeNull();
    expect(buildReplayInitial("", AUDIT_AFTER)).toBeNull();
    expect(buildReplayInitial(undefined, AUDIT_AFTER)).toBeNull();
  });

  it("prefills receipt + booking + payment_mode + amount + payment_head from the audit row", () => {
    const initial = buildReplayInitial("PAY-00012", AUDIT_AFTER);
    expect(initial).toEqual({
      receipt_no: "PAY-00012",
      booking_id: "BK-2025-001",
      payment_mode: "Adjustment/Asset",
      amount: 25_000,
      payment_head: "Installment",
    });
  });

  it("is deterministic: calling it twice with the same inputs (e.g. after refresh) yields identical results", () => {
    const first = buildReplayInitial("PAY-00012", AUDIT_AFTER);
    const second = buildReplayInitial("PAY-00012", AUDIT_AFTER);
    expect(second).toEqual(first);
  });

  it("falls back to safe defaults when the audit row has no payload (e.g. URL with only openReceipt)", () => {
    expect(buildReplayInitial("PAY-00777", null)).toEqual({
      receipt_no: "PAY-00777",
      booking_id: "",
      payment_mode: undefined,
      amount: 0,
      payment_head: undefined,
    });
    expect(buildReplayInitial("PAY-00777", {})).toEqual({
      receipt_no: "PAY-00777",
      booking_id: "",
      payment_mode: undefined,
      amount: 0,
      payment_head: undefined,
    });
  });

  it("always uses the URL receipt_no even if the audit payload disagrees (URL is source of truth)", () => {
    const initial = buildReplayInitial("PAY-99999", {
      ...AUDIT_AFTER,
      receipt_no: "PAY-00001",
    });
    expect(initial?.receipt_no).toBe("PAY-99999");
  });

  it("coerces string amounts to numbers so the form's number input behaves", () => {
    const initial = buildReplayInitial("PAY-00012", {
      ...AUDIT_AFTER,
      amount: "12500",
    });
    expect(initial?.amount).toBe(12_500);
  });

  it("never returns NaN for amount when the audit payload is malformed", () => {
    const initial = buildReplayInitial("PAY-00012", {
      ...AUDIT_AFTER,
      amount: "not-a-number",
    });
    expect(initial?.amount).toBe(0);
  });

  it("ignores non-string booking_id values (defensive)", () => {
    const initial = buildReplayInitial("PAY-00012", {
      ...AUDIT_AFTER,
      booking_id: 42,
    });
    expect(initial?.booking_id).toBe("");
  });
});
