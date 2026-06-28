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
 * Regression test for the replay-effect cancellation when the URL
 * params change while a previous audit fetch is still in flight.
 *
 * Scenario:
 *   - User opens /payments?openReceipt=PAY-A&audit=AUDIT-A (slow fetch).
 *   - Before A resolves, the URL switches to ?openReceipt=PAY-B&audit=AUDIT-B.
 *   - The B fetch is allowed to resolve first, then A resolves late.
 *
 * The replay effect's cleanup MUST cancel the A run so its late
 * resolution can never call setReplayInitial / setReplayAuditId /
 * setCreateOpen. Otherwise the PaymentForm would mount with a MIXED
 * prefill — e.g. receipt_no from A but amount/booking from B (or the
 * dialog flashing A's data over B's). That's the "mixed prefill from
 * different audits" bug class this test pins down.
 *
 * Assertions:
 *   1. Every PaymentForm mount that ever happens is internally
 *      consistent: receipt_no, booking_id, amount, prefillAuditId all
 *      belong to the SAME audit payload — never a Frankenstein of A+B.
 *   2. The PaymentForm never mounts with audit A's id after the URL
 *      has switched to B (the late A resolution must be a no-op).
 */

type MountSnapshot = {
  receipt: string;
  bookingId: string;
  amount: number | string;
  paymentMode: string;
  paymentHead: string;
  prefillAuditId: string | null;
  replayBlocked: boolean;
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
      replayBlocked: !!props.replayBlocked,
    });
    return (
      <div data-testid="payment-form-stub">
        <div data-testid="pf-receipt">{props.initial?.receipt_no ?? ""}</div>
        <div data-testid="pf-booking">{props.initial?.booking_id ?? ""}</div>
        <div data-testid="pf-amount">{String(props.initial?.amount ?? "")}</div>
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

// Two distinct audit payloads. Internally consistent — A's fields
// belong to A's receipt/booking, B's fields belong to B's. If anything
// gets mixed (A's receipt with B's amount, etc.) the consistency check
// at the bottom will catch it.
const AUDIT_PAYLOADS: Record<string, { entity_id: string; after: any }> = {
  "AUDIT-A": {
    entity_id: "PAY-A",
    after: {
      booking_id: "BK-AAA",
      payment_mode: "Bank Transfer",
      amount: 111111,
      payment_head: "Installment",
    },
  },
  "AUDIT-B": {
    entity_id: "PAY-B",
    after: {
      booking_id: "BK-BBB",
      payment_mode: "Cash",
      amount: 222222,
      payment_head: "Advance",
    },
  },
};

// Each call to maybeSingle() captures the requested audit id at call
// time and returns a deferred we can resolve in any order from the
// test. This is what lets us interleave fetch resolutions for A and B.
type Deferred = {
  auditId: string;
  promise: Promise<{ data: any; error: any }>;
  resolve: () => void;
};
const deferreds: Deferred[] = [];

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
      let resolveFn!: (v: { data: any; error: any }) => void;
      const promise = new Promise<{ data: any; error: any }>((r) => {
        resolveFn = r;
      });
      const payload = AUDIT_PAYLOADS[auditId];
      const entry: Deferred = {
        auditId,
        promise,
        resolve: () =>
          resolveFn({
            data: payload ? { entity_id: payload.entity_id, after: payload.after } : null,
            error: null,
          }),
      };
      deferreds.push(entry);
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
  if (!d) throw new Error(`No deferred captured for ${auditId}. Captured: ${deferreds.map((x) => x.auditId).join(",")}`);
  return d;
}

beforeEach(() => {
  formMounts.length = 0;
  deferreds.length = 0;
});
afterEach(() => cleanup());

describe("Payments: rapid URL switches never produce a mixed-audit PaymentForm prefill", () => {
  it("URL A → URL B (mid-flight) → resolve B then late-resolve A: no mount mixes fields from the two audits", async () => {
    renderApp("/payments?openReceipt=PAY-A&audit=AUDIT-A");

    // 1. The replay effect started fetching AUDIT-A. Nothing mounted yet.
    await waitFor(() => expect(deferreds.length).toBe(1));
    expect(deferreds[0].auditId).toBe("AUDIT-A");
    expect(formMounts.length).toBe(0);
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();

    // 2. Rapidly switch the URL to AUDIT-B before A resolves. The
    //    effect cleanup must flip A's `cancelled = true`.
    act(() => navTo("/payments?openReceipt=PAY-B&audit=AUDIT-B"));
    await waitFor(() => expect(deferreds.length).toBe(2));
    expect(deferreds[1].auditId).toBe("AUDIT-B");

    // 3. Resolve B FIRST → dialog mounts with B's payload.
    await act(async () => {
      findDeferred("AUDIT-B").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("pf-receipt").textContent).toBe("PAY-B");
    expect(screen.getByTestId("pf-booking").textContent).toBe("BK-BBB");
    expect(screen.getByTestId("pf-amount").textContent).toBe("222222");
    expect(screen.getByTestId("pf-audit").textContent).toBe("AUDIT-B");

    const mountsAfterB = formMounts.length;

    // 4. Now LATE-resolve A. Without the cancellation safeguard this
    //    would call setReplayInitial / setReplayAuditId with A's data,
    //    causing the dialog to re-render with PAY-A's receipt over
    //    PAY-B's already-mounted form — a classic mixed prefill.
    await act(async () => {
      findDeferred("AUDIT-A").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 30));

    // 5. The dialog must still show B's data — A's late resolution
    //    was a no-op.
    expect(screen.getByTestId("pf-receipt").textContent).toBe("PAY-B");
    expect(screen.getByTestId("pf-booking").textContent).toBe("BK-BBB");
    expect(screen.getByTestId("pf-amount").textContent).toBe("222222");
    expect(screen.getByTestId("pf-audit").textContent).toBe("AUDIT-B");

    // 6. No NEW mount snapshot was produced by A's late resolution
    //    (a re-render would push another entry into formMounts).
    expect(formMounts.length).toBe(mountsAfterB);

    // 7. Every mount that ever happened is INTERNALLY CONSISTENT —
    //    receipt + booking + amount + audit id all belong to the same
    //    payload. This is the core anti-mixing assertion.
    for (const m of formMounts) {
      const expected = Object.values(AUDIT_PAYLOADS).find(
        (p) => p.entity_id === m.receipt,
      );
      expect(expected, `unexpected receipt ${m.receipt} in mount`).toBeTruthy();
      expect(m.bookingId).toBe(expected!.after.booking_id);
      expect(m.amount).toBe(expected!.after.amount);
      expect(m.paymentMode).toBe(expected!.after.payment_mode);
      expect(m.paymentHead).toBe(expected!.after.payment_head);
      // The audit id captured on this mount must be the one whose
      // entity_id matches the receipt — never a cross-wired pair.
      const expectedAuditId = Object.entries(AUDIT_PAYLOADS).find(
        ([, v]) => v.entity_id === m.receipt,
      )![0];
      expect(m.prefillAuditId).toBe(expectedAuditId);
      expect(m.replayBlocked).toBe(true);
    }

    // 8. After the URL switched to B, no mount should EVER carry
    //    AUDIT-A's id — that would be the late-A leak.
    const auditAMountsAfterSwitch = formMounts.filter(
      (m) => m.prefillAuditId === "AUDIT-A",
    );
    // If the early A run mounted before the URL switch we'd see one,
    // but the URL switched before A resolved, so this must be zero.
    expect(auditAMountsAfterSwitch.length).toBe(0);
  });

  it("reverse interleaving (A resolves first then B): final dialog reflects B, never a mix", async () => {
    renderApp("/payments?openReceipt=PAY-A&audit=AUDIT-A");
    await waitFor(() => expect(deferreds.length).toBe(1));

    act(() => navTo("/payments?openReceipt=PAY-B&audit=AUDIT-B"));
    await waitFor(() => expect(deferreds.length).toBe(2));

    // Resolve A FIRST while the URL is already B. A's resolution must
    // be a no-op (cancelled), so nothing mounts yet.
    await act(async () => {
      findDeferred("AUDIT-A").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);

    // Now resolve B → dialog mounts cleanly with B's data only.
    await act(async () => {
      findDeferred("AUDIT-B").resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("pf-receipt").textContent).toBe("PAY-B");
    expect(screen.getByTestId("pf-booking").textContent).toBe("BK-BBB");
    expect(screen.getByTestId("pf-amount").textContent).toBe("222222");
    expect(screen.getByTestId("pf-audit").textContent).toBe("AUDIT-B");

    // Same consistency invariant — every mount belongs to a single
    // audit payload.
    for (const m of formMounts) {
      const expected = Object.values(AUDIT_PAYLOADS).find(
        (p) => p.entity_id === m.receipt,
      );
      expect(expected).toBeTruthy();
      expect(m.bookingId).toBe(expected!.after.booking_id);
      expect(m.amount).toBe(expected!.after.amount);
    }
    // No mount should carry AUDIT-A's id, since A was cancelled.
    expect(formMounts.every((m) => m.prefillAuditId !== "AUDIT-A")).toBe(true);
  });
});
