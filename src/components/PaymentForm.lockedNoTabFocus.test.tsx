import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * While the latest audit fetch is failing in the parent route, the parent
 * passes `locked={true}` to PaymentForm. This test simulates real keyboard
 * usage (`Tab` / `Shift+Tab`) and asserts that focus NEVER lands on any
 * control inside the locked form — sentinels placed before and after the
 * form are the only reachable stops.
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

beforeEach(() => {
  (Element.prototype as any).scrollIntoView = vi.fn();
});
afterEach(() => cleanup());

describe("PaymentForm: locked → keyboard Tab cannot focus any control inside", () => {
  it("Tab walks straight past every control in the form; focus only lands on the outer sentinels", async () => {
    const user = userEvent.setup();
    renderHarness(true);

    const before = document.querySelector('[data-testid="before"]') as HTMLElement;
    const after = document.querySelector('[data-testid="after"]') as HTMLElement;
    const root = getFormRoot();

    before.focus();
    expect(document.activeElement).toBe(before);

    // Tab forward several times — each stop must NOT be inside the locked
    // form. With the root `inert`, the only next stop is `after`.
    for (let i = 0; i < 25; i++) {
      await user.tab();
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) break;
      expect(root.contains(active)).toBe(false);
      if (active === after) break;
    }
    expect(document.activeElement).toBe(after);

    // Tab backward from `after` — again, no stop inside the form.
    for (let i = 0; i < 25; i++) {
      await user.tab({ shift: true });
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) break;
      expect(root.contains(active)).toBe(false);
      if (active === before) break;
    }
    expect(document.activeElement).toBe(before);

    // Direct .focus() calls on every focusable inside also fail to move
    // focus while the ancestor is inert.
    const focusables = root.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusables.length).toBeGreaterThan(0);
    for (const el of Array.from(focusables)) {
      before.focus();
      el.focus();
      expect(document.activeElement).not.toBe(el);
    }
  });

  it("control: unlocked form IS keyboard-reachable (sanity check the harness)", async () => {
    const user = userEvent.setup();
    renderHarness(false);

    const before = document.querySelector('[data-testid="before"]') as HTMLElement;
    const root = getFormRoot();

    before.focus();
    let landedInside = false;
    for (let i = 0; i < 40; i++) {
      await user.tab();
      const active = document.activeElement as HTMLElement | null;
      if (active && root.contains(active)) {
        landedInside = true;
        break;
      }
      if (!active || active === document.body) break;
    }
    expect(landedInside).toBe(true);
  });
});
