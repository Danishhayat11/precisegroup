import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Verifies the aria-live UNLOCK announcement that fires when the
 * parent-driven lock flips from true → false (retry succeeded, latest
 * audit prefill arrived):
 *
 *   1. While locked: the lock-status live region carries the parent's
 *      `lockedReason`, and the unlock-status live region is empty.
 *   2. On transition to unlocked:
 *        - the lock-status region's text is CLEARED (same
 *          `lockedReason` text no longer present),
 *        - the unlock-status region announces "Payment form unlocked.
 *          Latest audit prefill loaded successfully." with proper
 *          `role="status"` + `aria-live="polite"` + `aria-atomic`,
 *        - the unlock region lives OUTSIDE the inert subtree so AT
 *          actually reads it.
 *   3. The unlock message auto-clears after ~4s so it does not linger.
 *   4. If the form locks again later, the unlock message is cleared
 *      eagerly (so the next unlock will fire a fresh announcement).
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/audit", () => ({
  logPaymentBlocked: vi.fn(async () => null),
  logPaymentUnlock: vi.fn(async () => null),
}));
vi.mock("@/integrations/supabase/client", () => {
  const b: any = {};
  const p = () => b;
  b.select = p; b.eq = p; b.in = p; b.like = p; b.gte = p; b.lte = p;
  b.not = p; b.is = p; b.update = p; b.delete = p;
  b.order = () => Promise.resolve({ data: [], error: null });
  b.limit = () => Promise.resolve({ data: [], error: null });
  b.maybeSingle = () => Promise.resolve({ data: null, error: null });
  b.single = () => Promise.resolve({ data: null, error: null });
  b.insert = () => Promise.resolve({ data: null, error: null });
  b.upsert = () => Promise.resolve({ data: null, error: null });
  return { supabase: { from: () => b } };
});

import { PaymentForm } from "@/components/PaymentForm";

const REASON =
  "Couldn't load the blocked attempt: boom Try opening it again from the Audit Log.";
const UNLOCK_MSG =
  "Payment form unlocked. Latest audit prefill loaded successfully.";

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWith(locked: boolean, lockedReason: string | undefined) {
  return render(
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter>
        <TooltipProvider delayDuration={0}>
          <PaymentForm
            initial={{
              receipt_no: "PAY-00099",
              booking_id: "BK-1",
              amount: 1234,
              payment_mode: "Cash",
              payment_head: "Installment",
            }}
            locked={locked}
            lockedReason={lockedReason}
            onCancel={() => {}}
            onSaved={() => {}}
          />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  (Element.prototype as any).scrollIntoView = vi.fn();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("PaymentForm: aria-live unlock announcement on locked → unlocked transition", () => {
  it("on retry success: lock text clears, unlock message is announced, auto-clears after ~4s", () => {
    const { rerender } = renderWith(true, REASON);

    // ---- Locked baseline.
    const lockStatus = screen.getByTestId("payment-form-lock-status");
    expect(lockStatus.textContent).toBe(REASON);

    const unlockStatus = screen.getByTestId("payment-form-unlock-status");
    expect(unlockStatus).toHaveAttribute("role", "status");
    expect(unlockStatus).toHaveAttribute("aria-live", "polite");
    expect(unlockStatus).toHaveAttribute("aria-atomic", "true");
    // Outside the inert form subtree so SR actually reads it.
    expect(unlockStatus.closest("[inert]")).toBeNull();
    // Empty while locked.
    expect((unlockStatus.textContent ?? "").trim()).toBe("");

    // ---- Transition: parent unlocks (retry succeeded, no reason).
    rerender(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter>
          <TooltipProvider delayDuration={0}>
            <PaymentForm
              initial={{
                receipt_no: "PAY-00099",
                booking_id: "BK-1",
                amount: 1234,
                payment_mode: "Cash",
                payment_head: "Installment",
              }}
              locked={false}
              lockedReason={undefined}
              onCancel={() => {}}
              onSaved={() => {}}
            />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Lock text cleared — the exact failure reason no longer present.
    const lockStatusAfter = screen.getByTestId("payment-form-lock-status");
    expect((lockStatusAfter.textContent ?? "").trim()).toBe("");
    expect(lockStatusAfter.textContent ?? "").not.toContain(REASON);

    // Unlock message announced.
    const unlockAfter = screen.getByTestId("payment-form-unlock-status");
    expect(unlockAfter).toHaveAttribute("aria-live", "polite");
    expect(unlockAfter).toHaveAttribute("aria-atomic", "true");
    expect(unlockAfter.closest("[inert]")).toBeNull();
    expect(unlockAfter.textContent).toBe(UNLOCK_MSG);

    // ---- Auto-clear after ~4s.
    act(() => { vi.advanceTimersByTime(4000); });
    const unlockCleared = screen.getByTestId("payment-form-unlock-status");
    expect((unlockCleared.textContent ?? "").trim()).toBe("");
  });

  it("re-locking before the auto-clear: unlock message is cleared eagerly so the NEXT unlock re-announces fresh", () => {
    const { rerender } = renderWith(true, REASON);

    // Unlock.
    rerender(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter>
          <TooltipProvider delayDuration={0}>
            <PaymentForm
              initial={{
                receipt_no: "PAY-00099",
                booking_id: "BK-1",
                amount: 1234,
                payment_mode: "Cash",
                payment_head: "Installment",
              }}
              locked={false}
              onCancel={() => {}}
              onSaved={() => {}}
            />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("payment-form-unlock-status").textContent).toBe(UNLOCK_MSG);

    // Re-lock immediately (e.g. user navigates to a new failing audit).
    rerender(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter>
          <TooltipProvider delayDuration={0}>
            <PaymentForm
              initial={{
                receipt_no: "PAY-00099",
                booking_id: "BK-1",
                amount: 1234,
                payment_mode: "Cash",
                payment_head: "Installment",
              }}
              locked
              lockedReason={REASON}
              onCancel={() => {}}
              onSaved={() => {}}
            />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Unlock region cleared the moment we re-lock.
    expect((screen.getByTestId("payment-form-unlock-status").textContent ?? "").trim()).toBe("");
    // Lock status now carries the new reason.
    expect(screen.getByTestId("payment-form-lock-status").textContent).toBe(REASON);

    // Unlock again → fresh announcement fires.
    rerender(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter>
          <TooltipProvider delayDuration={0}>
            <PaymentForm
              initial={{
                receipt_no: "PAY-00099",
                booking_id: "BK-1",
                amount: 1234,
                payment_mode: "Cash",
                payment_head: "Installment",
              }}
              locked={false}
              onCancel={() => {}}
              onSaved={() => {}}
            />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("payment-form-unlock-status").textContent).toBe(UNLOCK_MSG);
  });

  it("never-locked: unlock region stays empty (no spurious 'unlocked' announcement on initial mount)", () => {
    renderWith(false, undefined);
    expect((screen.getByTestId("payment-form-unlock-status").textContent ?? "").trim()).toBe("");
    expect((screen.getByTestId("payment-form-lock-status").textContent ?? "").trim()).toBe("");
  });
});
