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
  useNavigate,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Regression test: after the LATEST audit fetch fails during rapid
 * `?openReceipt=…&audit=…` swaps, the user dismisses the error banner
 * and then re-opens the PaymentForm via the "Record payment" button.
 *
 * Required behavior:
 *   - The PaymentForm mounts on user-click with NO prefill at all —
 *     no `prefillAuditId`, no booking_id / amount / payment_mode /
 *     payment_head from any of the earlier (cancelled, late-resolving)
 *     audit fetches.
 *   - The error banner is gone (was dismissed).
 *
 * Why this matters: the failure path leaves `replayInitial` /
 * `replayAuditId` state behind. Without proper clearing on dismiss
 * + on a fresh "Record payment" click, an earlier successful but
 * cancelled audit fetch could resolve late and pre-stash a payload
 * that then leaks into the next opened form — producing exactly the
 * cross-audit prefill we forbid.
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
  "AUDIT-A": { entity_id: "PAY-A", after: { booking_id: "BK-A", payment_mode: "Bank Transfer", amount: 11111, payment_head: "Installment" } },
  "AUDIT-B": { entity_id: "PAY-B", after: { booking_id: "BK-B", payment_mode: "Cash",          amount: 22222, payment_head: "Advance" } },
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

describe("Payments: dismiss error banner after latest-failure and re-open form — no stale prefill leaks", () => {
  it("A(success, late) → B(success, late) → C(MISSING, latest): dismiss banner → click Record payment → form opens with NO prefill, late successes do not leak", async () => {
    fetchMode.set("AUDIT-A", "success");
    fetchMode.set("AUDIT-B", "success");
    fetchMode.set("AUDIT-C", "missing"); // latest → banner path

    // 1. A → B → C, all pending.
    renderApp("/payments?openReceipt=PAY-A&audit=AUDIT-A");
    await waitFor(() => expect(deferreds.length).toBe(1));
    act(() => navTo("/payments?openReceipt=PAY-B&audit=AUDIT-B"));
    await waitFor(() => expect(deferreds.length).toBe(2));
    act(() => navTo("/payments?openReceipt=PAY-C&audit=AUDIT-C"));
    await waitFor(() => expect(deferreds.length).toBe(3));

    // 2. Resolve C (latest, MISSING) → banner.
    await act(async () => {
      findDeferred("AUDIT-C").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/audit entry not found/i);
    expect(formMounts.length).toBe(0);

    // 3. User dismisses the banner (X button).
    const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
    await act(async () => {
      fireEvent.click(dismissBtn);
      await Promise.resolve();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // 4. Late-resolve A and B (both SUCCESS). Without proper cleanup on
    //    dismiss, either of these could call setReplayInitial /
    //    setCreateOpen on the live page and the dialog would auto-open
    //    with A's or B's prefill — the leak this test exists to catch.
    await act(async () => {
      findDeferred("AUDIT-A").resolve();
      findDeferred("AUDIT-B").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 40));

    // Banner must remain dismissed, form must not have auto-opened.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);

    // 5. User clicks "Record payment" → form opens fresh, NO prefill.
    const recordBtn = screen.getByRole("button", { name: /record payment/i });
    await act(async () => {
      fireEvent.click(recordBtn);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );

    // Exactly one mount, and it is COMPLETELY clean — no leak from
    // A, B, or C.
    expect(formMounts.length).toBe(1);
    const m = formMounts[0];
    expect(m.prefillAuditId).toBeNull();
    expect(m.receipt).toBe("");
    expect(m.bookingId).toBe("");
    expect(m.amount).toBe("");
    expect(m.paymentMode).toBe("");
    expect(m.paymentHead).toBe("");

    // Sanity: every audit fetched exactly once — no retries on dismiss
    // or on re-open.
    expect(fetchCountByAudit.get("AUDIT-A")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-B")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-C")).toBe(1);
  });

  it("A(success, late) → B(success, late) → C(ERROR, latest): 'Start a fresh payment instead' → click Record payment → form opens with NO prefill", async () => {
    fetchMode.set("AUDIT-A", "success");
    fetchMode.set("AUDIT-B", "success");
    fetchMode.set("AUDIT-C", "error");

    renderApp("/payments?openReceipt=PAY-A&audit=AUDIT-A");
    await waitFor(() => expect(deferreds.length).toBe(1));
    act(() => navTo("/payments?openReceipt=PAY-B&audit=AUDIT-B"));
    await waitFor(() => expect(deferreds.length).toBe(2));
    act(() => navTo("/payments?openReceipt=PAY-C&audit=AUDIT-C"));
    await waitFor(() => expect(deferreds.length).toBe(3));

    await act(async () => {
      findDeferred("AUDIT-C").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't load the blocked attempt/i);

    // User clicks the inline "Start a fresh payment instead" button —
    // same clear-state contract as the X button.
    const freshBtn = screen.getByRole("button", { name: /start a fresh payment instead/i });
    await act(async () => {
      fireEvent.click(freshBtn);
      await Promise.resolve();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Late-resolve the two earlier successes — must NOT auto-open
    // the form with their stale payloads.
    await act(async () => {
      findDeferred("AUDIT-A").resolve();
      findDeferred("AUDIT-B").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(formMounts.length).toBe(0);
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();

    // Re-open via Record payment → fresh, no prefill.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );
    expect(formMounts.length).toBe(1);
    const m = formMounts[0];
    expect(m.prefillAuditId).toBeNull();
    expect(m.receipt).toBe("");
    expect(m.bookingId).toBe("");
    expect(m.amount).toBe("");
    expect(m.paymentMode).toBe("");
    expect(m.paymentHead).toBe("");

    expect(fetchCountByAudit.get("AUDIT-A")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-B")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-C")).toBe(1);
  });
});
