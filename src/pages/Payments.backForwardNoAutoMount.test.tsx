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
 * Regression test: after "Start a fresh payment instead", driving the
 * browser Back and Forward buttons must NEVER auto-mount the replay
 * banner or the replay dialog.
 *
 * Payments.tsx dismisses with `setParams(next, { replace: true })`, so
 * the dirty replay URL is overwritten in history. This test exercises
 * the full back/forward dance from that cleaned entry to prove the
 * replay UI (banner + auto-opened PaymentForm dialog) stays silent.
 *
 * If a future refactor pushes instead of replacing, or forgets to
 * cancel the replay effect, Back or Forward would land back on the
 * stale `?openReceipt=…&audit=…` URL and silently re-pop the banner or
 * the dialog. That regression must be caught here.
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

// Track how many times the audit fetch is invoked — proves the replay
// effect's short-circuit (no `openReceipt` param) actually fires after
// dismissal and back/forward navigation.
let auditFetches = 0;
vi.mock("@/integrations/supabase/client", () => {
  const auditBuilder = () => {
    const b: any = {};
    b.select = () => b;
    b.eq = () => b;
    b.order = () => b;
    b.maybeSingle = async () => {
      auditFetches++;
      // Failed-lookup branch → banner appears, dialog does NOT.
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
  return (
    <div data-testid="location">
      {loc.pathname}
      {loc.search}
    </div>
  );
}

let navBack: () => void = () => {};
let navForward: () => void = () => {};
function NavController() {
  const navigate = useNavigate();
  navBack = () => navigate(-1);
  navForward = () => navigate(1);
  return null;
}

function PrevPage() {
  return <div data-testid="prev-page">prev</div>;
}

function renderWithHistory(entries: string[], initialIndex: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
        <NavController />
        <Routes>
          <Route
            path="/prev"
            element={
              <>
                <PrevPage />
                <LocationProbe />
              </>
            }
          />
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
});
afterEach(() => cleanup());

describe("Payments: back/forward after fresh reset never auto-mounts replay UI", () => {
  it("Back then Forward across the dismissed entry leaves banner and dialog silent", async () => {
    // Start on the replay URL with a real prior entry in history so
    // Back has somewhere to go.
    renderWithHistory(
      ["/prev", "/payments?openReceipt=PAY-00099&audit=stale-audit"],
      1,
    );

    // 1. Replay effect fires → audit lookup fails → banner appears.
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(auditFetches).toBe(1);
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();

    // 2. Dismiss — params are stripped via REPLACE (not push), so the
    //    current history entry becomes the clean /payments URL.
    fireEvent.click(
      screen.getByRole("button", { name: /start a fresh payment instead/i }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("location").textContent).toBe("/payments");
    expect(formMounts.length).toBe(0);

    const fetchesAfterDismiss = auditFetches;

    // 3. Browser BACK → lands on /prev. The stale replay URL is GONE
    //    from history (it was replaced), so Back cannot resurrect it.
    act(() => navBack());
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/prev"),
    );
    expect(screen.getByTestId("prev-page")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();

    // 4. Browser FORWARD → lands back on the cleaned /payments. The
    //    replay effect runs but short-circuits because openReceipt is
    //    absent. No banner, no dialog, no extra audit fetch.
    act(() => navForward());
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/payments"),
    );
    // Give any (incorrect) async replay work a window to fire.
    await new Promise((r) => setTimeout(r, 30));

    expect(screen.getByTestId("location").textContent).not.toContain(
      "openReceipt",
    );
    expect(screen.getByTestId("location").textContent).not.toContain("audit=");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(screen.queryByText(/replay blocked payment/i)).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);
    // Critically: the replay effect never re-issued the audit fetch.
    expect(auditFetches).toBe(fetchesAfterDismiss);

    // 5. Back AGAIN (now from cleaned /payments → /prev) and Forward
    //    once more — same silence. Pinning the behavior across repeated
    //    history traversals, not just one round trip.
    act(() => navBack());
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/prev"),
    );
    act(() => navForward());
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/payments"),
    );
    await new Promise((r) => setTimeout(r, 30));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);
    expect(auditFetches).toBe(fetchesAfterDismiss);
  });

  it("counter-test: Back into a pushed replay entry DOES re-pop the banner (proves the harness exercises the replay effect)", async () => {
    // Two real entries — the first carries the replay params, the
    // second is clean. Navigating Back from the clean entry must
    // restore the replay URL and re-trigger the banner. If this fails,
    // the back/forward plumbing is broken and the silence in the
    // primary test above is meaningless.
    renderWithHistory(
      ["/payments?openReceipt=PAY-00099&audit=stale-audit", "/payments"],
      1,
    );

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/payments"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(auditFetches).toBe(0);

    act(() => navBack());
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/payments?openReceipt=PAY-00099&audit=stale-audit",
      ),
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(auditFetches).toBeGreaterThanOrEqual(1);
  });
});
