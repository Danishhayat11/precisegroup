import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- Mocks ---------------------------------------------------------------

// PaymentForm pulls in supabase + many heavy children. Stub it for these
// integration tests — we only care about the replay-error banner behavior on
// the Payments page itself.
vi.mock("@/components/PaymentForm", () => ({
  PAYMENT_TYPES: ["Cash", "Bank Transfer", "Adjustment/Asset"],
  PaymentForm: () => <div data-testid="payment-form-stub" />,
}));
vi.mock("@/components/PaymentReceipt", () => ({
  PaymentReceipt: () => null,
}));
vi.mock("@/components/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

// Drive supabase responses per-test via this controller.
const auditState: {
  data: { after: any; entity_id: string | null } | null;
  error: { message: string } | null;
} = { data: null, error: null };

vi.mock("@/integrations/supabase/client", () => {
  const auditBuilder = () => {
    const b: any = {};
    b.select = () => b;
    b.eq = () => b;
    b.order = () => b;
    b.maybeSingle = async () => ({ data: auditState.data, error: auditState.error });
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

// --- Helpers -------------------------------------------------------------

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
          <Route path="/audit" element={<div>audit page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  auditState.data = null;
  auditState.error = null;
});
afterEach(() => cleanup());

// --- Tests ---------------------------------------------------------------

describe("Payments replay-error banner", () => {
  it("shows 'Audit entry not found' when the audit row is missing", async () => {
    auditState.data = null;
    auditState.error = null;
    renderAt("/payments?openReceipt=PAY-00012&audit=missing-id");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Audit entry not found")
    );
    expect(screen.getByRole("alert")).toHaveTextContent("missing-id");
    expect(screen.getByRole("alert")).toHaveTextContent("PAY-00012");
    // Form dialog must NOT open when lookup fails.
    expect(screen.queryByTestId("payment-form-stub")).not.toBeInTheDocument();
  });

  it("shows 'Couldn't load' on a fetch error", async () => {
    auditState.error = { message: "network blew up" };
    renderAt("/payments?openReceipt=PAY-00013&audit=some-id");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the blocked attempt")
    );
    expect(screen.getByRole("alert")).toHaveTextContent("network blew up");
  });

  it("shows mismatch banner when entity_id doesn't match the receipt", async () => {
    auditState.data = { after: {}, entity_id: "PAY-99999" };
    renderAt("/payments?openReceipt=PAY-00014&audit=mismatch-id");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Audit entry doesn't match this receipt")
    );
    expect(screen.getByRole("alert")).toHaveTextContent("PAY-99999");
    expect(screen.getByRole("alert")).toHaveTextContent("PAY-00014");
  });

  it("dismiss (X) button clears the banner and strips URL params", async () => {
    renderAt("/payments?openReceipt=PAY-00015&audit=missing");

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByTestId("location").textContent).toContain("openReceipt=PAY-00015");
    expect(screen.getByTestId("location").textContent).toContain("audit=missing");

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    const loc = screen.getByTestId("location").textContent ?? "";
    expect(loc).not.toContain("openReceipt");
    expect(loc).not.toContain("audit=");
  });

  it("'Start a fresh payment instead' shortcut clears banner and URL params", async () => {
    renderAt("/payments?openReceipt=PAY-00016&audit=missing");

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /start a fresh payment instead/i }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    const loc = screen.getByTestId("location").textContent ?? "";
    expect(loc).not.toContain("openReceipt");
    expect(loc).not.toContain("audit=");
  });

  it("'Open Audit Log' shortcut links to /audit?highlight=<auditId>", async () => {
    renderAt("/payments?openReceipt=PAY-00017&audit=aud-xyz");

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const link = screen.getByRole("link", { name: /open audit log/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/audit?highlight=aud-xyz");
  });
});
