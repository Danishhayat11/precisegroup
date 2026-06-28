import { describe, it, expect } from "vitest";
import { computeLiveBlockStatus, type LiveBlockInput } from "./paymentLockCheck";

// Build a baseline blocked state: user originally tried to save a Cash row as
// Adjustment/Asset on top of an existing Cash row in the DB — the trigger
// would raise `type_conversion_blocked`.
function makeTypeConversionBlock(over: Partial<LiveBlockInput> = {}): LiveBlockInput {
  return {
    form: {
      payment_mode: "Adjustment/Asset",
      amount: 10_000,
      payment_head: "Installment",
      receipt_no: "PAY-00012",
    },
    attempted: {
      payment_mode: "Adjustment/Asset",
      amount: 10_000,
      payment_head: "Installment",
      receipt_no: "PAY-00012",
    },
    prev: { payment_mode: "Cash", safe_cash_amount: 10_000 },
    failedCondition: "type_conversion_blocked",
    ...over,
  };
}

describe("computeLiveBlockStatus — unlock on adjustment/non-cash toggle", () => {
  it("returns inactive when there is no input (no current block)", () => {
    expect(computeLiveBlockStatus(null)).toEqual({ active: false });
  });

  it("stays locked while the user has not changed anything yet", () => {
    const status = computeLiveBlockStatus(makeTypeConversionBlock());
    expect(status).toMatchObject({ active: true, stillFails: true, failed: "type_conversion_blocked" });
    if (status.active) expect(status.reason).toMatch(/Cash/);
  });

  it("unlocks the moment Payment Type toggles away from Adjustment/Asset", () => {
    const status = computeLiveBlockStatus(
      makeTypeConversionBlock({
        form: {
          payment_mode: "Cash",
          amount: 10_000,
          payment_head: "Installment",
          receipt_no: "PAY-00012",
        },
      }),
    );
    expect(status).toMatchObject({ active: true, stillFails: false });
  });

  it("unlocks when the user picks Bank Transfer instead of Adjustment/Asset", () => {
    const status = computeLiveBlockStatus(
      makeTypeConversionBlock({
        form: {
          payment_mode: "Bank Transfer",
          amount: 10_000,
          payment_head: "Installment",
          receipt_no: "PAY-00012",
        },
      }),
    );
    expect(status).toMatchObject({ active: true, stillFails: false });
  });

  it("re-locks when the user reverts Payment Type back to Adjustment/Asset", () => {
    // First a successful toggle…
    const unlocked = computeLiveBlockStatus(
      makeTypeConversionBlock({
        form: {
          payment_mode: "Cash",
          amount: 10_000,
          payment_head: "Installment",
          receipt_no: "PAY-00012",
        },
      }),
    );
    expect(unlocked).toMatchObject({ stillFails: false });

    // …then the user reverts. The predicate must report still-failing again.
    const reverted = computeLiveBlockStatus(makeTypeConversionBlock());
    expect(reverted).toMatchObject({ stillFails: true });
  });
});

describe("computeLiveBlockStatus — adjustment-on-cash-row family", () => {
  const base: LiveBlockInput = {
    form: {
      payment_mode: "Adjustment/Asset",
      amount: 5_000,
      payment_head: "Installment",
      receipt_no: "PAY-00099",
    },
    attempted: {
      payment_mode: "Adjustment/Asset",
      amount: 5_000,
      payment_head: "Installment",
      receipt_no: "PAY-00099",
    },
    prev: { payment_mode: "Cash", safe_cash_amount: 5_000 },
    failedCondition: "adjustment_safe_cash_not_zero",
  };

  it("stays locked while still trying to save Adjustment/Asset against a non-zero cash row", () => {
    expect(computeLiveBlockStatus(base)).toMatchObject({ stillFails: true });
  });

  it("unlocks when Payment Type flips to Cash", () => {
    expect(
      computeLiveBlockStatus({ ...base, form: { ...base.form, payment_mode: "Cash" } }),
    ).toMatchObject({ stillFails: false });
  });

  it("re-locks when the user toggles back to Adjustment/Asset", () => {
    const off = computeLiveBlockStatus({ ...base, form: { ...base.form, payment_mode: "Cash" } });
    expect(off.active && off.stillFails).toBe(false);
    const on = computeLiveBlockStatus(base);
    expect(on).toMatchObject({ stillFails: true });
  });

  it("does not lock on a fresh insert (no prev row)", () => {
    expect(computeLiveBlockStatus({ ...base, prev: null })).toMatchObject({
      stillFails: false,
    });
  });
});

describe("computeLiveBlockStatus — generic / unknown failure", () => {
  const attempted = {
    payment_mode: "Cash",
    amount: 1_000,
    payment_head: "Installment",
    receipt_no: "PAY-00200",
  };
  const baseForm = { ...attempted };

  it("stays locked when nothing has changed", () => {
    const status = computeLiveBlockStatus({
      form: baseForm,
      attempted,
      prev: null,
      failedCondition: "unknown",
    });
    expect(status).toMatchObject({ stillFails: true });
  });

  it("unlocks when Amount changes", () => {
    const status = computeLiveBlockStatus({
      form: { ...baseForm, amount: 1_200 },
      attempted,
      prev: null,
      failedCondition: "unknown",
    });
    expect(status).toMatchObject({ stillFails: false });
  });

  it("unlocks when Payment Head changes", () => {
    const status = computeLiveBlockStatus({
      form: { ...baseForm, payment_head: "Possession" },
      attempted,
      prev: null,
      failedCondition: "unknown",
    });
    expect(status).toMatchObject({ stillFails: false });
  });

  it("re-locks after reverting Amount back to the attempted value", () => {
    const off = computeLiveBlockStatus({
      form: { ...baseForm, amount: 1_200 },
      attempted,
      prev: null,
      failedCondition: "unknown",
    });
    expect(off).toMatchObject({ stillFails: false });
    const on = computeLiveBlockStatus({
      form: baseForm,
      attempted,
      prev: null,
      failedCondition: "unknown",
    });
    expect(on).toMatchObject({ stillFails: true });
  });
});

describe("computeLiveBlockStatus — duplicate_receipt", () => {
  it("stays locked until receipt_no changes, and re-locks when reverted", () => {
    const attempted = {
      payment_mode: "Cash",
      amount: 500,
      payment_head: "Installment",
      receipt_no: "PAY-00007",
    };
    const stuck = computeLiveBlockStatus({
      form: { ...attempted },
      attempted,
      prev: null,
      failedCondition: "duplicate_receipt",
    });
    expect(stuck).toMatchObject({ stillFails: true });

    const fresh = computeLiveBlockStatus({
      form: { ...attempted, receipt_no: "PAY-00008" },
      attempted,
      prev: null,
      failedCondition: "duplicate_receipt",
    });
    expect(fresh).toMatchObject({ stillFails: false });

    const reverted = computeLiveBlockStatus({
      form: { ...attempted },
      attempted,
      prev: null,
      failedCondition: "duplicate_receipt",
    });
    expect(reverted).toMatchObject({ stillFails: true });
  });
});
