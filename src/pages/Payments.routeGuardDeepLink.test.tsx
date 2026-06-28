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
 * Route guard: when the URL contains a deep link
 * (`?openReceipt=...&audit=...`), the PaymentForm must be UNREACHABLE
 * until the latest audit prefill fetch succeeds. This blocks both:
 *   - direct navigation / deep link mounting the form, and
 *   - the user clicking the "Record payment" button to bypass the
 *     pending/failed prefill.
 *
 * Failure case:  prefill fetch fails → button disabled, clicks no-op,
 *                form never mounts.
 * Success case:  prefill fetch succeeds → button re-enabled AND the
 *                form auto-mounts exactly once with the audit prefill.
 */

type MountSnapshot = {
  receipt: string;
  bookingId: string;
  amount: number | string;
  prefillAuditId: string | null;
};
const formMounts: MountSnapshot[] = [];

vi.mock("@/components/PaymentForm", () => ({
  PAYMENT_TYPES: ["Cash", "Bank Transfer", "Adjustment/Asset"],
  PaymentForm: (props: any) => {
    formMounts.push({
      receipt: props.initial?.receipt_no ?? "",
      bookingId: props.initial?.booking_id ?? "",
      amount: props.initial?.amount ?? "",
      prefillAuditId: props.prefillAuditId ?? null,
    });
    return (
      <form data-testid="payment-form-stub">
        <button type="submit" data-testid="payment-form-submit">Save</button>
        <button type="button" data-testid="payment-form-cancel">Cancel</button>
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

const SUCCESS_PAYLOADS: Record<string, { entity_id: string; after: any }> = {
  "AUDIT-G": {
    entity_id: "PAY-G",
    after: { booking_id: "BK-G", payment_mode: "Cash", amount: 4242, payment_head: "Down Payment" },
  },
};

const callModes = new Map<string, Array<"success" | "missing" | "error">>();
type Deferred = {
  auditId: string;
  callIdx: number;
  resolve: () => void;
};
const deferreds: Deferred[] = [];
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
            const payload = SUCCESS_PAYLOADS[auditId];
            resolveFn({
              data: payload ? { entity_id: payload.entity_id, after: payload.after } : null,
              error: null,
            });
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

function findDeferred(auditId: string, callIdx: number): Deferred {
  const d = deferreds.find((x) => x.auditId === auditId && x.callIdx === callIdx);
  if (!d) throw new Error(`no deferred for ${auditId}#${callIdx}`);
  return d;
}

function expectFormAbsent() {
  expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
  expect(screen.queryByTestId("payment-form-submit")).not.toBeInTheDocument();
  expect(screen.queryByTestId("payment-form-cancel")).not.toBeInTheDocument();
}

beforeEach(() => {
  formMounts.length = 0;
  deferreds.length = 0;
  fetchCountByAudit.clear();
  callModes.clear();
});
afterEach(() => cleanup());

describe("Payments: deep-link route guard keeps PaymentForm inaccessible until latest prefill succeeds", () => {
  it("FAILURE — deep link with failed prefill: Record payment button is disabled, clicks do NOT mount the form", async () => {
    callModes.set("AUDIT-G", ["error"]);

    renderApp("/payments?openReceipt=PAY-G&audit=AUDIT-G");

    // While the prefill fetch is pending, the button is already locked
    // (deep link present, no replayInitial yet) and the form is absent.
    const recordBtn = screen.getByRole("button", { name: /record payment/i });
    expect(recordBtn).toBeDisabled();
    expectFormAbsent();

    // User tries to bypass the guard by clicking the button — no-op.
    await act(async () => { fireEvent.click(recordBtn); await Promise.resolve(); });
    expectFormAbsent();
    expect(formMounts.length).toBe(0);

    // Resolve the fetch as an ERROR → banner appears, guard stays armed.
    await waitFor(() => expect(deferreds.length).toBe(1));
    await act(async () => {
      findDeferred("AUDIT-G", 1).resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    // Button must STILL be disabled after the failure — the form must
    // not be reachable while the latest prefill is unresolved.
    const recordBtnAfter = screen.getByRole("button", { name: /record payment/i });
    expect(recordBtnAfter).toBeDisabled();
    expect(recordBtnAfter).toHaveAttribute("aria-disabled", "true");
    expectFormAbsent();

    // Multiple click attempts on the locked button are no-ops.
    await act(async () => {
      fireEvent.click(recordBtnAfter);
      fireEvent.click(recordBtnAfter);
      await Promise.resolve();
    });
    expectFormAbsent();
    expect(formMounts.length).toBe(0);

    // Only the one fetch for the deep-link audit happened.
    expect(fetchCountByAudit.get("AUDIT-G")).toBe(1);
    expect([...fetchCountByAudit.keys()]).toEqual(["AUDIT-G"]);
  });

  it("SUCCESS — deep link with successful prefill: button unlocks AND the form auto-mounts exactly once with the audit prefill", async () => {
    callModes.set("AUDIT-G", ["success"]);

    renderApp("/payments?openReceipt=PAY-G&audit=AUDIT-G");

    // Before resolution, guard is armed — button disabled, form absent.
    expect(screen.getByRole("button", { name: /record payment/i })).toBeDisabled();
    expectFormAbsent();
    expect(formMounts.length).toBe(0);

    await waitFor(() => expect(deferreds.length).toBe(1));
    // While the fetch is still pending, a click on the locked button
    // must NOT race-mount the form with empty prefill.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
      await Promise.resolve();
    });
    expectFormAbsent();
    expect(formMounts.length).toBe(0);

    // Resolve SUCCESS → guard lifts AND replay effect opens the form
    // with the audit's prefill (existing behavior).
    await act(async () => {
      findDeferred("AUDIT-G", 1).resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );

    // Button is no longer disabled now that the latest prefill is in.
    // (Radix Dialog sets aria-hidden on the rest of the page while open,
    // so query with { hidden: true } to reach the underlying button.)
    expect(
      screen.getByRole("button", { name: /record payment/i, hidden: true }),
    ).not.toBeDisabled();


    // Form mounted EXACTLY ONCE with AUDIT-G's prefill — no empty
    // mount snuck through during the pending window.
    expect(formMounts.length).toBe(1);
    expect(formMounts[0]).toMatchObject({
      receipt: "PAY-G",
      bookingId: "BK-G",
      amount: 4242,
      prefillAuditId: "AUDIT-G",
    });

    // No error banner.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Exactly one fetch for the deep-link audit.
    expect(fetchCountByAudit.get("AUDIT-G")).toBe(1);
    expect([...fetchCountByAudit.keys()]).toEqual(["AUDIT-G"]);
  });
});
