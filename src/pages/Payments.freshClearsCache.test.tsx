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
 * Regression test: clicking "Start a fresh payment instead" must clear any
 * cached audit/receipt payload so the next "Record payment" click never
 * mounts PaymentForm with stale audit data.
 *
 * Failure mode this guards against: a prior successful replay populates
 * `replayInitial` / `replayAuditId` in Payments state. The user dismisses
 * that dialog (state cleared), then arrives at a SECOND replay URL whose
 * audit lookup fails. They click "Start a fresh payment instead". If the
 * dismiss handler were ever to skip the state reset — or react-query were
 * to hand back a memoised payload from the first audit fetch — the next
 * "Record payment" would mount PaymentForm with leftover prefill from
 * the first audit row. This test asserts that does NOT happen, end to end.
 */

// Capture every PaymentForm mount so we can scan for stale prefill.
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
        <div data-testid="pf-booking">{props.initial?.booking_id ?? ""}</div>
        <div data-testid="pf-mode">{props.initial?.payment_mode ?? ""}</div>
        <div data-testid="pf-amount">{String(props.initial?.amount ?? "")}</div>
        <div data-testid="pf-head">{props.initial?.payment_head ?? ""}</div>
        <div data-testid="pf-replay">{props.replayBlocked ? "yes" : "no"}</div>
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

// audit_logs.maybeSingle:
//   - audit-good  -> returns a real payload for PAY-00099 (success path)
//   - audit-bad   -> returns null (banner path)
// Count fetches so we can prove we DID re-fetch (no react-query cache reuse).
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
      if (queriedId === "audit-good") {
        return {
          data: {
            entity_id: "PAY-00099",
            after: {
              booking_id: "BK-AAA",
              payment_mode: "Bank Transfer",
              amount: 175000,
              payment_head: "Installment",
            },
          },
          error: null,
        };
      }
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

let navTo: (to: string) => void = () => {};
function NavController() {
  const navigate = useNavigate();
  navTo = (to: string) => navigate(to);
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
  auditFetches.length = 0;
});
afterEach(() => cleanup());

describe("'Start a fresh payment instead' clears cached audit/receipt payload", () => {
  it("after a successful replay → dismiss → failed replay → 'Start fresh', the next Record payment mounts a blank PaymentForm", async () => {
    // === Stage 1: successful replay populates replayInitial/replayAuditId ===
    renderApp("/payments?openReceipt=PAY-00099&audit=audit-good");

    // Replay dialog opens with PAY-00099 prefill.
    await screen.findByTestId("payment-form-stub");
    expect(screen.getByTestId("pf-receipt").textContent).toBe("PAY-00099");
    expect(screen.getByTestId("pf-mode").textContent).toBe("Bank Transfer");
    expect(screen.getByTestId("pf-amount").textContent).toBe("175000");
    expect(screen.getByTestId("pf-replay").textContent).toBe("yes");
    expect(screen.getByTestId("pf-audit").textContent).toBe("audit-good");
    expect(auditFetches).toEqual(["audit-good"]);

    // === Stage 2: user closes the dialog (clears replayInitial state) ===
    // PaymentForm is mocked so there's no in-form Cancel; close via the
    // shadcn Dialog's built-in "Close" affordance which triggers
    // onOpenChange(false) — same path the X icon click takes.
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));

    await waitFor(() =>
      expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument(),
    );
    // URL is cleaned by the cancel handler too.
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/payments"),
    );

    // === Stage 3: navigate to a DIFFERENT replay URL that fails ===
    act(() => navTo("/payments?openReceipt=PAY-00200&audit=audit-bad"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // We actually re-fetched — no react-query memo of the first audit row.
    expect(auditFetches).toEqual(["audit-good", "audit-bad"]);
    // Dialog must NOT have re-opened off stale replayInitial.
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();

    // === Stage 4: "Start a fresh payment instead" ===
    fireEvent.click(
      screen.getByRole("button", { name: /start a fresh payment instead/i }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("location").textContent).toBe("/payments");

    // === Stage 5: Record payment — must be a fully blank form ===
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    const stub = await screen.findByTestId("payment-form-stub");
    expect(stub).toBeInTheDocument();

    // No leftover prefill from PAY-00099 OR PAY-00200 anywhere.
    expect(screen.getByTestId("pf-receipt").textContent).toBe("");
    expect(screen.getByTestId("pf-booking").textContent).toBe("");
    expect(screen.getByTestId("pf-mode").textContent).toBe("");
    expect(screen.getByTestId("pf-amount").textContent).toBe("");
    expect(screen.getByTestId("pf-head").textContent).toBe("");
    expect(screen.getByTestId("pf-replay").textContent).toBe("no");
    expect(screen.getByTestId("pf-audit").textContent).toBe("");

    // Replay dialog title is gone; fresh-entry title is showing.
    expect(screen.queryByText(/replay blocked payment/i)).not.toBeInTheDocument();

    // The freshly-mounted PaymentForm has no stale props captured.
    const last = formMounts[formMounts.length - 1];
    expect(last.replayBlocked).toBe(false);
    expect(last.prefillAuditId).toBeNull();
    expect(last.initial).toBeUndefined();

    // Sanity: every PaymentForm that ever mounted in this test was either
    // the audit-good replay OR a blank fresh form — never the failed
    // audit-bad receipt with leaked audit-good prefill.
    for (const m of formMounts) {
      const receipt = m.initial?.receipt_no ?? "";
      const validReplay =
        m.replayBlocked && m.prefillAuditId === "audit-good" && receipt === "PAY-00099";
      const validFresh =
        !m.replayBlocked && m.prefillAuditId === null && m.initial === undefined;
      expect(validReplay || validFresh).toBe(true);
    }
  });
});
