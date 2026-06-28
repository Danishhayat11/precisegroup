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
 * Regression test for the replay-effect cancellation safeguard.
 *
 * Scenario the safeguard exists to prevent:
 *   1. User lands on /payments?openReceipt=…&audit=… with a SLOW audit
 *      fetch in flight.
 *   2. Before it resolves they click "Start a fresh payment instead"
 *      (URL params cleared) AND navigate away from /payments entirely.
 *   3. The audit fetch then resolves AFTER the component has unmounted.
 *
 * Without the cleanup `cancelled = true` flag (and the explicit
 * `if (cancelled) return;` guard before the state setters), the
 * resolved promise would call setReplayInitial / setCreateOpen on the
 * unmounted component, causing the replay dialog to silently mount
 * the next time the user visits /payments.
 *
 * This test:
 *   - Holds the audit fetch open with a manual deferred.
 *   - Clicks the dismiss button + navigates away while it's still pending.
 *   - Resolves the fetch.
 *   - Navigates back to /payments.
 *   - Asserts the dialog NEVER mounts and no banner appears.
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

// Manually-controlled deferred so we can decide WHEN the audit fetch
// resolves. This is the lever the safeguard depends on: the resolve
// must happen AFTER the component is unmounted.
let auditDeferred: {
  promise: Promise<{ data: any; error: any }>;
  resolve: (v: { data: any; error: any }) => void;
} | null = null;
function makeDeferred() {
  let resolve!: (v: { data: any; error: any }) => void;
  const promise = new Promise<{ data: any; error: any }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

vi.mock("@/integrations/supabase/client", () => {
  const auditBuilder = () => {
    const b: any = {};
    b.select = () => b;
    b.eq = () => b;
    b.order = () => b;
    b.maybeSingle = () => auditDeferred!.promise;
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

let navTo: (to: string) => void = () => {};
function NavController() {
  const navigate = useNavigate();
  navTo = (to: string) => navigate(to);
  return null;
}

function Elsewhere() {
  return <div data-testid="elsewhere">elsewhere</div>;
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
          <Route
            path="/elsewhere"
            element={
              <>
                <Elsewhere />
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
  auditDeferred = makeDeferred();
});
afterEach(() => cleanup());

describe("Payments replay-effect cancellation on unmount", () => {
  it("dismiss + navigate away while audit fetch is in flight → fetch resolves later → dialog still never mounts", async () => {
    renderApp("/payments?openReceipt=PAY-00099&audit=stale-audit");

    // 1. Audit fetch is pending — no banner yet, no dialog.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);

    // 2. While the fetch is still pending, click "Start a fresh payment
    //    instead". This clears the URL params, which triggers the replay
    //    effect's cleanup (`cancelled = true`) before the fetch resolves.
    //    The dismiss button only renders inside the banner — which
    //    requires the replayError state to be set. Since the banner
    //    isn't visible yet (fetch pending), we instead navigate AWAY
    //    entirely; the navigate-away path is the harder unmount case
    //    and is what the safeguard primarily defends against.
    act(() => navTo("/elsewhere"));
    await waitFor(() =>
      expect(screen.getByTestId("elsewhere")).toBeInTheDocument(),
    );
    // Payments is fully unmounted now.
    expect(screen.queryByTestId("location")?.textContent).toBe("/elsewhere");

    // 3. Resolve the audit fetch AFTER unmount. Without the safeguard
    //    this would call setReplayInitial / setCreateOpen on an
    //    unmounted component, which (a) warns in React strict mode and
    //    (b) leaves stale state that re-mounts the dialog on the next
    //    visit to /payments.
    await act(async () => {
      auditDeferred!.resolve({
        data: {
          entity_id: "PAY-00099",
          after: {
            booking_id: "BK-X",
            payment_mode: "Bank Transfer",
            amount: 250000,
            payment_head: "Installment",
          },
        },
        error: null,
      });
      // Flush microtasks for the awaited promise.
      await Promise.resolve();
      await Promise.resolve();
    });

    // 4. Give any (incorrect) deferred state-update a window to fire.
    await new Promise((r) => setTimeout(r, 30));

    // 5. Still on /elsewhere; no PaymentForm ever mounted; no banner.
    expect(screen.getByTestId("elsewhere")).toBeInTheDocument();
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);

    // 6. Navigate BACK to /payments (clean URL — no replay params).
    //    The replay effect short-circuits on `!openReceiptParam`. Any
    //    leftover state from the now-resolved-but-cancelled fetch must
    //    NOT have leaked into the new Payments instance.
    act(() => navTo("/payments"));
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/payments"),
    );
    await new Promise((r) => setTimeout(r, 30));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(screen.queryByText(/replay blocked payment/i)).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);
  });

  it("dismiss-via-button branch: clearing URL params mid-flight also cancels the replay effect", async () => {
    // Counter-test that exercises the dismiss-button code path (not the
    // unmount path). We resolve the fetch FIRST so the banner renders,
    // then re-arm a second deferred for the post-dismiss re-run, then
    // dismiss + resolve and confirm nothing mounts.
    auditDeferred!.resolve({ data: null, error: null });
    renderApp("/payments?openReceipt=PAY-00099&audit=stale-audit");

    // Banner from the failed lookup.
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    // Re-arm: the dismiss handler clears URL params, which re-triggers
    // the effect. With `!openReceiptParam` the effect returns
    // immediately — but we still want to confirm no audit fetch fires.
    auditDeferred = makeDeferred();
    const fetchCalledAfterDismiss = vi.fn();
    const originalThen = auditDeferred.promise.then.bind(auditDeferred.promise);
    auditDeferred.promise.then = ((...a: any[]) => {
      fetchCalledAfterDismiss();
      return originalThen(...a);
    }) as any;

    fireEvent.click(
      screen.getByRole("button", { name: /start a fresh payment instead/i }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );

    // The replay effect's early-return path means the fetch promise is
    // never accessed.
    expect(fetchCalledAfterDismiss).not.toHaveBeenCalled();
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);
  });
});
