import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Regression test: the FIRST openReceipt+audit fetch fails, then the
 * user swaps to a different openReceipt+audit whose fetch succeeds.
 *
 * Required behavior:
 *   - The failing run is fully cancelled by the URL swap — its error
 *     banner must NOT remain visible after the successful run lands.
 *   - The successful run is the ONLY run that mounts PaymentForm, and
 *     it mounts with exactly that run's prefill (no cross-audit mixing
 *     and no stub data from the failed run).
 *   - Each audit id is fetched exactly once — no duplicate fetch from
 *     the cancelled failing run.
 *
 * Failure modes covered: latest-fails-first scenarios were already
 * tested; this is the inverse — failure FIRST then a clean success.
 * Without proper effect cancellation, the failed run's banner state
 * could persist (showing B's success form WITH A's stale error
 * banner), or the failure path could re-trigger and overwrite B's
 * mount with empty/failed state.
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
    return <div data-testid="payment-form-stub" />;
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
  "AUDIT-B": { entity_id: "PAY-B", after: { booking_id: "BK-B", payment_mode: "Cash",          amount: 33333, payment_head: "Down Payment" } },
  "AUDIT-C": { entity_id: "PAY-C", after: { booking_id: "BK-C", payment_mode: "Bank Transfer", amount: 44444, payment_head: "Installment" } },
};

const fetchMode = new Map<string, "success" | "missing" | "error">();

type Deferred = {
  auditId: string;
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
      fetchCountByAudit.set(auditId, (fetchCountByAudit.get(auditId) ?? 0) + 1);
      let resolveFn!: (v: { data: any; error: any }) => void;
      const promise = new Promise<{ data: any; error: any }>((r) => {
        resolveFn = r;
      });
      const mode = fetchMode.get(auditId) ?? "missing";
      deferreds.push({
        auditId,
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

let navTo: (to: string) => void = () => {};
function NavController() {
  const navigate = useNavigate();
  navTo = (to: string) => navigate(to, { replace: true });
  return null;
}

function renderApp(initial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <NavController />
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

function findDeferred(auditId: string): Deferred {
  const d = deferreds.find((x) => x.auditId === auditId);
  if (!d) throw new Error(`no deferred for ${auditId}: [${deferreds.map((x) => x.auditId).join(",")}]`);
  return d;
}

beforeEach(() => {
  formMounts.length = 0;
  deferreds.length = 0;
  fetchCountByAudit.clear();
  fetchMode.clear();
});
afterEach(() => cleanup());

describe("Payments: first audit fetch fails, then swap to a valid audit — only the successful prefill mounts", () => {
  it("A(MISSING) resolves → banner shows → swap to B(SUCCESS) → only B mounts, banner cleared", async () => {
    fetchMode.set("AUDIT-A", "missing");
    fetchMode.set("AUDIT-B", "success");

    // 1. Start on A. Resolve A's failed fetch → banner visible, no form.
    renderApp("/payments?openReceipt=PAY-A&audit=AUDIT-A");
    await waitFor(() => expect(deferreds.length).toBe(1));
    await act(async () => {
      findDeferred("AUDIT-A").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/audit entry not found/i);
    expect(formMounts.length).toBe(0);
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();

    // 2. Swap to B (valid audit). Its fetch is pending.
    act(() => navTo("/payments?openReceipt=PAY-B&audit=AUDIT-B"));
    await waitFor(() => expect(deferreds.length).toBe(2));

    // 3. Resolve B → form mounts cleanly with B's prefill.
    await act(async () => {
      findDeferred("AUDIT-B").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );

    // Exactly one mount, and it is B's.
    expect(formMounts.length).toBe(1);
    expect(formMounts[0]).toMatchObject({
      receipt: "PAY-B",
      bookingId: "BK-B",
      amount: 33333,
      paymentMode: "Cash",
      paymentHead: "Down Payment",
      prefillAuditId: "AUDIT-B",
    });

    // A's stale error banner must NOT persist alongside B's success.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // No duplicate fetches.
    expect(fetchCountByAudit.get("AUDIT-A")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-B")).toBe(1);
  });

  it("A(ERROR) resolves → error banner shows → swap to C(SUCCESS) → only C mounts, banner cleared", async () => {
    fetchMode.set("AUDIT-A", "error");
    fetchMode.set("AUDIT-C", "success");

    renderApp("/payments?openReceipt=PAY-A&audit=AUDIT-A");
    await waitFor(() => expect(deferreds.length).toBe(1));
    await act(async () => {
      findDeferred("AUDIT-A").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't load the blocked attempt/i);
    expect(formMounts.length).toBe(0);

    // Swap to a different valid audit.
    act(() => navTo("/payments?openReceipt=PAY-C&audit=AUDIT-C"));
    await waitFor(() => expect(deferreds.length).toBe(2));

    await act(async () => {
      findDeferred("AUDIT-C").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );

    // Exactly one mount with C's prefill — no leak from A's failure.
    expect(formMounts.length).toBe(1);
    expect(formMounts[0]).toMatchObject({
      receipt: "PAY-C",
      bookingId: "BK-C",
      amount: 44444,
      paymentMode: "Bank Transfer",
      paymentHead: "Installment",
      prefillAuditId: "AUDIT-C",
    });

    // A's error banner must not still be hanging around.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // No duplicate fetches from the cancelled failure path.
    expect(fetchCountByAudit.get("AUDIT-A")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-C")).toBe(1);
  });
});
