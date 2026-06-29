import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Keyboard shortcut for the locked PaymentForm Retry action:
 *
 *   - Pressing "R" (or "r") anywhere on the page fires `onRetry`
 *     without requiring focus on the in-form Retry button.
 *   - The shortcut is only active when `locked` is true AND `onRetry`
 *     is provided (so it does not steal "R" on normal pages).
 *   - The shortcut is suppressed inside text-input contexts (input,
 *     textarea, select, contentEditable) so typing the letter "r"
 *     into a search field still types a letter.
 *   - Modifier combos (Ctrl/Alt/Meta + R) are ignored so we don't
 *     hijack browser/OS shortcuts like Cmd+R / Ctrl+R reload.
 *   - The button advertises the shortcut via `aria-keyshortcuts="R"`
 *     and a visible `<kbd>R</kbd>` hint.
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

function renderForm(props: { locked: boolean; onRetry?: () => void }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TooltipProvider delayDuration={0}>
          <input data-testid="outside-search" placeholder="search" />
          <PaymentForm
            initial={{
              receipt_no: "PAY-00099",
              booking_id: "BK-1",
              amount: 1234,
              payment_mode: "Cash",
              payment_head: "Installment",
            }}
            locked={props.locked}
            lockedReason={
              props.locked
                ? "Couldn't load the blocked attempt: boom Try opening it again from the Audit Log."
                : undefined
            }
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

function pressKey(key: string, opts: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { key, ...opts });
}

describe("PaymentForm: 'R' keyboard shortcut triggers the locked Retry action without focusing the button", () => {
  it("locked + onRetry: pressing 'R' on document fires onRetry — focus stays on the original element", () => {
    const onRetry = vi.fn();
    renderForm({ locked: true, onRetry });

    // Park focus on a non-input element (body) so pressing R doesn't
    // type into anything. Explicitly NOT focusing the Retry button.
    document.body.focus();
    const retryBtn = screen.getByTestId("payment-form-lock-retry");
    expect(document.activeElement).not.toBe(retryBtn);

    pressKey("R");
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Lowercase also works.
    pressKey("r");
    expect(onRetry).toHaveBeenCalledTimes(2);

    // The shortcut did NOT move focus to the Retry button.
    expect(document.activeElement).not.toBe(retryBtn);
  });

  it("button advertises the shortcut via aria-keyshortcuts and a visible kbd hint", () => {
    renderForm({ locked: true, onRetry: vi.fn() });
    const retry = screen.getByTestId("payment-form-lock-retry");
    expect(retry.getAttribute("aria-keyshortcuts")).toBe("R");
    expect(retry.getAttribute("aria-label")).toMatch(/keyboard shortcut: r/i);
    expect(retry.querySelector("kbd")?.textContent).toBe("R");
  });

  it("not locked: 'R' does NOT fire onRetry (shortcut is scoped to the locked state)", () => {
    const onRetry = vi.fn();
    renderForm({ locked: false, onRetry });
    pressKey("R");
    pressKey("r");
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("no onRetry provided: 'R' is a no-op (parent didn't opt in)", () => {
    renderForm({ locked: true });
    // Just verifying nothing throws and the button isn't rendered.
    expect(screen.queryByTestId("payment-form-lock-retry")).not.toBeInTheDocument();
    pressKey("R"); // should not throw
  });

  it("modifier combos (Ctrl/Alt/Meta + R) are ignored so browser shortcuts are not hijacked", () => {
    const onRetry = vi.fn();
    renderForm({ locked: true, onRetry });

    pressKey("r", { ctrlKey: true });
    pressKey("r", { metaKey: true });
    pressKey("r", { altKey: true });
    expect(onRetry).not.toHaveBeenCalled();

    // Plain "r" still works after modifier presses were ignored.
    pressKey("r");
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("typing 'r' in an input/textarea/select/contentEditable does NOT trigger the shortcut", () => {
    const onRetry = vi.fn();
    renderForm({ locked: true, onRetry });

    const input = screen.getByTestId("outside-search") as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: "r" });
    expect(onRetry).not.toHaveBeenCalled();

    // textarea
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    fireEvent.keyDown(ta, { key: "r" });
    expect(onRetry).not.toHaveBeenCalled();
    ta.remove();

    // select
    const sel = document.createElement("select");
    document.body.appendChild(sel);
    sel.focus();
    fireEvent.keyDown(sel, { key: "r" });
    expect(onRetry).not.toHaveBeenCalled();
    sel.remove();

    // contentEditable
    const ce = document.createElement("div");
    ce.setAttribute("contenteditable", "true");
    document.body.appendChild(ce);
    ce.focus();
    fireEvent.keyDown(ce, { key: "r" });
    expect(onRetry).not.toHaveBeenCalled();
    ce.remove();

    // Sanity: pressing R on body still fires.
    document.body.focus();
    pressKey("R");
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shortcut is removed once the form unlocks: pressing 'R' after unlock does not call onRetry", () => {
    const onRetry = vi.fn();
    const { rerender } = renderForm({ locked: true, onRetry });
    pressKey("R");
    expect(onRetry).toHaveBeenCalledTimes(1);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <TooltipProvider delayDuration={0}>
            <input data-testid="outside-search" placeholder="search" />
            <PaymentForm
              initial={{
                receipt_no: "PAY-00099",
                booking_id: "BK-1",
                amount: 1234,
                payment_mode: "Cash",
                payment_head: "Installment",
              }}
              locked={false}
              onRetry={onRetry}
              onCancel={() => {}}
              onSaved={() => {}}
            />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    pressKey("R");
    expect(onRetry).toHaveBeenCalledTimes(1); // still 1, no extra call
  });
});
