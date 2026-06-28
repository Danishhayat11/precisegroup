import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  act,
  fireEvent,
} from "@testing-library/react";
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Regression test: the latest audit fetch fails, the user clicks the
 * new "Retry" button in the error banner, and the SAME audit id is
 * re-fetched. On a successful retry, the PaymentForm finally mounts
 * with that audit's prefill — its controls become accessible only at
 * that moment.
 *
 * Required behavior:
 *   1. First attempt at `?openReceipt=PAY-X&audit=AUDIT-X` fails →
 *      error banner shown, no PaymentForm controls in the DOM.
 *   2. Clicking Retry:
 *        - clears the error banner immediately
 *        - re-runs the replay effect for the SAME openReceipt + audit
 *          (no URL change required)
 *        - issues a NEW fetch for AUDIT-X (fetch count for AUDIT-X
 *          goes from 1 → 2)
 *        - does NOT fetch any other audit id (no cross-audit fan-out)
 *   3. While the retry is pending, controls remain inaccessible.
 *   4. When the retry RESOLVES SUCCESSFULLY, the PaymentForm mounts
 *      exactly once with AUDIT-X's prefill, and its Submit/Cancel/
 *      field controls become accessible.
 */

type MountSnapshot = {
  receipt: string;
  bookingId: string;
  amount: number | string;
  paymentMode: string;
  paymentHead: string;
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
      paymentMode: props.initial?.payment_mode ?? "",
      paymentHead: props.initial?.payment_head ?? "",
      prefillAuditId: props.prefillAuditId ?? null,
    });
    return (
      <form data-testid="payment-form-stub">
        <input
          data-testid="payment-form-amount"
          name="amount"
          defaultValue={String(props.initial?.amount ?? "")}
        />
        <input
          data-testid="payment-form-receipt"
          name="receipt_no"
          defaultValue={String(props.initial?.receipt_no ?? "")}
        />
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

const SUCCESS_PAYLOADS: Record<
  string,
  { entity_id: string; after: { booking_id: string; payment_mode: string; amount: number; payment_head: string } }
> = {
  "AUDIT-X": { entity_id: "PAY-X", after: { booking_id: "BK-X", payment_mode: "Bank Transfer", amount: 77777, payment_head: "Installment" } },
};

// Per-call modes for a given audit id. The Nth call (1-indexed) uses
// callModes[audit][N-1] if defined, else falls back to the last
// entry. Lets us script: "first call MISSING, second call SUCCESS".
const callModes = new Map<string, Array<"success" | "missing" | "error">>();

type Deferred = {
  auditId: string;
  callIdx: number;
  promise: Promise<{ data: any; error: any }>;
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
        promise,
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

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}{loc.search}</div>;
}

function renderApp(initial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route
            path="/payments"
            element={
              <>
                <Payments />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function findDeferred(auditId: string, callIdx: number): Deferred {
  const d = deferreds.find((x) => x.auditId === auditId && x.callIdx === callIdx);
  if (!d) {
    throw new Error(
      `no deferred for ${auditId} call #${callIdx}: [${deferreds
        .map((x) => `${x.auditId}#${x.callIdx}`)
        .join(",")}]`,
    );
  }
  return d;
}

function expectFormControlsAbsent() {
  expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
  expect(screen.queryByTestId("payment-form-submit")).not.toBeInTheDocument();
  expect(screen.queryByTestId("payment-form-cancel")).not.toBeInTheDocument();
  expect(screen.queryByTestId("payment-form-amount")).not.toBeInTheDocument();
  expect(screen.queryByTestId("payment-form-receipt")).not.toBeInTheDocument();
}

beforeEach(() => {
  formMounts.length = 0;
  deferreds.length = 0;
  fetchCountByAudit.clear();
  callModes.clear();
});
afterEach(() => cleanup());

describe("Payments: Retry button re-fetches the latest audit only; controls unlock only after retry succeeds", () => {
  it("MISSING → Retry → SUCCESS: banner shows, controls absent through retry, only successful retry mounts the form", async () => {
    // First call MISSING, second call SUCCESS.
    callModes.set("AUDIT-X", ["missing", "success"]);

    renderApp("/payments?openReceipt=PAY-X&audit=AUDIT-X");

    // 1. First fetch is issued and resolves as MISSING → banner up,
    //    controls absent.
    await waitFor(() => expect(deferreds.length).toBe(1));
    expectFormControlsAbsent();

    await act(async () => {
      findDeferred("AUDIT-X", 1).resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/audit entry not found/i);
    expectFormControlsAbsent();
    expect(formMounts.length).toBe(0);
    expect(fetchCountByAudit.get("AUDIT-X")).toBe(1);

    // 2. Click Retry → banner clears, a NEW fetch for AUDIT-X is
    //    issued. Controls must still be absent while it's pending.
    const retryBtn = screen.getByRole("button", { name: /retry latest audit fetch/i });
    await act(async () => {
      fireEvent.click(retryBtn);
      await Promise.resolve();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Effect re-runs and queues a 2nd fetch for the same audit id.
    await waitFor(() => expect(fetchCountByAudit.get("AUDIT-X")).toBe(2));
    expect(deferreds.length).toBe(2);
    // No fan-out to any OTHER audit id.
    expect([...fetchCountByAudit.keys()]).toEqual(["AUDIT-X"]);
    // Controls still inaccessible while retry is pending.
    expectFormControlsAbsent();
    expect(formMounts.length).toBe(0);

    // 3. Resolve the retry SUCCESS → form mounts with AUDIT-X prefill.
    await act(async () => {
      findDeferred("AUDIT-X", 2).resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );

    // Controls are now interactive.
    expect(screen.getByTestId("payment-form-submit")).toBeInTheDocument();
    expect(screen.getByTestId("payment-form-cancel")).toBeInTheDocument();
    expect(screen.getByTestId("payment-form-amount")).toBeInTheDocument();
    expect(screen.getByTestId("payment-form-receipt")).toBeInTheDocument();

    // Exactly one mount, with AUDIT-X's payload — no leak from the
    // failed first call.
    expect(formMounts.length).toBe(1);
    expect(formMounts[0]).toMatchObject({
      receipt: "PAY-X",
      bookingId: "BK-X",
      amount: 77777,
      paymentMode: "Bank Transfer",
      paymentHead: "Installment",
      prefillAuditId: "AUDIT-X",
    });
    expect((screen.getByTestId("payment-form-amount") as HTMLInputElement).value).toBe("77777");
    expect((screen.getByTestId("payment-form-receipt") as HTMLInputElement).value).toBe("PAY-X");

    // Banner gone.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Exactly 2 fetches for AUDIT-X (initial + 1 retry). Nothing else.
    expect(fetchCountByAudit.get("AUDIT-X")).toBe(2);
    expect([...fetchCountByAudit.keys()]).toEqual(["AUDIT-X"]);
  });

  it("ERROR → Retry (still ERROR) → controls still absent, banner re-shows; second Retry → SUCCESS → form mounts", async () => {
    // Demonstrates the retry contract holds across multiple retries
    // and that only the eventual SUCCESSFUL retry unlocks controls.
    callModes.set("AUDIT-X", ["error", "error", "success"]);

    renderApp("/payments?openReceipt=PAY-X&audit=AUDIT-X");

    await waitFor(() => expect(deferreds.length).toBe(1));
    await act(async () => {
      findDeferred("AUDIT-X", 1).resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't load the blocked attempt/i);
    expectFormControlsAbsent();

    // First retry — also fails.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry latest audit fetch/i }));
      await Promise.resolve();
    });
    await waitFor(() => expect(fetchCountByAudit.get("AUDIT-X")).toBe(2));
    expectFormControlsAbsent();
    await act(async () => {
      findDeferred("AUDIT-X", 2).resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't load the blocked attempt/i);
    expectFormControlsAbsent();
    expect(formMounts.length).toBe(0);

    // Second retry — succeeds → form mounts.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry latest audit fetch/i }));
      await Promise.resolve();
    });
    await waitFor(() => expect(fetchCountByAudit.get("AUDIT-X")).toBe(3));
    // Still no form while pending.
    expectFormControlsAbsent();

    await act(async () => {
      findDeferred("AUDIT-X", 3).resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );
    expect(formMounts.length).toBe(1);
    expect(formMounts[0].prefillAuditId).toBe("AUDIT-X");
    expect(formMounts[0].receipt).toBe("PAY-X");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Exactly 3 fetches for AUDIT-X, nothing else.
    expect(fetchCountByAudit.get("AUDIT-X")).toBe(3);
    expect([...fetchCountByAudit.keys()]).toEqual(["AUDIT-X"]);
  });
});
