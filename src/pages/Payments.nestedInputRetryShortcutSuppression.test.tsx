import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  act,
  fireEvent,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Integration test: while the latest audit prefill fetch is failing
 * (banner up, PaymentForm absent), pressing the "R" key while typing
 * inside any of the Payments page's nested filter inputs (the real
 * search Input rendered after load, and synthetic <textarea> /
 * contenteditable elements nested in the page subtree) must NEVER
 * trigger the replay retry handler:
 *
 *   - No additional audit fetch is issued.
 *   - The failure banner stays in place.
 *   - The user's "R" keystroke is delivered to the input (the page
 *     handler must NOT preventDefault it).
 *   - Modifier-less plain "R" pressed on the document body (no input
 *     focused) DOES still trigger the retry — confirming the
 *     suppression is scoped to text-entry contexts and the handler
 *     itself is alive.
 */

const formMounts: Array<{ prefillAuditId: string | null }> = [];

vi.mock("@/components/PaymentForm", () => ({
  PAYMENT_TYPES: ["Cash", "Bank Transfer", "Adjustment/Asset"],
  PaymentForm: (props: any) => {
    formMounts.push({ prefillAuditId: props.prefillAuditId ?? null });
    return <form data-testid="payment-form-stub" />;
  },
}));
vi.mock("@/components/PaymentReceipt", () => ({ PaymentReceipt: () => null }));
vi.mock("@/components/PageHeader", () => ({
  PageHeader: ({ title, actions }: any) => (
    <div>
      <h1>{title}</h1>
      <div>{actions}</div>
    </div>
  ),
}));

const SUCCESS_PAYLOAD = {
  entity_id: "PAY-X",
  after: {
    booking_id: "BK-X",
    payment_mode: "Bank Transfer",
    amount: 77777,
    payment_head: "Installment",
  },
};
const callModes = new Map<string, Array<"success" | "missing" | "error">>();
const deferreds: Array<{ auditId: string; callIdx: number; resolve: () => void }> = [];
const fetchCountByAudit = new Map<string, number>();

vi.mock("@/integrations/supabase/client", () => {
  const auditBuilder = () => {
    let queriedAuditId: string | null = null;
    const b: any = {};
    b.select = () => b;
    b.eq = (col: string, val: string) => {
      if (col === "id") queriedAuditId = val;
      return b;
    };
    b.order = () => b;
    b.maybeSingle = () => {
      const auditId = queriedAuditId ?? "";
      const callIdx = (fetchCountByAudit.get(auditId) ?? 0) + 1;
      fetchCountByAudit.set(auditId, callIdx);
      let resolveFn!: (v: { data: any; error: any }) => void;
      const promise = new Promise<{ data: any; error: any }>((r) => {
        resolveFn = r;
      });
      const seq = callModes.get(auditId) ?? ["missing"];
      const mode = seq[Math.min(callIdx - 1, seq.length - 1)];
      deferreds.push({
        auditId,
        callIdx,
        resolve: () => {
          if (mode === "success") {
            resolveFn({ data: SUCCESS_PAYLOAD, error: null });
          } else if (mode === "error") {
            resolveFn({ data: null, error: { message: "boom" } });
          } else {
            resolveFn({ data: null, error: null });
          }
        },
      });
      return promise;
    };
    return b;
  };
  const paymentsBuilder = () => {
    const b: any = {};
    b.select = () => b;
    b.order = () => Promise.resolve({ data: [], error: null });
    return b;
  };
  return {
    supabase: {
      from: (table: string) =>
        table === "audit_logs" ? auditBuilder() : paymentsBuilder(),
    },
  };
});

import Payments from "./Payments";

function renderApp(initial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/payments" element={<Payments />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function findDeferred(auditId: string, callIdx: number) {
  const d = deferreds.find((x) => x.auditId === auditId && x.callIdx === callIdx);
  if (!d) throw new Error(`no deferred ${auditId}#${callIdx}`);
  return d;
}

beforeEach(() => {
  formMounts.length = 0;
  deferreds.length = 0;
  fetchCountByAudit.clear();
  callModes.clear();
});
afterEach(() => cleanup());

describe("Payments: 'R' inside nested filter inputs never triggers the replay retry", () => {
  it("typing R into the search Input, a nested <textarea>, or a contenteditable inside the page subtree never re-fetches the audit; plain R on the body still does", async () => {
    callModes.set("AUDIT-X", ["missing", "missing", "success"]);
    renderApp("/payments?openReceipt=PAY-X&audit=AUDIT-X");

    // Wait for the failing first audit fetch to resolve → banner up.
    await waitFor(() => expect(deferreds.length).toBe(1));
    await act(async () => {
      findDeferred("AUDIT-X", 1).resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const banner = await screen.findByTestId("replay-error-banner");
    expect(banner).toBeInTheDocument();
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(fetchCountByAudit.get("AUDIT-X")).toBe(1);

    // --- The real, post-load search Input ---
    const search = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
    expect(search.tagName).toBe("INPUT");
    search.focus();
    expect(document.activeElement).toBe(search);

    // Lower + uppercase + shifted R — none should hijack into a retry.
    for (const key of ["r", "R"]) {
      for (const opts of [{}, { shiftKey: true }]) {
        const evt = fireEvent.keyDown(search, { key, ...opts });
        // The handler must NOT have called preventDefault on this keystroke.
        // (fireEvent.keyDown returns false when defaultPrevented.)
        expect(evt).toBe(true);
      }
    }
    expect(fetchCountByAudit.get("AUDIT-X")).toBe(1);
    expect(screen.getByTestId("replay-error-banner")).toBeInTheDocument();

    // Type into the input to confirm it still accepts text input
    // (sanity check that the page didn't blow away/disable it).
    fireEvent.change(search, { target: { value: "Receipt-R" } });
    expect(search.value).toBe("Receipt-R");
    expect(fetchCountByAudit.get("AUDIT-X")).toBe(1);

    // --- A <textarea> nested under the page subtree ---
    // (Mounted in the rendered tree's container so it's a legitimate
    // descendant — same window keydown listener will see it.)
    const ta = document.createElement("textarea");
    ta.setAttribute("data-testid", "nested-textarea");
    banner.parentElement!.appendChild(ta);
    ta.focus();
    expect(document.activeElement).toBe(ta);
    const taEvt = fireEvent.keyDown(ta, { key: "R" });
    expect(taEvt).toBe(true);
    expect(fetchCountByAudit.get("AUDIT-X")).toBe(1);
    expect(screen.getByTestId("replay-error-banner")).toBeInTheDocument();

    // --- A contenteditable element nested under the page subtree ---
    const ce = document.createElement("div");
    ce.setAttribute("contenteditable", "true");
    ce.setAttribute("data-testid", "nested-contenteditable");
    ce.tabIndex = 0;
    banner.parentElement!.appendChild(ce);
    ce.focus();
    const ceEvt = fireEvent.keyDown(ce, { key: "r" });
    expect(ceEvt).toBe(true);
    expect(fetchCountByAudit.get("AUDIT-X")).toBe(1);

    // Plain "R" on document.body (no input focused) — the page-level
    // handler IS alive and WILL trigger a retry. Confirms the
    // suppression above is scoped, not a globally-dead listener.
    search.blur();
    ta.blur();
    ce.blur();
    document.body.focus();
    await act(async () => {
      fireEvent.keyDown(window, { key: "R" });
      await Promise.resolve();
    });
    expect(screen.queryByTestId("replay-error-banner")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchCountByAudit.get("AUDIT-X")).toBe(2));
  });
});
