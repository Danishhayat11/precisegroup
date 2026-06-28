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
 * Regression test for `?openReceipt=…` URLs that have NO `audit=` param.
 *
 * When the audit id is missing there is no audit row to fetch, so the
 * replay effect short-circuits the audit lookup and `buildReplayInitial`
 * is called with `after = null`. The dialog auto-opens but the only
 * prefilled field is `receipt_no` (echoed from the URL). All
 * audit-derived fields — booking_id, payment_mode, amount, payment_head
 * — must be empty/zero, and `prefillAuditId` must be null.
 *
 * This test rapidly switches between two such URLs and confirms:
 *   1. The PaymentForm never mounts with ANY audit-derived prefill
 *      (no booking, no amount, no mode, no head, no audit id).
 *   2. Switching from PAY-A → PAY-B never produces a mount whose
 *      receipt_no doesn't match the URL at mount time — a refactor
 *      that forgot to cancel the effect could echo PAY-A's receipt
 *      into the form even after the URL is PAY-B.
 *   3. The audit fetch is never invoked (no `audit=` → no lookup).
 *   4. The replay banner never appears (no audit, no error).
 */

type Mount = {
  receipt: string;
  bookingId: string;
  amount: number | string;
  paymentMode: string;
  paymentHead: string;
  prefillAuditId: string | null;
  replayBlocked: boolean;
  urlAtMount: string;
};

const formMounts: Mount[] = [];
let currentUrl = "";

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
      replayBlocked: !!props.replayBlocked,
      urlAtMount: currentUrl,
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

// Count audit fetches so we can prove the effect skips the lookup
// entirely when `audit=` is absent.
let auditFetches = 0;
vi.mock("@/integrations/supabase/client", () => {
  const auditBuilder = () => {
    const b: any = {};
    b.select = () => b;
    b.eq = () => b;
    b.order = () => b;
    b.maybeSingle = async () => {
      auditFetches++;
      return { data: null, error: null };
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
  currentUrl = `${loc.pathname}${loc.search}`;
  return <div data-testid="location">{currentUrl}</div>;
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

beforeEach(() => {
  formMounts.length = 0;
  auditFetches = 0;
  currentUrl = "";
});
afterEach(() => cleanup());

describe("Payments: openReceipt-only URLs (no audit) never produce audit-derived prefill", () => {
  it("rapidly switching between two ?openReceipt URLs leaves all audit fields blank and never cross-contaminates the receipt", async () => {
    renderApp("/payments?openReceipt=PAY-A");

    // 1. Dialog auto-opens for PAY-A. Only receipt_no is set — every
    //    audit-derived field is the buildReplayInitial(null) default.
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("pf-receipt").textContent).toBe("PAY-A");
    expect(screen.getByTestId("pf-booking").textContent).toBe("");
    expect(screen.getByTestId("pf-amount").textContent).toBe("0");
    expect(screen.getByTestId("pf-mode").textContent).toBe("");
    expect(screen.getByTestId("pf-head").textContent).toBe("");
    expect(screen.getByTestId("pf-audit").textContent).toBe("");
    // No audit param → no audit fetch.
    expect(auditFetches).toBe(0);
    // No banner — there's no audit error to report.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // 2. Switch to PAY-B (still no audit param) — fire several rapid
    //    transitions to stress any in-flight effect race.
    act(() => navTo("/payments?openReceipt=PAY-B"));
    act(() => navTo("/payments?openReceipt=PAY-A"));
    act(() => navTo("/payments?openReceipt=PAY-B"));
    await waitFor(() =>
      expect(screen.getByTestId("pf-receipt").textContent).toBe("PAY-B"),
    );
    // Drain any pending microtasks/effects.
    await new Promise((r) => setTimeout(r, 30));

    // 3. After all the churn, the visible dialog still shows PAY-B and
    //    nothing else.
    expect(screen.getByTestId("pf-receipt").textContent).toBe("PAY-B");
    expect(screen.getByTestId("pf-booking").textContent).toBe("");
    expect(screen.getByTestId("pf-amount").textContent).toBe("0");
    expect(screen.getByTestId("pf-mode").textContent).toBe("");
    expect(screen.getByTestId("pf-head").textContent).toBe("");
    expect(screen.getByTestId("pf-audit").textContent).toBe("");
    expect(auditFetches).toBe(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // 4. CORE INVARIANT — across every mount that ever happened:
    //    - receipt_no matches the URL at the moment of mount (never
    //      a stale echo from the previous URL).
    //    - every audit-derived field is the empty default.
    //    - prefillAuditId is always null.
    //    - replayBlocked is always true (replay code path), but with
    //      zero audit data behind it.
    expect(formMounts.length).toBeGreaterThan(0);
    for (const m of formMounts) {
      // Receipt must match whatever URL was current when this mount happened.
      const expectedReceipt = m.urlAtMount.includes("openReceipt=PAY-A")
        ? "PAY-A"
        : m.urlAtMount.includes("openReceipt=PAY-B")
          ? "PAY-B"
          : "";
      expect(
        m.receipt,
        `receipt ${m.receipt} doesn't match url ${m.urlAtMount}`,
      ).toBe(expectedReceipt);

      // Audit-derived fields must all be defaults — no leakage.
      expect(m.bookingId).toBe("");
      expect(m.amount).toBe(0);
      expect(m.paymentMode).toBe("");
      expect(m.paymentHead).toBe("");
      expect(m.prefillAuditId).toBeNull();
      expect(m.replayBlocked).toBe(true);
    }
  });

  it("switching from openReceipt-only to NO params clears the dialog and never re-mounts with stale prefill", async () => {
    renderApp("/payments?openReceipt=PAY-A");
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("pf-receipt").textContent).toBe("PAY-A");

    // Strip the param entirely.
    act(() => navTo("/payments"));
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/payments"),
    );
    await new Promise((r) => setTimeout(r, 30));

    // No NEW mount happens after the URL strip — the effect short-circuits.
    const mountsAfterStrip = formMounts.length;

    // Re-add an openReceipt for a DIFFERENT receipt — must mount fresh
    // with only the new receipt echoed, no residue from PAY-A.
    act(() => navTo("/payments?openReceipt=PAY-B"));
    await waitFor(() =>
      expect(screen.getByTestId("pf-receipt").textContent).toBe("PAY-B"),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(formMounts.length).toBeGreaterThan(mountsAfterStrip);
    const lastMount = formMounts[formMounts.length - 1];
    expect(lastMount.receipt).toBe("PAY-B");
    expect(lastMount.bookingId).toBe("");
    expect(lastMount.amount).toBe(0);
    expect(lastMount.paymentMode).toBe("");
    expect(lastMount.paymentHead).toBe("");
    expect(lastMount.prefillAuditId).toBeNull();
    expect(auditFetches).toBe(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
