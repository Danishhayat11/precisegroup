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
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Regression test: after "Start a fresh payment instead", the replay
 * banner AND the replay dialog must stay dismissed across REMOUNTS of
 * the /payments route (route switch, key change, navigation away and
 * back). The replay flow is keyed exclusively on URL params, so a
 * remount with the cleaned URL must NOT re-trigger anything.
 *
 * Failure mode this guards: a future refactor that caches replay state
 * in a module-level singleton, react-query cache, or context provider
 * outside the URL — those would survive a remount and silently re-pop
 * the dialog the user just dismissed.
 */

const formMounts: {
  initial: any;
  replayBlocked: boolean;
  prefillAuditId: string | null;
}[] = [];

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

vi.mock("@/integrations/supabase/client", () => {
  const auditBuilder = () => {
    const b: any = {};
    b.select = () => b;
    b.eq = () => b;
    b.order = () => b;
    // Failed lookup → banner path. Same response across all calls so a
    // remount on the original replay URL would re-pop the banner if
    // anything in the dismiss flow leaks.
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

// Lets the test drive navigation AND force a hard remount of the
// /payments route via a key bump.
let navTo: (to: string) => void = () => {};
let bumpKey: () => void = () => {};
function NavController({ onKey }: { onKey: () => void }) {
  const navigate = useNavigate();
  navTo = (to: string) => navigate(to);
  bumpKey = onKey;
  return null;
}

function Other() {
  return <div data-testid="other-page">other</div>;
}

function App({ initial }: { initial: string }) {
  const [routeKey, setRouteKey] = useState(0);
  return (
    <MemoryRouter initialEntries={[initial]}>
      <NavController onKey={() => setRouteKey((k) => k + 1)} />
      <Routes>
        <Route
          path="/payments"
          element={
            <div key={routeKey} data-testid="payments-mount">
              <Payments />
              <LocationProbe />
            </div>
          }
        />
        <Route path="/other" element={<><Other /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderApp(initial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <App initial={initial} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  formMounts.length = 0;
});
afterEach(() => cleanup());

describe("Payments: replay banner + dialog stay dismissed across remounts after fresh reset", () => {
  it("dismissing via 'Start a fresh payment instead' survives a route-key remount AND a navigate-away/back round trip", async () => {
    renderApp("/payments?openReceipt=PAY-00099&audit=stale-audit");

    // 1. Banner appears from the failed audit lookup.
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();

    // 2. Dismiss with "Start a fresh payment instead" — banner gone, URL stripped.
    fireEvent.click(
      screen.getByRole("button", { name: /start a fresh payment instead/i }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("location").textContent).toBe("/payments");

    // 3. Force a HARD REMOUNT of the /payments subtree (key bump). The
    //    Payments component unmounts and a fresh instance mounts on the
    //    same (cleaned) URL — no replay state must re-materialise.
    act(() => bumpKey());
    await waitFor(() =>
      expect(screen.getByTestId("payments-mount")).toBeInTheDocument(),
    );
    // Give the replay effect a chance to (incorrectly) fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(screen.queryByText(/replay blocked payment/i)).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);

    // 4. Navigate AWAY to a different route and back — Payments unmounts
    //    entirely, then mounts fresh again on /payments. Still no replay.
    act(() => navTo("/other"));
    await waitFor(() =>
      expect(screen.getByTestId("other-page")).toBeInTheDocument(),
    );
    act(() => navTo("/payments"));
    await waitFor(() =>
      expect(screen.getByTestId("payments-mount")).toBeInTheDocument(),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);

    // 5. Sanity: manually triggering Record payment opens a fresh form,
    //    proving the dialog still works — it just doesn't AUTO-open.
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    await screen.findByTestId("payment-form-stub");
    expect(screen.getByTestId("pf-receipt").textContent).toBe("");
    expect(screen.getByTestId("pf-replay").textContent).toBe("no");
    const last = formMounts[formMounts.length - 1];
    expect(last.replayBlocked).toBe(false);
    expect(last.prefillAuditId).toBeNull();
    expect(last.initial).toBeUndefined();
  });
});
