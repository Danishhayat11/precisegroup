import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * While the latest audit fetch is failing in the parent route, the parent
 * passes `locked={true}` to PaymentForm. This test verifies that no
 * control inside the form can receive keyboard focus via Tab — i.e. it
 * is not present in the document's tab order at all.
 *
 * We can't rely on jsdom honoring `inert` natively for focus navigation,
 * so we compute the document's tab order the way browsers do (per the
 * HTML "tabindex-ordered focus navigation scope" rules) and assert that
 * every tabbable stop falls OUTSIDE the locked form root. We also assert
 * that each focusable element inside the form is excluded from sequential
 * focus navigation — either because it is `disabled`, has `tabindex="-1"`,
 * or sits under an `inert` ancestor (the form root itself).
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

function Harness({ locked }: { locked: boolean }) {
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
        locked={locked}
        onCancel={() => {}}
        onSaved={() => {}}
      />
      <button data-testid="after">after</button>
    </>
  );
}

function renderHarness(locked: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TooltipProvider delayDuration={0}>
          <Harness locked={locked} />
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

// Compute the document tab order the way browsers do:
//   * skip elements that are `disabled`
//   * skip elements with `tabindex="-1"`
//   * skip elements whose ancestor (or themselves) is marked `inert`
//   * skip elements with `hidden` or `display: none` / visibility hidden
function getTabOrder(): HTMLElement[] {
  const focusableSel =
    'a[href], button, input, select, textarea, [tabindex]';
  const all = Array.from(
    document.querySelectorAll<HTMLElement>(focusableSel),
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

describe("PaymentForm: while locked, no control is reachable via Tab", () => {
  it("locked=true: tab order excludes every control inside the form; only the outer sentinels remain reachable", () => {
    renderHarness(true);
    const root = getFormRoot();

    // Sanity: lock attributes are present.
    expect(root.hasAttribute("inert")).toBe(true);
    expect(root.getAttribute("aria-disabled")).toBe("true");

    // 1. The actual tab order has no stop inside the form.
    const order = getTabOrder();
    expect(order.length).toBeGreaterThanOrEqual(2); // before + after at minimum
    for (const el of order) {
      expect(root.contains(el)).toBe(false);
    }

    // 2. Both sentinels are present in the tab order (so the user CAN tab
    //    past the form — they just cannot land in it).
    const before = document.querySelector('[data-testid="before"]') as HTMLElement;
    const after = document.querySelector('[data-testid="after"]') as HTMLElement;
    expect(order).toContain(before);
    expect(order).toContain(after);

    // 3. Every focusable element inside the form is excluded from
    //    sequential focus navigation by one of the documented mechanisms.
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
  });

  it("locked=false (control): at least one control inside the form is keyboard-reachable", () => {
    renderHarness(false);
    const root = getFormRoot();

    expect(root.hasAttribute("inert")).toBe(false);
    expect(root.getAttribute("aria-disabled")).toBeNull();

    const order = getTabOrder();
    const insideForm = order.filter((el) => root.contains(el));
    expect(insideForm.length).toBeGreaterThan(0);
  });
});
