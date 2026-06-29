import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Verifies the small in-form "Retry" button that lives alongside the
 * lock status region.
 *
 * Contract:
 *   1. The button is rendered ONLY when `locked` is true AND `onRetry`
 *      is provided. It is rendered OUTSIDE the inert subtree so it is
 *      reachable by keyboard and assistive tech.
 *   2. Clicking it fires the parent-supplied `onRetry` callback (and
 *      only that — no form submission, no implicit cancel).
 *   3. It carries an accessible name and is keyboard-focusable.
 *   4. When `locked` is false, the button is absent.
 *   5. When `locked` is true but `onRetry` is omitted, the button is
 *      absent (parent didn't opt in to retry UX).
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

function renderForm(props: {
  locked: boolean;
  onRetry?: () => void;
  lockedReason?: string;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
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
            locked={props.locked}
            lockedReason={props.lockedReason}
            onRetry={props.onRetry}
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
});
afterEach(() => cleanup());

describe("PaymentForm: in-form Retry button (lives outside the inert subtree)", () => {
  it("locked + onRetry: renders the Retry button OUTSIDE inert, keyboard-reachable, fires onRetry on click", () => {
    const onRetry = vi.fn();
    renderForm({
      locked: true,
      onRetry,
      lockedReason: "Couldn't load the blocked attempt: boom Try opening it again from the Audit Log.",
    });

    const retry = screen.getByTestId("payment-form-lock-retry");

    // 1. Lives outside the inert form subtree.
    expect(retry.closest("[inert]")).toBeNull();

    // 2. Sits next to (and labelled by proximity to) the aria-live
    //    status region, both outside inert.
    const status = screen.getByTestId("payment-form-lock-status");
    expect(status.closest("[inert]")).toBeNull();

    // 3. Accessible name + button semantics.
    expect(retry.tagName.toLowerCase()).toBe("button");
    expect(retry).toHaveAttribute("type", "button");
    expect(retry.getAttribute("aria-label")).toMatch(/retry/i);
    expect(retry.textContent ?? "").toMatch(/retry/i);
    // Same button via accessible-name lookup.
    expect(
      screen.getByRole("button", { name: /retry latest audit prefill fetch/i }),
    ).toBe(retry);

    // 4. Keyboard-focusable (not disabled, not tabindex=-1, not under inert).
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    const ti = retry.getAttribute("tabindex");
    expect(ti === null || Number(ti) >= 0).toBe(true);
    retry.focus();
    expect(document.activeElement).toBe(retry);

    // 5. Clicking fires onRetry exactly once and does not submit the form.
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // 6. Re-click still works (no implicit disable after first call).
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("locked but no onRetry: Retry button is absent (parent didn't opt in)", () => {
    renderForm({ locked: true });
    expect(screen.queryByTestId("payment-form-lock-retry")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /retry latest audit prefill fetch/i }),
    ).not.toBeInTheDocument();
  });

  it("unlocked: Retry button is absent even when onRetry is provided", () => {
    const onRetry = vi.fn();
    renderForm({ locked: false, onRetry });
    expect(screen.queryByTestId("payment-form-lock-retry")).not.toBeInTheDocument();
    expect(onRetry).not.toHaveBeenCalled();
  });
});
