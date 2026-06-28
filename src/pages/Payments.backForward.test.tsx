import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
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
 * Regression test for the back/forward behavior around
 * "Start a fresh payment instead".
 *
 * Payments.tsx clears the replay params (`openReceipt`, `audit`) with
 * `setParams(next, { replace: true })`. That's deliberate: the dismissed
 * replay state should NOT remain in the browser history, otherwise the
 * user pressing Back would silently re-pop the failed replay banner /
 * stale prefill.
 *
 * This test pins that behavior down so a future refactor that switches
 * to a pushing navigation (e.g. `setParams(next)` without `replace`)
 * fails loudly.
 */

const formMounts: { initial: any; replayBlocked: boolean; prefillAuditId: string | null }[] = [];

vi.mock("@/components/PaymentForm", () => ({
  PAYMENT_TYPES: ["Cash", "Bank Transfer", "Adjustment/Asset"],
  PaymentForm: (props: any) => {
    formMounts.push({
      initial: props.initial,
      replayBlocked: !!props.replayBlocked,
      prefillAuditId: props.prefillAuditId ?? null,
    });
    return (
      <div data-testid="payment-form-stub">
        <div data-testid="pf-receipt">{props.initial?.receipt_no ?? ""}</div>
        <div data-testid="pf-replay">{props.replayBlocked ? "yes" : "no"}</div>
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

// audit_logs.maybeSingle returns null → "Audit entry not found" banner path,
// which exposes the "Start a fresh payment instead" button.
vi.mock("@/integrations/supabase/client", () => {
  const auditBuilder = () => {
    const b: any = {};
    b.select = () => b;
    b.eq = () => b;
    b.order = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
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
  return (
    <div data-testid="location">
      {loc.pathname}
      {loc.search}
    </div>
  );
}

// Exposes router.navigate(-1) / navigate(+1) to the test so we can drive
// the MemoryRouter history exactly like the browser back/forward buttons.
let navBack: () => void = () => {};
let navForward: () => void = () => {};
function NavController() {
  const navigate = useNavigate();
  navBack = () => navigate(-1);
  navForward = () => navigate(1);
  return null;
}

// A bare "previous page" so the back stack has somewhere to land.
function PrevPage() {
  return <div data-testid="prev-page">previous page</div>;
}

function renderWithHistory(entries: string[], initialIndex: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
        <NavController />
        <Routes>
          <Route path="/prev" element={<><PrevPage /><LocationProbe /></>} />
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
});
afterEach(() => cleanup());

describe("Payments back/forward after 'Start a fresh payment instead'", () => {
  it("Back navigates to the previous page (NOT the stale replay URL) and Forward lands on a clean /payments with no prefill", async () => {
    // History stack: [/prev, /payments?openReceipt=PAY-00099&audit=stale-audit]
    // Index 1 — we start on the payments page with replay params.
    renderWithHistory(
      ["/prev", "/payments?openReceipt=PAY-00099&audit=stale-audit"],
      1,
    );

    // 1. Replay lookup fails → banner appears, URL still has the params.
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByTestId("location").textContent).toBe(
      "/payments?openReceipt=PAY-00099&audit=stale-audit",
    );

    // 2. Dismiss with "Start a fresh payment instead" — Payments uses
    //    setParams(next, { replace: true }) which REPLACES the current
    //    history entry, it does not push a new one.
    fireEvent.click(
      screen.getByRole("button", { name: /start a fresh payment instead/i }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("location").textContent).toBe("/payments");

    // 3. Browser BACK — because the replay URL was replaced, the back
    //    stack now points at /prev, not at the stale replay URL. This
    //    is the core regression guard: a push-instead-of-replace
    //    refactor would land us back on /payments?openReceipt=... and
    //    re-pop the failed-replay banner.
    act(() => navBack());
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/prev"),
    );
    expect(screen.getByTestId("prev-page")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();

    // 4. Browser FORWARD — lands on the cleaned /payments (the entry
    //    that replaced the original replay URL), with NO params.
    act(() => navForward());
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/payments"),
    );
    expect(screen.getByTestId("location").textContent).not.toContain(
      "openReceipt",
    );
    expect(screen.getByTestId("location").textContent).not.toContain("audit=");

    // 5. The replay banner must not reappear, and the form must not
    //    auto-mount with prefill — the replay effect keys on the URL
    //    params, which are gone.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);

    // 6. Opening the form manually now must produce a blank PaymentForm.
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    await screen.findByTestId("payment-form-stub");
    expect(screen.getByTestId("pf-receipt").textContent).toBe("");
    expect(screen.getByTestId("pf-replay").textContent).toBe("no");
    const last = formMounts[formMounts.length - 1];
    expect(last.replayBlocked).toBe(false);
    expect(last.prefillAuditId).toBeNull();
    expect(last.initial).toBeUndefined();
  });

  it("Back from a pushed /payments visit DOES restore prior replay params (sanity check on history depth)", async () => {
    // History stack: [/payments?openReceipt=PAY-00099&audit=stale-audit, /payments]
    // Index 1 — start on the clean payments page. Pressing back should
    // restore the replay URL because it's a real prior entry (not one
    // that was replaced away). This proves the back/forward plumbing in
    // the test actually works, so the first test's "Back -> /prev"
    // result is meaningful rather than a no-op artifact.
    renderWithHistory(
      ["/payments?openReceipt=PAY-00099&audit=stale-audit", "/payments"],
      1,
    );

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/payments"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => navBack());
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/payments?openReceipt=PAY-00099&audit=stale-audit",
      ),
    );
    // The replay effect re-runs and the banner pops again.
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
  });
});
