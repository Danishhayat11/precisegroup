import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Combined a11y test for the locked PaymentForm:
 *
 *   1. The lock status live region IS announced — it carries
 *      `role="status"` + `aria-live="polite"` + `aria-atomic="true"`,
 *      lives OUTSIDE the inert form subtree (otherwise AT would
 *      ignore it), and exposes the parent-supplied reason as its
 *      accessible name / textContent.
 *
 *   2. No PaymentForm control inside the form root can receive
 *      keyboard focus via Tab — the form root is `inert`, every
 *      focusable descendant is excluded from sequential focus
 *      navigation (disabled, tabindex=-1, or under inert), and the
 *      document tab order skips the form entirely.
 *
 *   3. The only lock-related interactive control that IS reachable is
 *      the Retry button, which the parent renders alongside the live
 *      region OUTSIDE the inert subtree — by design, so the user can
 *      escape the locked state via keyboard.
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

function Harness({ onRetry }: { onRetry?: () => void }) {
  return (
    <>
      <button data-testid="before">before</button>
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
        onRetry={onRetry}
        onCancel={() => {}}
        onSaved={() => {}}
      />
      <button data-testid="after">after</button>
    </>
  );
}

function renderHarness(onRetry?: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TooltipProvider delayDuration={0}>
          <Harness onRetry={onRetry} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function getFormRoot(): HTMLElement {
  const root = document.querySelector('[role="group"][aria-label="Payment form"]');
  if (!root) throw new Error("form root missing");
  return root as HTMLElement;
}

// Browser-style tab order: visible, not disabled, not tabindex<0, not
// under an inert ancestor.
function getTabOrder(): HTMLElement[] {
  const all = Array.from(
    document.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]',
    ),
  );
  return all.filter((el) => {
    if ((el as HTMLInputElement | HTMLButtonElement).disabled) return false;
    const ti = el.getAttribute("tabindex");
    if (ti !== null && Number(ti) < 0) return false;
    if (el.closest("[inert]")) return false;
    if (el.hasAttribute("hidden")) return false;
    return true;
  });
}

beforeEach(() => {
  (Element.prototype as any).scrollIntoView = vi.fn();
});
afterEach(() => cleanup());

describe("PaymentForm locked: live region announced + zero internal controls keyboard-reachable", () => {
  it("the lock status region is wired for announcement OUTSIDE the inert subtree, and no control INSIDE the form is reachable via Tab", () => {
    const onRetry = vi.fn();
    renderHarness(onRetry);

    // ---- 1. Lock status live region is announced.
    const status = screen.getByTestId("payment-form-lock-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    // Outside inert so AT actually reads it.
    expect(status.closest("[inert]")).toBeNull();
    // Carries the exact parent-supplied reason.
    expect(status.textContent).toBe(REASON);

    // ---- 2. Form root is sealed.
    const root = getFormRoot();
    expect(root.hasAttribute("inert")).toBe(true);
    expect(root.getAttribute("aria-disabled")).toBe("true");
    expect(root.getAttribute("data-locked")).toBe("true");
    expect(root.getAttribute("data-locked-source")).toBe("parent");

    // ---- 3. Document tab order has NO stop inside the form.
    const order = getTabOrder();
    expect(order.length).toBeGreaterThanOrEqual(2);
    for (const el of order) {
      expect(root.contains(el)).toBe(false);
    }

    // Both outer sentinels are present.
    const before = document.querySelector('[data-testid="before"]') as HTMLElement;
    const after = document.querySelector('[data-testid="after"]') as HTMLElement;
    expect(order).toContain(before);
    expect(order).toContain(after);

    // ---- 4. Every focusable inside the form is excluded from
    //    sequential focus navigation by one of the documented means.
    const focusables = root.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]',
    );
    expect(focusables.length).toBeGreaterThan(0);
    for (const el of Array.from(focusables)) {
      const isDisabled =
        (el as HTMLInputElement | HTMLButtonElement).disabled === true;
      const ti = el.getAttribute("tabindex");
      const negTabIndex = ti !== null && Number(ti) < 0;
      const underInert = !!el.closest("[inert]");
      expect(isDisabled || negTabIndex || underInert).toBe(true);
    }

    // ---- 5. Disabled controls inside the form cannot receive focus
    //    even via direct .focus() — this is the browser-enforced
    //    portion (jsdom honors `disabled` for focus; full `inert`
    //    focus-blocking is browser-only, but the tab-order exclusion
    //    above is the property that matters for keyboard a11y).
    for (const el of Array.from(focusables)) {
      if ((el as HTMLInputElement | HTMLButtonElement).disabled !== true) continue;
      before.focus();
      el.focus();
      expect(document.activeElement).not.toBe(el);
    }


    // ---- 6. The Retry button (outside the inert subtree) IS in the
    //    tab order — the user always has a keyboard escape.
    const retry = screen.getByTestId("payment-form-lock-retry");
    expect(retry.closest("[inert]")).toBeNull();
    expect(order).toContain(retry);
    expect(retry.getAttribute("aria-label")).toMatch(/retry/i);

    // It also follows the live region in the DOM, so SR users hear the
    // reason before encountering the Retry control.
    const announcedBeforeRetry =
      !!(status.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(announcedBeforeRetry).toBe(true);
  });
});
