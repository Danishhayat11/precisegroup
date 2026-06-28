import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Regression test: a full browser reload after "Start a fresh payment
 * instead" must NOT re-pop the replay banner or the replay dialog.
 *
 * Why this is the worst-case for the dismiss flow:
 *   - A reload throws away every piece of in-memory state (Payments
 *     component state, react-query cache, dialog open flag, etc.).
 *   - The ONLY thing that survives is the browser URL.
 *   - Payments' replay effect keys on `?openReceipt=…&audit=…` in that
 *     URL — so the dismiss handler must have called setParams with
 *     `{ replace: true }`. Otherwise the address bar still holds the
 *     replay URL and the reload re-triggers everything the user just
 *     dismissed.
 *
 * We simulate "reload" by tearing down the entire render tree
 * (including the QueryClient and MemoryRouter) and remounting a brand-
 * new app rooted at whatever URL was last in the address bar — exactly
 * what F5 / Cmd-R does in a real browser.
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

// audit_logs.maybeSingle → null (failed lookup, exposes the banner +
// "Start a fresh payment instead" button). Counted so we can assert
// the reload does NOT re-issue an audit fetch.
const auditFetches: string[] = [];
vi.mock("@/integrations/supabase/client", () => {
  const auditBuilder = () => {
    let queriedId: string | null = null;
    const b: any = {};
    b.select = () => b;
    b.eq = (_col: string, val: string) => {
      queriedId = val;
      return b;
    };
    b.order = () => b;
    b.maybeSingle = async () => {
      auditFetches.push(queriedId ?? "");
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

// Captures the "address bar" — the location at any point — so the
// simulated reload knows what URL to remount from.
let currentUrl = "/payments";
function LocationProbe() {
  const loc = useLocation();
  currentUrl = `${loc.pathname}${loc.search}`;
  return <div data-testid="location">{currentUrl}</div>;
}

function mountAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
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
  auditFetches.length = 0;
  currentUrl = "/payments";
});
afterEach(() => cleanup());

describe("Payments: simulated browser reload after fresh reset never re-pops replay UI", () => {
  it("after dismissing, F5 (full teardown + remount from current URL) leaves the banner and dialog dismissed", async () => {
    // === Initial load: URL carries replay params, lookup fails → banner ===
    mountAt("/payments?openReceipt=PAY-00099&audit=stale-audit");

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(auditFetches).toEqual(["stale-audit"]);
    expect(screen.getByTestId("location").textContent).toBe(
      "/payments?openReceipt=PAY-00099&audit=stale-audit",
    );

    // === Dismiss with "Start a fresh payment instead" ===
    fireEvent.click(
      screen.getByRole("button", { name: /start a fresh payment instead/i }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    // Address bar is now clean — this is the URL F5 will reload from.
    expect(currentUrl).toBe("/payments");
    const urlAfterDismiss = currentUrl;

    // === Simulate F5 / Cmd-R: tear down the entire app, remount from
    //     whatever the address bar currently shows. Anything cached in
    //     module-level state, react-query, or component memory is gone. ===
    cleanup();
    auditFetches.length = 0;
    formMounts.length = 0;

    mountAt(urlAfterDismiss);

    // Give the replay effect a generous window to (incorrectly) fire.
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/payments"),
    );
    await new Promise((r) => setTimeout(r, 30));

    // === Core regression assertions ===
    // No banner.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // No dialog auto-opened.
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(screen.queryByText(/replay blocked payment/i)).not.toBeInTheDocument();
    // No audit fetch issued — the replay effect short-circuits on the
    // missing `openReceipt` URL param.
    expect(auditFetches).toEqual([]);
    // No PaymentForm mounted off cached state.
    expect(formMounts.length).toBe(0);

    // === Sanity: manual Record payment still works and is blank ===
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    await screen.findByTestId("payment-form-stub");
    expect(screen.getByTestId("pf-receipt").textContent).toBe("");
    expect(screen.getByTestId("pf-replay").textContent).toBe("no");
    const last = formMounts[formMounts.length - 1];
    expect(last.replayBlocked).toBe(false);
    expect(last.prefillAuditId).toBeNull();
    expect(last.initial).toBeUndefined();
  });

  it("counter-test: if the user reloads BEFORE dismissing, the banner DOES re-pop (proves the reload is real)", async () => {
    // Confirms the reload harness actually exercises the replay effect —
    // so the first test's "no banner after reload" result is meaningful
    // rather than a side-effect of the test setup.
    mountAt("/payments?openReceipt=PAY-00099&audit=stale-audit");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(auditFetches).toEqual(["stale-audit"]);

    cleanup();
    auditFetches.length = 0;
    formMounts.length = 0;

    // Reload from the still-dirty URL (user never clicked the dismiss button).
    mountAt("/payments?openReceipt=PAY-00099&audit=stale-audit");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(auditFetches).toEqual(["stale-audit"]);
  });
});
