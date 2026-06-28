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
 * Regression test: when the LATEST audit fetch fails during rapid
 * `?openReceipt=…&audit=…` swaps, the PaymentForm and any of its
 * controls/actions (Submit, Save, form fields, prefilled inputs) must
 * remain INACCESSIBLE — i.e. NOT mounted anywhere in the DOM — until
 * a successful latest-prefill arrives via a fresh audit fetch.
 *
 * The contract enforced here:
 *   1. Latest fetch fails (missing or error) → error banner is shown
 *      and the PaymentForm stays out of the DOM. There is no Submit
 *      button, no Save button, no form fields, no dialog, nothing the
 *      user could interact with to commit a stale-prefilled payment.
 *   2. While that failure is on screen, late-resolving successful
 *      fetches for earlier cancelled audits MUST NOT cause the form
 *      to mount with their stale data.
 *   3. Once the user swaps to a NEW audit whose fetch succeeds, and
 *      only once that successful latest prefill is available, the
 *      PaymentForm finally mounts — with the latest audit's data,
 *      and exposing its interactive controls for the first time.
 *
 * Why "stays out of the DOM" counts as "disabled/inaccessible":
 *   The PaymentForm in this codebase only mounts inside a Dialog that
 *   is opened by the replay effect after a successful prefill. There
 *   is no half-mounted/disabled state — either the form is mounted
 *   with valid prefill or it is absent entirely. Asserting absence is
 *   strictly stronger than asserting `disabled` on individual fields:
 *   no element exists for the user to focus, tab to, click, or
 *   submit. This is the most robust form of "actions remain
 *   inaccessible until success".
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
    // Render realistic interactive controls so absence of the form
    // also asserts absence of its actions (Submit / Save / fields).
    return (
      <form data-testid="payment-form-stub">
        <input
          data-testid="payment-form-amount"
          name="amount"
          defaultValue={String(props.initial?.amount ?? "")}
        />
        <input
          data-testid="payment-form-receipt"
          name="receipt_no"
          defaultValue={String(props.initial?.receipt_no ?? "")}
        />
        <button type="submit" data-testid="payment-form-submit">Save</button>
        <button type="button" data-testid="payment-form-cancel">Cancel</button>
      </form>
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

const SUCCESS_PAYLOADS: Record<
  string,
  { entity_id: string; after: { booking_id: string; payment_mode: string; amount: number; payment_head: string } }
> = {
  "AUDIT-A": { entity_id: "PAY-A", after: { booking_id: "BK-A", payment_mode: "Bank Transfer", amount: 11111, payment_head: "Installment" } },
  "AUDIT-B": { entity_id: "PAY-B", after: { booking_id: "BK-B", payment_mode: "Cash",          amount: 22222, payment_head: "Advance" } },
  "AUDIT-D": { entity_id: "PAY-D", after: { booking_id: "BK-D", payment_mode: "Cash",          amount: 55555, payment_head: "Down Payment" } },
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

function expectFormControlsAbsent() {
  expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
  expect(screen.queryByTestId("payment-form-submit")).not.toBeInTheDocument();
  expect(screen.queryByTestId("payment-form-cancel")).not.toBeInTheDocument();
  expect(screen.queryByTestId("payment-form-amount")).not.toBeInTheDocument();
  expect(screen.queryByTestId("payment-form-receipt")).not.toBeInTheDocument();
  // No generic save/submit fallback either.
  expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
}

beforeEach(() => {
  formMounts.length = 0;
  deferreds.length = 0;
  fetchCountByAudit.clear();
  fetchMode.clear();
});
afterEach(() => cleanup());

describe("Payments: latest audit fetch fails → PaymentForm controls/actions inaccessible until successful latest prefill arrives", () => {
  it("MISSING latest: form + all its actions are absent through the failure and through late-resolving earlier successes; only re-appear when a NEW audit succeeds", async () => {
    fetchMode.set("AUDIT-A", "success");
    fetchMode.set("AUDIT-B", "success");
    fetchMode.set("AUDIT-C", "missing"); // latest fails
    fetchMode.set("AUDIT-D", "success"); // the eventual recovery

    // 1. Rapid A → B → C, all fetches pending.
    renderApp("/payments?openReceipt=PAY-A&audit=AUDIT-A");
    await waitFor(() => expect(deferreds.length).toBe(1));
    expectFormControlsAbsent();

    act(() => navTo("/payments?openReceipt=PAY-B&audit=AUDIT-B"));
    await waitFor(() => expect(deferreds.length).toBe(2));
    expectFormControlsAbsent();

    act(() => navTo("/payments?openReceipt=PAY-C&audit=AUDIT-C"));
    await waitFor(() => expect(deferreds.length).toBe(3));
    expectFormControlsAbsent();

    // 2. Resolve C (latest, MISSING) → banner up, controls still absent.
    await act(async () => {
      findDeferred("AUDIT-C").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/audit entry not found/i);
    expectFormControlsAbsent();
    expect(formMounts.length).toBe(0);

    // 3. Late-resolve A then B (both SUCCESS). Controls MUST stay
    //    absent — no stale-prefill form must materialise.
    await act(async () => {
      findDeferred("AUDIT-A").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 20));
    expectFormControlsAbsent();
    expect(formMounts.length).toBe(0);

    await act(async () => {
      findDeferred("AUDIT-B").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 20));
    expectFormControlsAbsent();
    expect(formMounts.length).toBe(0);

    // Banner still shows the failure.
    expect(screen.getByRole("alert").textContent).toMatch(/audit entry not found/i);

    // 4. Swap to a NEW audit (D) whose fetch eventually succeeds.
    act(() => navTo("/payments?openReceipt=PAY-D&audit=AUDIT-D"));
    await waitFor(() => expect(deferreds.length).toBe(4));

    // Until D resolves the form / its controls must remain absent.
    expectFormControlsAbsent();
    expect(formMounts.length).toBe(0);

    // 5. Resolve D → only NOW the form (and its actions) become
    //    accessible, with D's prefill.
    await act(async () => {
      findDeferred("AUDIT-D").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );
    // All interactive controls are now in the DOM.
    expect(screen.getByTestId("payment-form-submit")).toBeInTheDocument();
    expect(screen.getByTestId("payment-form-cancel")).toBeInTheDocument();
    expect(screen.getByTestId("payment-form-amount")).toBeInTheDocument();
    expect(screen.getByTestId("payment-form-receipt")).toBeInTheDocument();

    // Exactly one mount in total, with D's data — no stale leak.
    expect(formMounts.length).toBe(1);
    expect(formMounts[0]).toMatchObject({
      receipt: "PAY-D",
      bookingId: "BK-D",
      amount: 55555,
      paymentMode: "Cash",
      paymentHead: "Down Payment",
      prefillAuditId: "AUDIT-D",
    });
    // And the inputs reflect D's prefill, not A/B/C residue.
    expect((screen.getByTestId("payment-form-amount") as HTMLInputElement).value).toBe("55555");
    expect((screen.getByTestId("payment-form-receipt") as HTMLInputElement).value).toBe("PAY-D");

    // Each audit fetched exactly once.
    expect(fetchCountByAudit.get("AUDIT-A")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-B")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-C")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-D")).toBe(1);
  });

  it("ERROR latest: form + all its actions stay inaccessible through the failure and late successes; appear only when a NEW success lands", async () => {
    fetchMode.set("AUDIT-A", "success");
    fetchMode.set("AUDIT-B", "success");
    fetchMode.set("AUDIT-C", "error"); // latest fails on error
    fetchMode.set("AUDIT-D", "success"); // recovery

    renderApp("/payments?openReceipt=PAY-A&audit=AUDIT-A");
    await waitFor(() => expect(deferreds.length).toBe(1));
    act(() => navTo("/payments?openReceipt=PAY-B&audit=AUDIT-B"));
    await waitFor(() => expect(deferreds.length).toBe(2));
    act(() => navTo("/payments?openReceipt=PAY-C&audit=AUDIT-C"));
    await waitFor(() => expect(deferreds.length).toBe(3));
    expectFormControlsAbsent();

    // Resolve C (error path).
    await act(async () => {
      findDeferred("AUDIT-C").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't load the blocked attempt/i);
    expectFormControlsAbsent();

    // Late-resolve A and B — controls must remain absent.
    await act(async () => {
      findDeferred("AUDIT-A").resolve();
      findDeferred("AUDIT-B").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 30));
    expectFormControlsAbsent();
    expect(formMounts.length).toBe(0);
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't load the blocked attempt/i);

    // Swap to a new valid audit D and resolve it → controls finally appear.
    act(() => navTo("/payments?openReceipt=PAY-D&audit=AUDIT-D"));
    await waitFor(() => expect(deferreds.length).toBe(4));
    expectFormControlsAbsent();

    await act(async () => {
      findDeferred("AUDIT-D").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("payment-form-submit")).toBeInTheDocument();
    expect(screen.getByTestId("payment-form-cancel")).toBeInTheDocument();

    expect(formMounts.length).toBe(1);
    expect(formMounts[0].prefillAuditId).toBe("AUDIT-D");
    expect(formMounts[0].receipt).toBe("PAY-D");
    expect((screen.getByTestId("payment-form-amount") as HTMLInputElement).value).toBe("55555");

    expect(fetchCountByAudit.get("AUDIT-A")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-B")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-C")).toBe(1);
    expect(fetchCountByAudit.get("AUDIT-D")).toBe(1);
  });
});
