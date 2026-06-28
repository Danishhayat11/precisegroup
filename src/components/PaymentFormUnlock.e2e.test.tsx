import { describe, it, expect, afterEach } from "vitest";
import { useMemo, useState } from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
  waitFor,
} from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LockedTip } from "@/components/PaymentFormLockedTip";
import { computeLiveBlockStatus, type LiveBlockStatus } from "@/lib/paymentLockCheck";

/**
 * End-to-end-style test for the locked-field unlock flow on the real
 * PaymentForm wiring:
 *
 *   1. A blocked audit row locks the "Notes" field (input + tooltip wrapper
 *      mirror exactly what `PaymentForm.tsx` renders at line ~1100).
 *   2. The user attempts to edit the locked input → the value is rejected
 *      because the underlying control is `disabled`.
 *   3. Focusing the field surfaces the unlock tooltip which explains the
 *      exact failed_condition and the unlock action (toggle Payment Type,
 *      Amount, or Payment Head).
 *   4. The user performs the unlock action (switching Payment Type to Cash)
 *      → `computeLiveBlockStatus` flips to passing, `locked` drops to false,
 *      and the `disabled` attribute is removed in-place.
 *   5. Typing into the now-unlocked input updates its value.
 *
 * We bypass the network-mediated path (real PaymentForm only sets
 * `blockedAudit` after a failed save round-trip) by seeding `blockedAudit`
 * directly — the rest of the wiring (predicate, tooltip, disabled prop,
 * onChange handler) is exactly what production renders.
 */

const SEEDED_BLOCKED = {
  id: "aud-blocked-1",
  failed_condition: "adjustment_safe_cash_not_zero",
};
const SEEDED_ATTEMPT = {
  payment_mode: "Adjustment/Asset",
  amount: 250000,
  payment_head: "Installment",
  receipt_no: "PAY-00042",
};
const SEEDED_PREV = {
  payment_mode: "Cash",
  safe_cash_amount: 250000,
  non_cash_adjustment: false,
};

function PaymentFormUnlockHarness() {
  // Same shape as the real form fields the lock predicate looks at.
  const [paymentMode, setPaymentMode] = useState(SEEDED_ATTEMPT.payment_mode);
  const [amount, setAmount] = useState(SEEDED_ATTEMPT.amount);
  const [paymentHead, setPaymentHead] = useState(SEEDED_ATTEMPT.payment_head);
  const [notes, setNotes] = useState("");

  // Mirrors PaymentForm: blockedAudit starts populated (the row that came
  // back from the trigger), and gets cleared once the live re-check passes.
  const [blockedAudit, setBlockedAudit] = useState<typeof SEEDED_BLOCKED | null>(
    SEEDED_BLOCKED,
  );

  const liveBlockStatus: LiveBlockStatus = useMemo(() => {
    if (!blockedAudit) return { active: false };
    return computeLiveBlockStatus({
      form: {
        payment_mode: paymentMode,
        amount: Number(amount) || 0,
        payment_head: paymentHead,
        receipt_no: SEEDED_ATTEMPT.receipt_no,
      },
      attempted: SEEDED_ATTEMPT,
      prev: SEEDED_PREV,
      failedCondition: blockedAudit.failed_condition,
    });
  }, [blockedAudit, paymentMode, amount, paymentHead]);

  // Drop the lock once the predicate clears — same effect as PaymentForm's
  // `useEffect` on `liveBlockStatus`.
  if (liveBlockStatus.active && !liveBlockStatus.stillFails && blockedAudit) {
    // setState during render is intentional here: this is the equivalent
    // of PaymentForm's post-commit effect, condensed for the test harness.
    queueMicrotask(() => setBlockedAudit(null));
  }

  const locked = !!blockedAudit;

  return (
    <TooltipProvider delayDuration={0}>
      <div>
        {/* Unlock controls — these are the three fields PaymentForm keeps
            editable while the form is locked. */}
        <label>
          Payment Type
          <select
            data-testid="payment-mode"
            value={paymentMode}
            onChange={(e) => setPaymentMode(e.target.value)}
          >
            <option>Cash</option>
            <option>Bank Transfer</option>
            <option>Adjustment/Asset</option>
          </select>
        </label>
        <label>
          Amount
          <input
            data-testid="amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </label>
        <label>
          Payment Head
          <input
            data-testid="payment-head"
            value={paymentHead}
            onChange={(e) => setPaymentHead(e.target.value)}
          />
        </label>

        {/* Status banner (matches PaymentForm's locked-mode banner). */}
        <div data-testid="lock-state">{locked ? "locked" : "unlocked"}</div>

        {/* The locked field under test — wired EXACTLY like PaymentForm's
            Notes field at line ~1100 of PaymentForm.tsx. */}
        <LockedTip
          locked={locked}
          failedCondition={blockedAudit?.failed_condition}
          liveBlockStatus={
            liveBlockStatus.active
              ? {
                  stillFails: liveBlockStatus.stillFails,
                  reason: liveBlockStatus.reason,
                }
              : null
          }
          field="Notes"
          note="Notes are read-only while a blocked attempt is open so they stay in sync with the audited payload."
        >
          <input
            aria-label="Notes"
            data-testid="notes"
            value={notes}
            disabled={locked}
            onChange={(e) => setNotes(e.target.value)}
          />
        </LockedTip>
      </div>
    </TooltipProvider>
  );
}

afterEach(() => cleanup());

describe("PaymentForm locked-field unlock — e2e", () => {
  it("locks the field, surfaces the tooltip, accepts the unlock action, and lets the user type after unlock", async () => {
    render(<PaymentFormUnlockHarness />);

    const notes = screen.getByTestId("notes") as HTMLInputElement;
    const lockState = screen.getByTestId("lock-state");

    // 1. Initial state — blocked audit row locks the field.
    expect(lockState.textContent).toBe("locked");
    expect(notes).toBeDisabled();

    // 2. Attempt to edit — disabled input rejects the change.
    fireEvent.change(notes, { target: { value: "should be rejected" } });
    expect(notes.value).toBe("");

    // 3. Focus the locked field → tooltip appears with the unlock copy.
    //    LockedTip wraps children in a <span> trigger; focusing that opens
    //    the Radix tooltip.
    const trigger = notes.parentElement!;
    fireEvent.focus(trigger);

    const tip = await screen.findByRole("tooltip");
    const u = within(tip);
    expect(u.getByText(/Notes is locked/i)).toBeInTheDocument();
    // Exact failed_condition surfaced from the blocked audit row.
    expect(u.getByText("adjustment_safe_cash_not_zero")).toBeInTheDocument();
    // Unlock instructions name the three fields that clear the lock.
    expect(u.getByText(/To unlock:/i)).toBeInTheDocument();
    expect(u.getByText(/Payment Type/i)).toBeInTheDocument();
    expect(u.getByText(/Amount/i)).toBeInTheDocument();
    expect(u.getByText(/Payment Head/i)).toBeInTheDocument();
    // Live re-check still failing — reason rendered too.
    expect(
      u.getByText(/Live re-check still fails/i),
    ).toBeInTheDocument();

    // 4. Perform the unlock action — switching Payment Type to Cash resolves
    //    the adjustment-cash invariant. computeLiveBlockStatus flips to
    //    passing and the harness drops `blockedAudit` in a microtask, same
    //    as PaymentForm's post-commit effect.
    fireEvent.change(screen.getByTestId("payment-mode"), {
      target: { value: "Cash" },
    });

    await waitFor(() => expect(lockState.textContent).toBe("unlocked"));

    // Tooltip wrapper is gone — children render unwrapped, no role=tooltip.
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // 5. Field is editable and accepts input.
    const notesAfter = screen.getByTestId("notes") as HTMLInputElement;
    expect(notesAfter).not.toBeDisabled();
    fireEvent.change(notesAfter, { target: { value: "Unlock confirmed ✅" } });
    expect(notesAfter.value).toBe("Unlock confirmed ✅");
  });
});
