import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Accessibility test for PaymentForm's parent-driven lock.
 *
 * Scenario simulated: the latest audit prefill fetch FAILED in the parent
 * route. The parent re-renders PaymentForm with `locked={true}` so the
 * user can see the form, but every control inside must be fully
 * inaccessible:
 *
 *   - the form root carries `aria-disabled="true"` and is marked `inert`,
 *     so no keyboard focus can land on any descendant,
 *   - the Submit button is disabled (no `Enter`-press save path),
 *   - representative inputs render their native `disabled` attribute
 *     (browsers + a11y trees treat these as non-focusable and announce
 *     them as disabled).
 *
 * The Cancel button lives INSIDE the locked region too — that is
 * intentional. The parent owns the escape (Retry / Dismiss banner) and
 * we must not let any keypress reach the form while the prefill state
 * is unresolved.
 */

// ---------------------------------------------------------------- mocks

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/audit", () => ({
  logPaymentBlocked: vi.fn(async () => null),
  logPaymentUnlock: vi.fn(async () => null),
}));

// Generic empty/no-op supabase builder. Every PaymentForm query (bookings,
// payment-blocked-history, payments select, etc.) resolves with an empty
// list so the form renders deterministically.
vi.mock("@/integrations/supabase/client", () => {
  const builder: any = {};
  const passthrough = () => builder;
  builder.select = passthrough;
  builder.eq = passthrough;
  builder.in = passthrough;
  builder.like = passthrough;
  builder.gte = passthrough;
  builder.lte = passthrough;
  builder.not = passthrough;
  builder.is = passthrough;
  builder.order = () => Promise.resolve({ data: [], error: null });
  builder.limit = () => Promise.resolve({ data: [], error: null });
  builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
  builder.single = () => Promise.resolve({ data: null, error: null });
  builder.insert = () => Promise.resolve({ data: null, error: null });
  builder.update = passthrough;
  builder.upsert = () => Promise.resolve({ data: null, error: null });
  builder.delete = passthrough;
  return {
    supabase: {
      from: () => builder,
    },
  };
});

import { PaymentForm } from "@/components/PaymentForm";

// ---------------------------------------------------------------- harness

function renderForm(locked: boolean) {
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
            locked={locked}
            onCancel={() => {}}
            onSaved={() => {}}
          />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function getFormRoot(): HTMLElement {
  const root = document.querySelector('[role="group"][aria-label="Payment form"]');
  if (!root) throw new Error("Payment form root not found");
  return root as HTMLElement;
}

beforeEach(() => {
  // jsdom doesn't implement scrollIntoView for the inputs inside cmdk etc.
  // Stub it so any focus / range pokes are harmless.
  (Element.prototype as any).scrollIntoView = vi.fn();
});

afterEach(() => cleanup());

// ---------------------------------------------------------------- tests

describe("PaymentForm: parent-driven lock during latest audit fetch failure", () => {
  it("renders a sealed form: aria-disabled + inert on root, Submit + inputs disabled, no Cancel escape from inside", () => {
    renderForm(true);

    const root = getFormRoot();

    // 1. Root is announced as disabled.
    expect(root.getAttribute("aria-disabled")).toBe("true");
    expect(root.getAttribute("data-locked")).toBe("true");
    expect(root.getAttribute("data-locked-source")).toBe("parent");

    // 2. Root is `inert` — sequential keyboard focus, hit-testing, and AT
    //    interaction are all blocked for every descendant.
    expect(root.hasAttribute("inert")).toBe(true);

    // 3. Submit button (the primary save path) is disabled. Match the
    //    "Record payment" label rendered for non-edit (new save) mode.
    //    With `hidden: true` we still scan disabled subtrees.
    const submit = within(root).getByRole("button", {
      name: /record payment|save changes/i,
      hidden: true,
    });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("disabled");

    // 4. Representative input controls render their native `disabled`
    //    attribute (browsers exclude disabled form controls from tab
    //    order and expose them as disabled in the a11y tree).
    const disabledInputs = root.querySelectorAll<HTMLElement>(
      "input[disabled], textarea[disabled], button[disabled]",
    );
    expect(disabledInputs.length).toBeGreaterThan(0);

    // 5. No tabbable element inside the inert region. We assert by
    //    walking every focusable selector and confirming each one
    //    either has `disabled` or lives under an inert ancestor (the
    //    form root). This is the property we actually care about —
    //    the user cannot tab into any control here.
    const focusables = root.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    for (const el of Array.from(focusables)) {
      const hasDisabled =
        (el as HTMLInputElement | HTMLButtonElement).disabled === true;
      const underInert = !!el.closest("[inert]");
      expect(hasDisabled || underInert).toBe(true);
    }
  });

  it("when unlocked: no aria-disabled, no inert, Submit + inputs are interactive again", () => {
    renderForm(false);

    const root = getFormRoot();

    // aria-disabled and inert are absent when not locked.
    expect(root.getAttribute("aria-disabled")).toBeNull();
    expect(root.hasAttribute("inert")).toBe(false);
    expect(root.getAttribute("data-locked")).toBeNull();

    // Submit is reachable and NOT disabled (no blocked-audit, no
    // invariant failure for this Cash/1234/Installment payload).
    const submit = within(root).getByRole("button", {
      name: /record payment|save changes/i,
    });
    expect(submit).not.toBeDisabled();
  });
});
