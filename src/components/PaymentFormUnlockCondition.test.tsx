import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LockedTip } from "@/components/PaymentFormLockedTip";
import { computeLiveBlockStatus, type LiveBlockStatus } from "@/lib/paymentLockCheck";

/**
 * Mocked "unlock-condition API". In production this is the audit_logs row
 * fetched by the PaymentForm — its `failed_condition` field drives the
 * live re-check predicate. We mock it so we can flip server state at runtime
 * and assert the UI updates without a remount / page refresh.
 */
const fetchUnlockCondition = vi.fn(
  async (): Promise<{ failed_condition: string | null; attempted: any }> => ({
    failed_condition: null,
    attempted: null,
  })
);

/**
 * Tiny host that mirrors how PaymentForm wires LockedTip:
 *   1. Fetch the failed_condition from the (mocked) API on mount + on re-check.
 *   2. Run the same `computeLiveBlockStatus` predicate the trigger uses.
 *   3. Re-render LockedTip with the new status — no full unmount.
 */
function Harness({
  paymentMode,
  onAmount,
  amount,
}: { paymentMode: string; onAmount: (v: number) => void; amount: number }) {
  const [condition, setCondition] = useState<string | null | undefined>(undefined);
  const [attempted, setAttempted] = useState<any>(null);
  const [tick, setTick] = useState(0);

  // Mount + manual re-check both go through the mocked "API".
  useEffect(() => {
    let cancelled = false;
    fetchUnlockCondition().then((r) => {
      if (cancelled) return;
      setCondition(r.failed_condition);
      setAttempted(r.attempted);
    });
    return () => { cancelled = true; };
  }, [tick]);

  // While the first fetch is in flight, render the children unwrapped so the
  // test can assert we don't flash a stale lock state.
  if (condition === undefined) {
    return <div data-testid="loading">checking…</div>;
  }

  const status: LiveBlockStatus = computeLiveBlockStatus({
    form: {
      payment_mode: paymentMode,
      amount,
      payment_head: "Installment",
      receipt_no: "PAY-00042",
    },
    attempted,
    prev: { payment_mode: "Cash", safe_cash_amount: 250000, non_cash_adjustment: false },
    failedCondition: condition ?? "",
  });

  // `locked` mirrors PaymentForm: a known blocked audit row -> locked until the
  // live re-check passes. We surface the live status into the tooltip exactly
  // the way PaymentForm does.
  const locked = status.active && status.stillFails;

  return (
    <div>
      <button data-testid="recheck" onClick={() => setTick((t) => t + 1)}>
        Re-check
      </button>
      <div data-testid="live-status">
        {status.active
          ? status.stillFails
            ? `failing:${status.failed}:${status.reason}`
            : `passing:${status.failed}`
          : "inactive"}
      </div>
      <LockedTip
        locked={locked}
        failedCondition={condition}
        liveBlockStatus={
          status.active ? { stillFails: status.stillFails, reason: status.reason } : null
        }
        field="Notes"
        note="Notes are read-only while a blocked attempt is open so they stay in sync with the audited payload."
      >
        <button data-testid="locked-target" onClick={() => onAmount(amount + 1)}>
          notes input
        </button>
      </LockedTip>
    </div>
  );
}

function renderHarness(initial: { paymentMode?: string; amount?: number } = {}) {
  function Wrap() {
    const [mode, setMode] = useState(initial.paymentMode ?? "Adjustment/Asset");
    const [amt, setAmt] = useState(initial.amount ?? 250000);
    return (
      <TooltipProvider delayDuration={0}>
        <Harness paymentMode={mode} amount={amt} onAmount={setAmt} />
        <button data-testid="set-cash" onClick={() => setMode("Cash")}>Cash</button>
        <button data-testid="set-adj" onClick={() => setMode("Adjustment/Asset")}>Adj</button>
      </TooltipProvider>
    );
  }
  return render(<Wrap />);
}

async function openTooltip() {
  const trigger = screen.getByTestId("locked-target").parentElement!;
  fireEvent.focus(trigger);
  return await screen.findByRole("tooltip");
}

beforeEach(() => fetchUnlockCondition.mockReset());
afterEach(() => cleanup());

describe("PaymentForm unlock-condition: live re-check without page refresh", () => {
  it("FAILING — condition active and re-check still fails → tooltip surfaces the live reason", async () => {
    fetchUnlockCondition.mockResolvedValue({
      failed_condition: "adjustment_safe_cash_not_zero",
      attempted: { payment_mode: "Adjustment/Asset", amount: 250000, payment_head: "Installment" },
    });
    renderHarness();

    await waitFor(() =>
      expect(screen.getByTestId("live-status").textContent).toMatch(/^failing:/)
    );
    expect(screen.getByTestId("live-status").textContent).toContain("adjustment_safe_cash_not_zero");

    const tip = await openTooltip();
    const u = within(tip);
    expect(u.getByText(/Notes is locked/i)).toBeInTheDocument();
    expect(u.getByText("adjustment_safe_cash_not_zero")).toBeInTheDocument();
    expect(
      u.getByText(/Live re-check still fails:.*invariant/i)
    ).toBeInTheDocument();
  });

  it("PASSING — toggling the form to a value that clears the predicate updates the UI live", async () => {
    fetchUnlockCondition.mockResolvedValue({
      failed_condition: "adjustment_safe_cash_not_zero",
      attempted: { payment_mode: "Adjustment/Asset", amount: 250000, payment_head: "Installment" },
    });
    renderHarness();

    await waitFor(() =>
      expect(screen.getByTestId("live-status").textContent).toMatch(/^failing:/)
    );

    // Same component instance — no remount. Toggling Payment Mode to Cash
    // resolves the adjustment-cash invariant, so the predicate flips to
    // passing and the lock clears in-place.
    fireEvent.click(screen.getByTestId("set-cash"));

    await waitFor(() =>
      expect(screen.getByTestId("live-status").textContent).toBe("passing:adjustment_safe_cash_not_zero")
    );
    // Lock dropped → no tooltip wrapper, children render unwrapped, no role=tooltip.
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.getByTestId("locked-target")).toBeInTheDocument();

    // Mock count proves we did NOT re-fetch / refresh — the API was called once
    // on mount and the predicate re-ran client-side.
    expect(fetchUnlockCondition).toHaveBeenCalledTimes(1);
  });

  it("MISSING — null failed_condition falls back to 'cash invariant' and re-evaluates on click", async () => {
    // First "API call" returns no condition tag (legacy / stripped audit row).
    fetchUnlockCondition.mockResolvedValueOnce({
      failed_condition: null,
      attempted: { payment_mode: "Adjustment/Asset", amount: 250000, payment_head: "Installment" },
    });
    renderHarness();

    // Default branch of computeLiveBlockStatus: form values match the attempt → stillFails.
    await waitFor(() =>
      expect(screen.getByTestId("live-status").textContent).toMatch(/^failing:unknown/)
    );

    const tip = await openTooltip();
    // Fallback label rendered when failed_condition is missing.
    expect(within(tip).getByText("cash invariant")).toBeInTheDocument();
    expect(
      within(tip).getByText(/Form values still match the attempt that was blocked/i)
    ).toBeInTheDocument();

    // Second "API call" now returns a concrete condition — clicking Re-check
    // refetches without remount and the tooltip flips to the new label.
    fetchUnlockCondition.mockResolvedValueOnce({
      failed_condition: "duplicate_receipt",
      attempted: { receipt_no: "PAY-00042" },
    });
    fireEvent.click(screen.getByTestId("recheck"));

    await waitFor(() =>
      expect(screen.getByTestId("live-status").textContent).toContain("duplicate_receipt")
    );
    const tip2 = await openTooltip();
    expect(within(tip2).getByText("duplicate_receipt")).toBeInTheDocument();
    // Fallback label is gone now that the real condition is known.
    expect(within(tip2).queryByText(/^cash invariant$/)).not.toBeInTheDocument();

    expect(fetchUnlockCondition).toHaveBeenCalledTimes(2);
  });
});
