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
 * Regression test: rapidly swapping between several
 * `?openReceipt=…&audit=…` URLs must satisfy two invariants.
 *
 *   (1) **Only the latest audit's payload is ever applied to the form.**
 *       Cancelled (superseded) runs must not call setReplayInitial /
 *       setReplayAuditId / setCreateOpen — even when they resolve last.
 *
 *   (2) **No extra or duplicate audit fetches after cancellation.**
 *       The replay effect re-runs once per (openReceipt, audit) pair,
 *       so each distinct URL triggers exactly ONE supabase fetch. A
 *       cancelled run must NOT loop, retry, or re-issue its fetch.
 *
 * The test drives four sequential URLs (A → B → C → D), holds each
 * fetch open with a manual deferred, then resolves them in REVERSE
 * order (D first, then C, B, A). The form must end showing D's data,
 * and across the whole run every audit id is fetched exactly once.
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
      <div data-testid="payment-form-stub">
        <div data-testid="pf-receipt">{props.initial?.receipt_no ?? ""}</div>
        <div data-testid="pf-booking">{props.initial?.booking_id ?? ""}</div>
        <div data-testid="pf-amount">{String(props.initial?.amount ?? "")}</div>
        <div data-testid="pf-mode">{props.initial?.payment_mode ?? ""}</div>
        <div data-testid="pf-head">{props.initial?.payment_head ?? ""}</div>
        <div data-testid="pf-audit">{props.prefillAuditId ?? ""}</div>
      </div>
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

// Four distinct, internally-consistent audit payloads.
const AUDIT_PAYLOADS: Record<
  string,
  { entity_id: string; after: { booking_id: string; payment_mode: string; amount: number; payment_head: string } }
> = {
  "AUDIT-A": { entity_id: "PAY-A", after: { booking_id: "BK-A", payment_mode: "Bank Transfer", amount: 1000, payment_head: "Installment" } },
  "AUDIT-B": { entity_id: "PAY-B", after: { booking_id: "BK-B", payment_mode: "Cash",          amount: 2000, payment_head: "Advance" } },
  "AUDIT-C": { entity_id: "PAY-C", after: { booking_id: "BK-C", payment_mode: "Bank Transfer", amount: 3000, payment_head: "Installment" } },
  "AUDIT-D": { entity_id: "PAY-D", after: { booking_id: "BK-D", payment_mode: "Cash",          amount: 4000, payment_head: "Booking" } },
};

// Per-audit-id deferreds, plus a global fetch counter and a per-id
// fetch-count map so we can prove no duplicate fetches occur.
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
      const payload = AUDIT_PAYLOADS[auditId];
      deferreds.push({
        auditId,
        promise,
        resolve: () =>
          resolveFn({
            data: payload ? { entity_id: payload.entity_id, after: payload.after } : null,
            error: null,
          }),
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
  if (!d) {
    throw new Error(
      `No deferred captured for ${auditId}. Captured so far: [${deferreds.map((x) => x.auditId).join(", ")}]`,
    );
  }
  return d;
}

beforeEach(() => {
  formMounts.length = 0;
  deferreds.length = 0;
  fetchCountByAudit.clear();
});
afterEach(() => cleanup());

describe("Payments: rapid audit URL swaps — only latest applies, no duplicate fetches", () => {
  it("A→B→C→D rapid swap then reverse-order resolve: form shows D only, every audit id fetched exactly once", async () => {
    // 1. Land on A and wait for its fetch to be registered.
    renderApp("/payments?openReceipt=PAY-A&audit=AUDIT-A");
    await waitFor(() => expect(deferreds.length).toBe(1));
    expect(deferreds[0].auditId).toBe("AUDIT-A");

    // 2. Rapid-fire swap through B, C, D before ANY fetch resolves.
    act(() => navTo("/payments?openReceipt=PAY-B&audit=AUDIT-B"));
    await waitFor(() => expect(deferreds.length).toBe(2));
    act(() => navTo("/payments?openReceipt=PAY-C&audit=AUDIT-C"));
    await waitFor(() => expect(deferreds.length).toBe(3));
    act(() => navTo("/payments?openReceipt=PAY-D&audit=AUDIT-D"));
    await waitFor(() => expect(deferreds.length).toBe(4));

    // Each (openReceipt, audit) URL triggered exactly one fetch.
    expect(fetchCountByAudit.get("AUDIT-A")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-B")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-C")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-D")).toBe(1);

    // Nothing has mounted yet — no fetch has resolved.
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);

    // 3. Resolve in REVERSE order: D first (the latest URL), then C,
    //    B, A. Only D should produce a mount; C, B, A are cancelled.
    await act(async () => {
      findDeferred("AUDIT-D").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("pf-receipt").textContent).toBe("PAY-D");
    expect(screen.getByTestId("pf-audit").textContent).toBe("AUDIT-D");
    const mountsAfterD = formMounts.length;

    // 4. Late-resolve C, B, A (all cancelled). Each must be a no-op.
    for (const id of ["AUDIT-C", "AUDIT-B", "AUDIT-A"] as const) {
      await act(async () => {
        findDeferred(id).resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    await new Promise((r) => setTimeout(r, 40));

    // 5. The visible dialog still shows D and only D.
    expect(screen.getByTestId("pf-receipt").textContent).toBe("PAY-D");
    expect(screen.getByTestId("pf-booking").textContent).toBe("BK-D");
    expect(screen.getByTestId("pf-amount").textContent).toBe("4000");
    expect(screen.getByTestId("pf-mode").textContent).toBe("Cash");
    expect(screen.getByTestId("pf-head").textContent).toBe("Booking");
    expect(screen.getByTestId("pf-audit").textContent).toBe("AUDIT-D");

    // 6. INVARIANT (1): no cancelled run ever pushed a mount —
    //    formMounts contains zero entries with A/B/C's audit ids.
    const auditIdsMounted = new Set(formMounts.map((m) => m.prefillAuditId));
    expect(auditIdsMounted.has("AUDIT-A")).toBe(false);
    expect(auditIdsMounted.has("AUDIT-B")).toBe(false);
    expect(auditIdsMounted.has("AUDIT-C")).toBe(false);
    expect(auditIdsMounted.has("AUDIT-D")).toBe(true);

    // And the late resolutions of A/B/C produced no additional mounts.
    expect(formMounts.length).toBe(mountsAfterD);

    // 7. INVARIANT (2): no duplicate / extra fetches after cancellation.
    //    Each audit id was fetched exactly once. A cancelled run that
    //    retried or looped would bump these counters above 1.
    expect(fetchCountByAudit.size).toBe(4);
    expect(fetchCountByAudit.get("AUDIT-A")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-B")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-C")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-D")).toBe(1);
    // Total fetches == 4, not 5/6/7.
    const totalFetches = [...fetchCountByAudit.values()].reduce((a, b) => a + b, 0);
    expect(totalFetches).toBe(4);

    // 8. Every mount we ever observed is internally consistent — no
    //    cross-audit field mixing slipped through.
    for (const m of formMounts) {
      const expected = Object.entries(AUDIT_PAYLOADS).find(
        ([id]) => id === m.prefillAuditId,
      );
      expect(expected, `mount with unknown audit ${m.prefillAuditId}`).toBeTruthy();
      const [, payload] = expected!;
      expect(m.receipt).toBe(payload.entity_id);
      expect(m.bookingId).toBe(payload.after.booking_id);
      expect(m.amount).toBe(payload.after.amount);
      expect(m.paymentMode).toBe(payload.after.payment_mode);
      expect(m.paymentHead).toBe(payload.after.payment_head);
    }
  });

  it("forward-order resolve (A first, D last) STILL ends on D and never duplicates fetches", async () => {
    // Counter-interleaving: even if cancelled runs resolve EARLY, they
    // must remain no-ops because the URL has already moved on.
    renderApp("/payments?openReceipt=PAY-A&audit=AUDIT-A");
    await waitFor(() => expect(deferreds.length).toBe(1));

    act(() => navTo("/payments?openReceipt=PAY-B&audit=AUDIT-B"));
    await waitFor(() => expect(deferreds.length).toBe(2));
    act(() => navTo("/payments?openReceipt=PAY-C&audit=AUDIT-C"));
    await waitFor(() => expect(deferreds.length).toBe(3));
    act(() => navTo("/payments?openReceipt=PAY-D&audit=AUDIT-D"));
    await waitFor(() => expect(deferreds.length).toBe(4));

    // Resolve A, B, C (all cancelled). None should mount.
    for (const id of ["AUDIT-A", "AUDIT-B", "AUDIT-C"] as const) {
      await act(async () => {
        findDeferred(id).resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);

    // Now resolve D — must mount cleanly with D's data only.
    await act(async () => {
      findDeferred("AUDIT-D").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("pf-receipt").textContent).toBe("PAY-D");
    expect(screen.getByTestId("pf-audit").textContent).toBe("AUDIT-D");

    // No duplicate fetches.
    expect(fetchCountByAudit.get("AUDIT-A")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-B")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-C")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-D")).toBe(1);

    // Only D ever mounted.
    expect(formMounts.length).toBe(1);
    expect(formMounts[0].prefillAuditId).toBe("AUDIT-D");
  });
});
