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
 * (PaymentForm absent under the route guard, banner up), pressing the
 * "R" keyboard shortcut on the document must:
 *
 *   1. Clear the failure banner immediately.
 *   2. Re-fetch the SAME audit id (no fan-out to other audits, no
 *      URL change required).
 *   3. On successful retry, mount PaymentForm exactly once with the
 *      audit's prefill — completing the full replay/retry flow without
 *      the user ever moving focus to the Retry button.
 *   4. Pressing R while typing into an input/textarea/etc. must NOT
 *      hijack the keystroke.
 *   5. Pressing R AFTER recovery (no replayError) must NOT trigger a
 *      spurious extra fetch.
 */

const formMounts: Array<{
  receipt: string;
  bookingId: string;
  amount: number | string;
  paymentMode: string;
  paymentHead: string;
  prefillAuditId: string | null;
}> = [];

vi.mock("@/components/PaymentForm", () => ({
  PAYMENT_TYPES: ["Cash", "Bank Transfer", "Adjustment/Asset"],
  PaymentForm: (props: any) => {
    formMounts.push({
      receipt: props.initial?.receipt_no ?? "",
      bookingId: props.initial?.booking_id ?? "",
      amount: props.initial?.amount ?? "",
      paymentMode: props.initial?.payment_mode ?? "",
      paymentHead: props.initial?.payment_head ?? "",
      prefillAuditId: props.prefillAuditId ?? null,
    });
    return (
      <form data-testid="payment-form-stub">
        <input
          data-testid="payment-form-amount"
          defaultValue={String(props.initial?.amount ?? "")}
        />
        <input
          data-testid="payment-form-receipt"
          defaultValue={String(props.initial?.receipt_no ?? "")}
        />
        <button type="submit" data-testid="payment-form-submit">Save</button>
      </form>
    );
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

function pressR(target: Window | Element = window, opts: KeyboardEventInit = {}) {
  fireEvent.keyDown(target as Element, { key: "R", ...opts });
}


beforeEach(() => {
  formMounts.length = 0;
  deferreds.length = 0;
  fetchCountByAudit.clear();
  callModes.clear();
});
afterEach(() => cleanup());

describe("Payments: 'R' shortcut triggers the replay prefill retry end-to-end", () => {
  it("MISSING → press R → SUCCESS: banner clears, same audit re-fetched, PaymentForm mounts once with the correct prefill", async () => {
    callModes.set("AUDIT-X", ["missing", "success"]);

    renderApp("/payments?openReceipt=PAY-X&audit=AUDIT-X");

    // 1. First fetch resolves MISSING → banner visible, no form mounted.
    await waitFor(() => expect(deferreds.length).toBe(1));
    await act(async () => {
      findDeferred("AUDIT-X", 1).resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const banner = await screen.findByTestId("replay-error-banner");
    expect(banner.textContent).toContain("Audit entry not found");
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);

    // 2. Ignored-context: typing R into the search input does NOT retry.
    const search = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
    search.focus();
    pressR(search);
    expect(fetchCountByAudit.get("AUDIT-X")).toBe(1); // unchanged

    // 3. Press R on the document (no input focused) → fires retry.
    document.body.focus();
    await act(async () => {
      pressR();
      await Promise.resolve();
    });

    // Banner cleared immediately, same audit re-fetched.
    expect(screen.queryByTestId("replay-error-banner")).not.toBeInTheDocument();
    await waitFor(() => expect(deferreds.length).toBe(2));
    expect(fetchCountByAudit.get("AUDIT-X")).toBe(2);

    // Form still absent while retry pending.
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();

    // 4. Resolve retry SUCCESS → form mounts with the correct prefill.
    await act(async () => {
      findDeferred("AUDIT-X", 2).resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );

    expect(formMounts.length).toBe(1);
    expect(formMounts[0]).toMatchObject({
      receipt: "PAY-X",
      bookingId: "BK-X",
      amount: 77777,
      paymentMode: "Bank Transfer",
      paymentHead: "Installment",
      prefillAuditId: "AUDIT-X",
    });
    expect(
      (screen.getByTestId("payment-form-amount") as HTMLInputElement).value,
    ).toBe("77777");
    expect(
      (screen.getByTestId("payment-form-receipt") as HTMLInputElement).value,
    ).toBe("PAY-X");

    // 5. No fan-out fetches to any other audit id.
    expect(Array.from(fetchCountByAudit.keys())).toEqual(["AUDIT-X"]);

    // 6. Pressing R AFTER recovery does NOT trigger a spurious retry
    //    (handler unsubscribed when replayError cleared).
    document.body.focus();
    pressR();
    await Promise.resolve();
    expect(fetchCountByAudit.get("AUDIT-X")).toBe(2);
    expect(formMounts.length).toBe(1);
  });

  it("modifier combos (Ctrl+R) are ignored at the page level — browser reload is not hijacked, no retry fires", async () => {
    callModes.set("AUDIT-X", ["error", "success"]);
    renderApp("/payments?openReceipt=PAY-X&audit=AUDIT-X");

    await waitFor(() => expect(deferreds.length).toBe(1));
    await act(async () => {
      findDeferred("AUDIT-X", 1).resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await screen.findByTestId("replay-error-banner");

    document.body.focus();
    pressR(window, { ctrlKey: true });
    pressR(window, { metaKey: true });
    pressR(window, { altKey: true });
    expect(fetchCountByAudit.get("AUDIT-X")).toBe(1); // unchanged

    // Plain R still fires.
    await act(async () => {
      pressR();
      await Promise.resolve();
    });
    await waitFor(() => expect(fetchCountByAudit.get("AUDIT-X")).toBe(2));
  });
});
