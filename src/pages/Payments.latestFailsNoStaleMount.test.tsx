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
 * Regression test: rapid `?openReceipt=…&audit=…` swaps where the
 * LATEST audit fetch FAILS (error or not-found).
 *
 * Required behavior:
 *   - The latest run shows the replay-error banner.
 *   - The PaymentForm dialog NEVER mounts — neither with the failed
 *     audit's stub data nor with stale data from any earlier cancelled
 *     audit fetch (even when those earlier fetches succeed and resolve
 *     LATE, after the failure).
 *
 * Why this matters: without the `cancelled` flag in the replay effect,
 * a late-resolving successful fetch for AUDIT-A could call
 * setReplayInitial / setCreateOpen on the live component AFTER the URL
 * had switched to AUDIT-B and AUDIT-B's fetch had failed. The user
 * would see B's error banner and then suddenly A's data flash into a
 * dialog that auto-opens — exactly the cross-audit leak we forbid.
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

// Two SUCCESS payloads (the earlier, cancelled runs) and one failure
// (the latest run).
const SUCCESS_PAYLOADS: Record<
  string,
  { entity_id: string; after: { booking_id: string; payment_mode: string; amount: number; payment_head: string } }
> = {
  "AUDIT-A": { entity_id: "PAY-A", after: { booking_id: "BK-A", payment_mode: "Bank Transfer", amount: 11111, payment_head: "Installment" } },
  "AUDIT-B": { entity_id: "PAY-B", after: { booking_id: "BK-B", payment_mode: "Cash",          amount: 22222, payment_head: "Advance" } },
};

// Mode for a given audit id: "success" returns the payload above,
// "missing" returns { data: null } → banner path, "error" returns an
// error → banner path. The test re-keys this per case.
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

describe("Payments: latest audit fetch fails during rapid swaps — no stale prefill ever mounts", () => {
  it("A(success, late) → B(success, late) → C(MISSING, latest): banner shows, no PaymentForm ever mounts", async () => {
    fetchMode.set("AUDIT-A", "success");
    fetchMode.set("AUDIT-B", "success");
    fetchMode.set("AUDIT-C", "missing"); // latest → triggers banner

    // 1. Start on A, then rapidly swap to B then C — all fetches pending.
    renderApp("/payments?openReceipt=PAY-A&audit=AUDIT-A");
    await waitFor(() => expect(deferreds.length).toBe(1));
    act(() => navTo("/payments?openReceipt=PAY-B&audit=AUDIT-B"));
    await waitFor(() => expect(deferreds.length).toBe(2));
    act(() => navTo("/payments?openReceipt=PAY-C&audit=AUDIT-C"));
    await waitFor(() => expect(deferreds.length).toBe(3));

    expect(formMounts.length).toBe(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();

    // 2. Resolve C (the latest, FAILED) first → banner appears, no form.
    await act(async () => {
      findDeferred("AUDIT-C").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/audit entry not found/i);
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);

    // 3. Late-resolve A and B (both SUCCESS). Without the cancellation
    //    safeguard, either would call setReplayInitial/setCreateOpen
    //    and the dialog would flash open with stale A or B data over
    //    C's error banner — the exact leak this test exists to catch.
    await act(async () => {
      findDeferred("AUDIT-A").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      findDeferred("AUDIT-B").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 40));

    // 4. The banner is still C's, no form has mounted, nothing stale leaked.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert").textContent).toMatch(/audit entry not found/i);
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);

    // 5. Each audit id was fetched exactly once — no retries from
    //    cancelled runs.
    expect(fetchCountByAudit.get("AUDIT-A")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-B")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-C")).toBe(1);
  });

  it("A(success, late) → B(success, late) → C(ERROR, latest): error banner shows, no PaymentForm ever mounts", async () => {
    fetchMode.set("AUDIT-A", "success");
    fetchMode.set("AUDIT-B", "success");
    fetchMode.set("AUDIT-C", "error"); // latest → error-path banner

    renderApp("/payments?openReceipt=PAY-A&audit=AUDIT-A");
    await waitFor(() => expect(deferreds.length).toBe(1));
    act(() => navTo("/payments?openReceipt=PAY-B&audit=AUDIT-B"));
    await waitFor(() => expect(deferreds.length).toBe(2));
    act(() => navTo("/payments?openReceipt=PAY-C&audit=AUDIT-C"));
    await waitFor(() => expect(deferreds.length).toBe(3));

    // Resolve C (the failure) first.
    await act(async () => {
      findDeferred("AUDIT-C").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't load the blocked attempt/i);
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();

    // Late-resolve A and B (successes).
    await act(async () => {
      findDeferred("AUDIT-A").resolve();
      findDeferred("AUDIT-B").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 40));

    // Banner still C's, no form mounted, no stale data leaked.
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't load the blocked attempt/i);
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);

    // No retries / duplicates.
    expect(fetchCountByAudit.get("AUDIT-A")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-B")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-C")).toBe(1);
  });

  it("counter-test: when the latest fetch succeeds, the form DOES mount with that audit (proves the harness can mount when allowed)", async () => {
    // Sanity check — without this, a buggy mock that just never mounts
    // would pass the failure tests above for the wrong reason.
    fetchMode.set("AUDIT-A", "success");
    fetchMode.set("AUDIT-B", "success");

    renderApp("/payments?openReceipt=PAY-A&audit=AUDIT-A");
    await waitFor(() => expect(deferreds.length).toBe(1));
    act(() => navTo("/payments?openReceipt=PAY-B&audit=AUDIT-B"));
    await waitFor(() => expect(deferreds.length).toBe(2));

    // Resolve B (latest) → mounts cleanly.
    await act(async () => {
      findDeferred("AUDIT-B").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );
    expect(formMounts.length).toBe(1);
    expect(formMounts[0].prefillAuditId).toBe("AUDIT-B");
    expect(formMounts[0].receipt).toBe("PAY-B");

    // Late-resolve A → cancelled, no second mount.
    await act(async () => {
      findDeferred("AUDIT-A").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(formMounts.length).toBe(1);
    expect(formMounts[0].prefillAuditId).toBe("AUDIT-B");
  });
});
