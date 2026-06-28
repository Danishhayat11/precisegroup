import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Capture every PaymentForm mount so we can prove no prefill leaks after
// the user dismisses the replay error with "Start a fresh payment instead".
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
        <div data-testid="pf-booking">{props.initial?.booking_id ?? ""}</div>
        <div data-testid="pf-mode">{props.initial?.payment_mode ?? ""}</div>
        <div data-testid="pf-amount">{String(props.initial?.amount ?? "")}</div>
        <div data-testid="pf-head">{props.initial?.payment_head ?? ""}</div>
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
    // Force the "audit entry not found" banner path.
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
  return <div data-testid="location">{loc.pathname}{loc.search}</div>;
}

function renderAt(url: string) {
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
    </QueryClientProvider>
  );
}

beforeEach(() => { formMounts.length = 0; });
afterEach(() => cleanup());

describe("Payments: 'Start a fresh payment instead' fully resets state", () => {
  it("clears URL params, dismisses the banner, and the next dialog mount has no prefill", async () => {
    renderAt("/payments?openReceipt=PAY-00099&audit=stale-audit");

    // 1. Banner appears from the failed audit lookup.
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // 2. URL still carries the replay params at this point (intentional, so
    //    a refresh re-prefills the form — but we're about to dismiss).
    const before = screen.getByTestId("location").textContent ?? "";
    expect(before).toContain("openReceipt=PAY-00099");
    expect(before).toContain("audit=stale-audit");
    // 3. Replay dialog must NOT have opened (lookup failed).
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();

    // 4. User clicks the shortcut.
    fireEvent.click(
      screen.getByRole("button", { name: /start a fresh payment instead/i })
    );

    // 5. Banner is gone and the URL is stripped of BOTH replay params.
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    const after = screen.getByTestId("location").textContent ?? "";
    expect(after).not.toContain("openReceipt");
    expect(after).not.toContain("audit=");
    expect(after).toBe("/payments");

    // 6. Click "Record payment" — the dialog must open with a blank form.
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    const stub = await screen.findByTestId("payment-form-stub");
    expect(stub).toBeInTheDocument();

    // 7. None of the replay payload leaked into the new form.
    expect(screen.getByTestId("pf-receipt").textContent).toBe("");
    expect(screen.getByTestId("pf-booking").textContent).toBe("");
    expect(screen.getByTestId("pf-mode").textContent).toBe("");
    expect(screen.getByTestId("pf-amount").textContent).toBe("");
    expect(screen.getByTestId("pf-head").textContent).toBe("");
    expect(screen.getByTestId("pf-replay").textContent).toBe("no");

    // 8. Dialog title is the fresh-entry one, not the replay one.
    expect(screen.getAllByText(/^record payment$/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/replay blocked payment/i)).not.toBeInTheDocument();

    // 9. Captured props confirm: replayBlocked=false, no audit id, undefined initial.
    const last = formMounts[formMounts.length - 1];
    expect(last.replayBlocked).toBe(false);
    expect(last.prefillAuditId).toBeNull();
    expect(last.initial).toBeUndefined();
  });

  it("a second visit to /payments (no params) does NOT re-trigger the replay flow", async () => {
    renderAt("/payments");
    // No banner, no dialog auto-opened, no PaymentForm mounted.
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/payments")
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
    expect(formMounts.length).toBe(0);
  });
});
