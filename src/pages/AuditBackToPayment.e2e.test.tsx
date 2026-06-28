import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- Captured props ------------------------------------------------------
// We stub PaymentForm so we can both (a) assert it mounted and (b) capture
// the `initial` prop the Payments page prefills it with after navigating
// from the audit log back-link.
const formCalls: { initial: any; replayBlocked: boolean; prefillAuditId: string | null }[] = [];

vi.mock("@/components/PaymentForm", () => ({
  PAYMENT_TYPES: ["Cash", "Bank Transfer", "Adjustment/Asset"],
  PaymentForm: (props: any) => {
    formCalls.push({
      initial: props.initial,
      replayBlocked: props.replayBlocked,
      prefillAuditId: props.prefillAuditId,
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
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

// --- Supabase mock -------------------------------------------------------
// audit_logs needs two access patterns:
//   1. AuditLog list:  from("audit_logs").select(...).order(...).limit(...) -> await
//   2. Payments fetch: from("audit_logs").select(...).eq(...).maybeSingle()
// payments table:      from("payments").select(...).order(...) -> await
const BLOCKED_ROW = {
  id: "aud-blocked-1",
  created_at: "2026-06-01T10:00:00Z",
  actor_email: "staff@example.com",
  action: "payment.save.blocked",
  entity: "payment",
  entity_id: "PAY-00042",
  after: {
    booking_id: "BK-001",
    payment_mode: "Bank Transfer",
    amount: 250000,
    payment_head: "Installment",
  },
};

vi.mock("@/integrations/supabase/client", () => {
  const auditBuilder = () => {
    const b: any = {};
    b.select = () => b;
    b.order = () => b;
    b.limit = () => b;
    b.eq = () => b;
    b.maybeSingle = async () => ({
      data: { after: BLOCKED_ROW.after, entity_id: BLOCKED_ROW.entity_id },
      error: null,
    });
    // Thenable for the list-fetch path (await q).
    b.then = (resolve: any) => resolve({ data: [BLOCKED_ROW], error: null });
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

// Imports must come AFTER vi.mock calls.
import AuditLog from "./AuditLog";
import Payments from "./Payments";

function renderApp(initialUrl = "/audit") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Routes>
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/payments" element={<Payments />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => { formCalls.length = 0; });
afterEach(() => cleanup());

describe("AuditLog -> Payments back-link e2e", () => {
  it("shows loading spinner on click, then opens Payments dialog with prefilled form", async () => {
    renderApp("/audit");

    // 1. The audit row is rendered with the back-link.
    const link = await screen.findByRole("link", { name: /back to payment/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe(
      "/payments?openReceipt=PAY-00042&audit=aud-blocked-1"
    );

    // 2. Click — loading state appears synchronously before the deferred
    //    navigation (setTimeout 0) runs.
    fireEvent.click(link);
    const busyText = screen.getByText(/opening payment form/i);
    expect(busyText).toBeInTheDocument();
    expect(busyText.closest("a")?.getAttribute("aria-busy")).toBe("true");
    // Spinner icon is rendered alongside the label.
    expect(busyText.closest("a")?.querySelector("svg.animate-spin")).not.toBeNull();

    // 3. Navigation happens on next tick — Payments mounts, fetches audit
    //    row, opens the dialog, and renders PaymentForm with prefill.
    const stub = await screen.findByTestId("payment-form-stub");
    expect(stub).toBeInTheDocument();

    // 4. Prefilled values match the audit `after` payload + URL receipt.
    expect(screen.getByTestId("pf-receipt").textContent).toBe("PAY-00042");
    expect(screen.getByTestId("pf-booking").textContent).toBe("BK-001");
    expect(screen.getByTestId("pf-mode").textContent).toBe("Bank Transfer");
    expect(screen.getByTestId("pf-amount").textContent).toBe("250000");
    expect(screen.getByTestId("pf-head").textContent).toBe("Installment");
    expect(screen.getByTestId("pf-replay").textContent).toBe("yes");
    expect(screen.getByTestId("pf-audit").textContent).toBe("aud-blocked-1");

    // 5. Dialog title reflects replay mode.
    expect(
      await screen.findByText(/replay blocked payment/i)
    ).toBeInTheDocument();

    // 6. The captured props confirm replayBlocked + prefillAuditId were
    //    threaded through.
    const last = formCalls[formCalls.length - 1];
    expect(last.replayBlocked).toBe(true);
    expect(last.prefillAuditId).toBe("aud-blocked-1");
    expect(last.initial).toMatchObject({
      receipt_no: "PAY-00042",
      booking_id: "BK-001",
      payment_mode: "Bank Transfer",
      amount: 250000,
      payment_head: "Installment",
    });
  });
});
