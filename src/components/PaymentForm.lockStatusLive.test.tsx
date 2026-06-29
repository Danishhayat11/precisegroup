import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * UX a11y test: when the parent passes `locked={true}` (because the
 * latest audit prefill fetch failed), PaymentForm must render an
 * `aria-live` status message explaining WHY the form is disabled.
 *
 * Contract:
 *   1. The status region exists with role="status" and aria-live="polite",
 *      and is rendered OUTSIDE the `inert` form subtree so assistive
 *      tech actually announces it.
 *   2. It contains a human-readable explanation referencing the audit
 *      fetch failure (not just "disabled").
 *   3. When the parent supplies a custom `lockedReason`, that text is
 *      used verbatim instead of the default.
 *   4. When the form is NOT locked, the message is absent / empty so
 *      nothing is announced.
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

function renderForm(props: { locked: boolean; lockedReason?: string }) {
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

describe("PaymentForm: aria-live lock status explains WHY the form is disabled", () => {
  it("locked=true: renders a polite live region with the default audit-failure explanation, OUTSIDE the inert form", () => {
    renderForm({ locked: true });

    const status = screen.getByTestId("payment-form-lock-status");

    // a11y wiring
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");

    // The status region must NOT live under the inert form subtree —
    // inert removes descendants from the accessibility tree, which
    // would silence the announcement.
    expect(status.closest("[inert]")).toBeNull();

    // Default message explains the cause (latest audit fetch failure).
    const text = status.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/audit/i);
    expect(text).toMatch(/disabled|temporarily/i);
    expect(text).toMatch(/retry/i);
  });

  it("locked=true with custom lockedReason: uses the parent-provided text verbatim", () => {
    const reason =
      "Latest audit fetch failed (network). Form is disabled until we can confirm the latest prefill.";
    renderForm({ locked: true, lockedReason: reason });

    const status = screen.getByTestId("payment-form-lock-status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status.textContent).toContain(reason);
  });

  it("locked=false: live region is present but EMPTY so nothing is announced", () => {
    renderForm({ locked: false });

    const status = screen.getByTestId("payment-form-lock-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    // No lock copy when unlocked.
    expect((status.textContent ?? "").trim()).toBe("");
  });
});
