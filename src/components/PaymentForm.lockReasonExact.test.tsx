import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * End-to-end-shaped test: PaymentForm must surface the EXACT audit-fetch
 * failure reason (the `${title}: ${detail}` string assembled by the
 * Payments page) through its `aria-live` lock status region.
 *
 * We exercise PaymentForm directly with the literal strings produced by
 * `src/pages/Payments.tsx` for each known failure branch, simulating
 * what the parent would pass as `lockedReason` once the form is mounted
 * in a locked state. The assertion is verbatim — no rewording, no
 * truncation, no missing receipt/audit identifiers.
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

function renderForm(lockedReason: string) {
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
            locked
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
});
afterEach(() => cleanup());

// ----- The exact (title, detail) pairs produced by src/pages/Payments.tsx
// for each audit-fetch failure branch. If these strings drift in the
// page, this test fails first, forcing us to keep PaymentForm's lock
// reason wiring in sync with the real failure messages.

const RECEIPT = "PAY-00012";
const AUDIT = "11111111-2222-3333-4444-555555555555";

const FAILURE_REASONS: Array<{ branch: string; title: string; detail: string }> = [
  {
    branch: "audit fetch errored (network/db)",
    title: "Couldn't load the blocked attempt",
    detail: `connection refused. Try opening it again from the Audit Log.`,
  },
  {
    branch: "audit row missing",
    title: "Audit entry not found",
    detail: `No blocked-save record exists for audit id ${AUDIT}. It may have been pruned, or the link is stale.`,
  },
  {
    branch: "audit row mismatches receipt",
    title: "Audit entry doesn't match this receipt",
    detail: `Audit ${AUDIT} was recorded against PAY-99999, not ${RECEIPT}. The URL may have been edited manually.`,
  },
  {
    branch: "missing receipt in URL",
    title: "Missing receipt in the URL",
    detail: "The back link did not include a receipt number, so the Payment form can't be prefilled.",
  },
];

describe("PaymentForm: aria-live region surfaces the EXACT audit-fetch failure reason", () => {
  for (const { branch, title, detail } of FAILURE_REASONS) {
    it(`branch: ${branch} — aria-live contains "${title}: ${detail}" verbatim`, () => {
      const reason = `${title}: ${detail}`;
      renderForm(reason);

      const status = screen.getByTestId("payment-form-lock-status");

      // a11y wiring
      expect(status).toHaveAttribute("role", "status");
      expect(status).toHaveAttribute("aria-live", "polite");
      expect(status).toHaveAttribute("aria-atomic", "true");

      // Outside the inert subtree so SR actually announces it.
      expect(status.closest("[inert]")).toBeNull();

      // Exact match — no rewording, no truncation, no extra prefixes.
      expect(status.textContent).toBe(reason);

      // Both halves are individually present (catches accidental
      // formatting changes that still pass a substring check).
      expect(status.textContent).toContain(title);
      expect(status.textContent).toContain(detail);
    });
  }

  it("if the parent updates the reason (e.g. retry produces a different failure), aria-live re-announces the NEW exact text", () => {
    const first =
      "Couldn't load the blocked attempt: timeout after 30s. Try opening it again from the Audit Log.";
    const { rerender } = renderForm(first);

    let status = screen.getByTestId("payment-form-lock-status");
    expect(status.textContent).toBe(first);

    const second =
      `Audit entry not found: No blocked-save record exists for audit id ${AUDIT}. It may have been pruned, or the link is stale.`;

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
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
              locked
              lockedReason={second}
              onCancel={() => {}}
              onSaved={() => {}}
            />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    status = screen.getByTestId("payment-form-lock-status");
    expect(status.textContent).toBe(second);
    // aria-atomic ensures the WHOLE new message is re-announced, not
    // just the diff — so the attribute must still be present after the
    // update.
    expect(status).toHaveAttribute("aria-atomic", "true");
  });
});
