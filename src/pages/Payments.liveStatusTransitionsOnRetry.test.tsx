import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  act,
  fireEvent,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Verifies the aria-live status messaging for the audit-fetch failure
 * across the FAIL → RETRY → SUCCESS transition:
 *
 *   1. Initial failure: the page's `role="alert"` + `aria-live="assertive"`
 *      banner appears with the EXACT `${title}: ${detail}` reason for
 *      the failure branch. No PaymentForm is mounted (route guard), so
 *      its own in-form `aria-live` status is absent.
 *
 *   2. After clicking Retry and the retry resolving successfully:
 *      - the failure banner is REMOVED from the DOM (the aria-live
 *        region no longer carries the failure text — SRs treat
 *        removal as "cleared"),
 *      - the PaymentForm finally mounts WITHOUT a `lockedReason`
 *        (because `replayError` is now `null`), so the form's own
 *        lock-status aria-live region is rendered EMPTY — i.e. the
 *        lock announcement has been cleared.
 *
 * The test asserts the exact reason string, the exact aria-live wiring
 * on the banner, and the exact lockedReason flowing into PaymentForm.
 */

// -- PaymentForm stub that exposes its `lockedReason` prop so we can
// assert what the page is wiring through on each render.
const formMounts: Array<{ lockedReason: string | undefined; locked: boolean | undefined }> = [];

vi.mock("@/components/PaymentForm", () => ({
  PAYMENT_TYPES: ["Cash", "Bank Transfer", "Adjustment/Asset"],
  PaymentForm: (props: any) => {
    formMounts.push({ lockedReason: props.lockedReason, locked: !!props.locked });
    return (
      <div data-testid="payment-form-stub">
        <div
          data-testid="payment-form-lock-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-locked={props.locked ? "true" : "false"}
        >
          {props.locked ? (props.lockedReason ?? "") : ""}
        </div>
        <input
          data-testid="payment-form-receipt"
          defaultValue={String(props.initial?.receipt_no ?? "")}
        />
        <button type="submit" data-testid="payment-form-submit">Save</button>
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

// -- Per-call sequenced supabase mock (call #1 of AUDIT-X fails, #2 succeeds).
const SUCCESS_PAYLOAD = {
  entity_id: "PAY-X",
  after: { booking_id: "BK-X", payment_mode: "Bank Transfer", amount: 77777, payment_head: "Installment" },
};
const callModes = new Map<string, Array<"success" | "missing" | "error">>();
const deferreds: Array<{
  auditId: string;
  callIdx: number;
  resolve: () => void;
}> = [];
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
      const callIdx = (fetchCountByAudit.get(auditId) ?? 0) + 1;
      fetchCountByAudit.set(auditId, callIdx);
      let resolveFn!: (v: { data: any; error: any }) => void;
      const promise = new Promise<{ data: any; error: any }>((r) => {
        resolveFn = r;
      });
      const seq = callModes.get(auditId) ?? ["missing"];
      const mode = seq[Math.min(callIdx - 1, seq.length - 1)];
      deferreds.push({
        auditId,
        callIdx,
        resolve: () => {
          if (mode === "success") {
            resolveFn({ data: SUCCESS_PAYLOAD, error: null });
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

function renderApp(initial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/payments" element={<Payments />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function findDeferred(auditId: string, callIdx: number) {
  const d = deferreds.find((x) => x.auditId === auditId && x.callIdx === callIdx);
  if (!d) throw new Error(`no deferred ${auditId}#${callIdx}`);
  return d;
}

beforeEach(() => {
  formMounts.length = 0;
  deferreds.length = 0;
  fetchCountByAudit.clear();
  callModes.clear();
});
afterEach(() => cleanup());

describe("Payments: aria-live status updates and clears on fail → success transition", () => {
  it("ERROR → RETRY → SUCCESS: banner shows the exact reason, then is removed; in-form lock status is rendered empty after success", async () => {
    callModes.set("AUDIT-X", ["error", "success"]);

    renderApp("/payments?openReceipt=PAY-X&audit=AUDIT-X");

    // 1. Wait for the first fetch to be issued, then resolve as ERROR.
    await waitFor(() => expect(deferreds.length).toBe(1));
    await act(async () => {
      findDeferred("AUDIT-X", 1).resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 2. Failure banner is present, aria-live wired, exact reason text.
    const banner = await screen.findByTestId("replay-error-banner");
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveAttribute("aria-live", "assertive");
    expect(banner).toHaveAttribute("aria-atomic", "true");

    const expectedTitle = "Couldn't load the blocked attempt";
    const expectedDetail = "boom Try opening it again from the Audit Log.";
    expect(banner.textContent).toContain(expectedTitle);
    expect(banner.textContent).toContain(expectedDetail);

    // PaymentForm is absent during the failure (route guard).
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-form-lock-status")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);

    // 3. Click Retry → banner clears immediately, a 2nd fetch is issued
    //    for the SAME audit id.
    const retryBtn = screen.getByRole("button", { name: /retry latest audit fetch/i });
    await act(async () => {
      fireEvent.click(retryBtn);
      await Promise.resolve();
    });

    // Banner removed the moment retry is clicked (replayError cleared).
    expect(screen.queryByTestId("replay-error-banner")).not.toBeInTheDocument();

    await waitFor(() => expect(deferreds.length).toBe(2));
    expect(fetchCountByAudit.get("AUDIT-X")).toBe(2);

    // Form still absent while retry is in flight.
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();

    // 4. Resolve retry as SUCCESS → PaymentForm mounts, no lockedReason.
    await act(async () => {
      findDeferred("AUDIT-X", 2).resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );

    // Banner stays absent (cleared aria-live).
    expect(screen.queryByTestId("replay-error-banner")).not.toBeInTheDocument();

    // In-form aria-live lock status is mounted but EMPTY — i.e. the
    // lock announcement has been cleared.
    const lockStatus = screen.getByTestId("payment-form-lock-status");
    expect(lockStatus).toHaveAttribute("role", "status");
    expect(lockStatus).toHaveAttribute("aria-live", "polite");
    expect(lockStatus).toHaveAttribute("aria-atomic", "true");
    expect(lockStatus.getAttribute("data-locked")).toBe("false");
    expect((lockStatus.textContent ?? "").trim()).toBe("");

    // Form was mounted exactly once, unlocked, with no lockedReason.
    expect(formMounts.length).toBe(1);
    expect(formMounts[0].locked).toBe(false);
    expect(formMounts[0].lockedReason).toBeUndefined();
  });

  it("MISSING → RETRY → SUCCESS: aria-live banner shows the exact 'Audit entry not found' reason, then clears", async () => {
    const AUDIT = "AUDIT-X";
    callModes.set(AUDIT, ["missing", "success"]);

    renderApp(`/payments?openReceipt=PAY-X&audit=${AUDIT}`);
    await waitFor(() => expect(deferreds.length).toBe(1));
    await act(async () => {
      findDeferred(AUDIT, 1).resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const banner = await screen.findByTestId("replay-error-banner");
    expect(banner).toHaveAttribute("aria-live", "assertive");
    expect(banner.textContent).toContain("Audit entry not found");
    expect(banner.textContent).toContain(
      `No blocked-save record exists for audit id ${AUDIT}. It may have been pruned, or the link is stale.`,
    );

    // Retry → success.
    fireEvent.click(screen.getByRole("button", { name: /retry latest audit fetch/i }));
    expect(screen.queryByTestId("replay-error-banner")).not.toBeInTheDocument();

    await waitFor(() => expect(deferreds.length).toBe(2));
    await act(async () => {
      findDeferred(AUDIT, 2).resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId("payment-form-stub")).toBeInTheDocument(),
    );

    // Banner gone; in-form lock status empty.
    expect(screen.queryByTestId("replay-error-banner")).not.toBeInTheDocument();
    expect((screen.getByTestId("payment-form-lock-status").textContent ?? "").trim()).toBe("");
    expect(formMounts.at(-1)?.lockedReason).toBeUndefined();
    expect(formMounts.at(-1)?.locked).toBe(false);
  });
});
