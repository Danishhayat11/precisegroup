import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { LETTERHEAD_URL } from "@/lib/print";
import { fmtPKR } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, Printer } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

function fmtDateDDMMYYYY(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${dt.getFullYear()}`;
}

function daysBetween(a: Date, b: Date) {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

function classifyMode(p: any): "Cash" | "Bank Transfer" | "Adjustment" {
  const m = String(p.payment_mode ?? "").toLowerCase();
  if (m.includes("adjust") || p.non_cash_adjustment) return "Adjustment";
  if (m.includes("bank") || m.includes("transfer") || m.includes("cheque")) return "Bank Transfer";
  return "Cash";
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function PaymentHistoryView() {
  const { bookingId = "" } = useParams();

  const { data, isLoading } = useQuery({
    queryKey: ["payment-history", bookingId],
    queryFn: async () => {
      const [b, pays, ledger] = await Promise.all([
        supabase.from("bookings").select("*").eq("booking_id", bookingId).maybeSingle(),
        supabase.from("payments").select("*").eq("booking_id", bookingId).order("payment_date"),
        supabase.from("installment_ledger").select("*").eq("booking_id", bookingId),
      ]);
      return {
        booking: b.data,
        payments: pays.data ?? [],
        ledger: ledger.data ?? [],
      };
    },
  });

  // On-screen filter state
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showAdjustments, setShowAdjustments] = useState(true);
  const [showRemarks, setShowRemarks] = useState(true);
  const [letterhead, setLetterhead] = useState<"precise" | "plain">("precise");

  const booking = data?.booking;
  const allPayments = data?.payments ?? [];
  const ledger = data?.ledger ?? [];

  // Apply filters
  const filtered = useMemo(() => {
    let rows = [...allPayments].sort((a, b) =>
      String(a.payment_date ?? "").localeCompare(String(b.payment_date ?? ""))
    );
    if (fromDate) rows = rows.filter((p) => String(p.payment_date ?? "") >= fromDate);
    if (toDate) rows = rows.filter((p) => String(p.payment_date ?? "") <= toDate);
    if (!showAdjustments) rows = rows.filter((p) => classifyMode(p) !== "Adjustment");
    return rows;
  }, [allPayments, fromDate, toDate, showAdjustments]);

  // Totals
  const totals = useMemo(() => {
    let cash = 0, bank = 0, adj = 0;
    for (const p of filtered) {
      const k = classifyMode(p);
      const amt = Number(p.amount) || 0;
      if (k === "Cash") cash += amt;
      else if (k === "Bank Transfer") bank += amt;
      else adj += amt;
    }
    return { cash, bank, adj, cashBank: cash + bank, total: cash + bank + adj };
  }, [filtered]);

  const contractValue = Number(booking?.total_contract_value) || 0;
  const remaining = Math.max(contractValue - totals.total, 0);

  // Overdue (from ledger)
  const today = new Date().toISOString().slice(0, 10);
  const overdue = useMemo(() => {
    let amt = 0;
    let count = 0;
    for (const l of ledger) {
      const rem = Math.max((Number(l.due_amount) || 0) - (Number(l.paid_amount) || 0), 0);
      if (!l.due_date || l.due_date >= today || rem <= 0) continue;
      if (/down payment|possession/i.test(l.particulars ?? "")) continue;
      amt += rem;
      count += 1;
    }
    return { amt, count };
  }, [ledger, today]);

  // Quick stats
  const lastPaymentDate = filtered.length
    ? filtered[filtered.length - 1].payment_date
    : null;
  const daysSinceLast = lastPaymentDate
    ? daysBetween(new Date(), new Date(lastPaymentDate))
    : null;

  // Row count → tier (one-page enforcement)
  const total = filtered.length;
  const tier =
    total <= 8 ? { row: 8, body: 9.5, totals: 20, splitAt: Infinity }
    : total <= 14 ? { row: 7, body: 9, totals: 18, splitAt: Infinity }
    : total <= 20 ? { row: 6, body: 8.5, totals: 16, splitAt: Infinity }
    : { row: 6, body: 8.5, totals: 16, splitAt: 20 };

  const splitNeeded = total > tier.splitAt;
  const page1Rows = splitNeeded ? filtered.slice(0, tier.splitAt) : filtered;
  const page2Rows = splitNeeded ? filtered.slice(tier.splitAt) : [];

  // Running balance for rendering
  const renderRows = (rows: any[], startingBalance: number) => {
    let bal = startingBalance;
    return rows.map((p, idx) => {
      const mode = classifyMode(p);
      const amt = Number(p.amount) || 0;
      bal = Math.max(bal - amt, 0);
      return { p, mode, amt, balance: bal, sr: idx + 1 + (rows === page2Rows ? page1Rows.length : 0) };
    });
  };

  const page1Render = renderRows(page1Rows, contractValue);
  const page2Render = splitNeeded
    ? renderRows(page2Rows, page1Render.length ? page1Render[page1Render.length - 1].balance : contractValue)
    : [];

  const handlePrint = () => {
    const style = document.createElement("style");
    style.id = "ph-print-style";
    style.textContent = `
      @page { size: A4; margin: 0; }
      @media print {
        body * { visibility: hidden !important; }
        .ph-print-root, .ph-print-root * { visibility: visible !important; }
        .ph-print-root { position: absolute; left: 0; top: 0; margin: 0 !important; padding: 0 !important; background: #fff !important; }
        .ph-sheet { box-shadow: none !important; margin: 0 !important; page-break-after: always; break-after: page; }
        .ph-sheet:last-child { page-break-after: auto; break-after: auto; }
        .ph-screen-only { display: none !important; }
      }
    `;
    document.head.appendChild(style);
    const cleanup = () => {
      document.getElementById("ph-print-style")?.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    setTimeout(() => window.print(), 50);
  };

  if (isLoading || !data) {
    return <div className="text-muted-foreground p-6">Loading payment history…</div>;
  }
  if (!booking) {
    return (
      <div className="card-elevated p-10 text-center">
        <div className="text-lg font-semibold">Booking not found</div>
        <Link to="/bookings" className="text-primary text-sm hover:underline mt-2 inline-block">
          ← Back to bookings
        </Link>
      </div>
    );
  }

  /* ---- Page sheet renderer ---- */
  const sheetStyle: React.CSSProperties = {
    width: "210mm",
    minHeight: "297mm",
    boxSizing: "border-box",
    backgroundImage: letterhead === "precise" ? `url('${LETTERHEAD_URL}')` : undefined,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "top center",
    backgroundSize: "210mm 297mm",
    backgroundColor: "#fff",
    color: "#111",
    fontFamily: '"Times New Roman", Georgia, serif',
    padding: letterhead === "precise" ? "52mm 18mm 38mm 18mm" : "20mm 18mm 25mm 18mm",
  };

  const colW = ["5%", "11%", "10%", "10%", "12%", "17%", "14%", "14%", "7%"];
  const headers = ["Sr.", "Date", "Receipt #", "Type", "Head", "Bank/Ref", "Amount", "Balance", "Remarks"];

  const typeColor = (m: string) =>
    m === "Adjustment" ? "#6b21a8" : m === "Bank Transfer" ? "#1a56db" : "#000";

  const RowsTable = ({ rendered, continuation }: { rendered: ReturnType<typeof renderRows>; continuation?: boolean }) => (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: continuation ? 0 : "0" }}>
      <thead>
        <tr style={{ background: "#f0f0f0", border: "0.75pt solid #333" }}>
          {headers.map((h, i) => (
            <th
              key={h}
              style={{
                width: colW[i],
                padding: "2mm 2.5mm",
                fontFamily: "Arial, sans-serif",
                fontSize: "9pt",
                fontWeight: 700,
                textAlign: "center",
                border: "0.5pt solid #333",
              }}
            >
              {h === "Remarks" && !showRemarks ? "" : h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rendered.map(({ p, mode, amt, balance, sr }, idx) => {
          const isAdj = mode === "Adjustment";
          const bg = isAdj ? "#f5f0ff" : idx % 2 === 0 ? "#ffffff" : "#fafafa";
          const refText =
            isAdj
              ? (p.memo || p.remarks || "Adjustment").slice(0, 25)
              : mode === "Cash"
              ? "Cash Payment"
              : `${p.account ?? ""}${p.cheque_txn_no ? ` — ${p.cheque_txn_no}` : ""}`.trim() || "—";
          return (
            <tr
              key={p.receipt_no}
              style={{
                background: bg,
                borderBottom: "0.5pt solid #ddd",
                height: `${tier.row}mm`,
              }}
            >
              <td style={tdStyle({ tier, align: "center" })}>{sr}</td>
              <td style={tdStyle({ tier, align: "center" })}>{fmtDateDDMMYYYY(p.payment_date)}</td>
              <td style={tdStyle({ tier, align: "center", mono: true })}>{p.receipt_no}</td>
              <td style={tdStyle({ tier, align: "center", color: typeColor(mode), bold: true })}>{mode}</td>
              <td style={tdStyle({ tier, align: "center" })}>{p.payment_head ?? "—"}</td>
              <td style={tdStyle({ tier, align: "left" })}>{refText}</td>
              <td
                style={tdStyle({
                  tier,
                  align: "right",
                  mono: true,
                  bold: amt > 1_000_000,
                })}
              >
                {fmtPKR(amt)}
              </td>
              <td
                style={tdStyle({
                  tier,
                  align: "right",
                  mono: true,
                  color: balance > 0 ? "#b91c1c" : "#15803d",
                })}
              >
                {fmtPKR(balance)}
              </td>
              <td style={tdStyle({ tier, align: "center" })}>
                {showRemarks ? String(p.remarks ?? "").slice(0, 15) : ""}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const ContractBar = () => (
    <div
      style={{
        background: "#1B2B4B",
        color: "#fff",
        padding: "2.5mm 4mm",
        fontFamily: "Arial, sans-serif",
        fontSize: "9pt",
        fontWeight: 700,
        margin: "0 0 3mm 0",
        display: "flex",
        justifyContent: "space-between",
        gap: "4mm",
      }}
    >
      <span>Total Contract Value: PKR {fmtPKR(contractValue)}</span>
      <span>|</span>
      <span>Total Received: PKR {fmtPKR(totals.total)}</span>
      <span>|</span>
      <span>Remaining Balance: PKR {fmtPKR(remaining)}</span>
    </div>
  );

  const InfoBlock = () => (
    <div
      style={{
        border: "0.75pt solid #333",
        padding: "3mm",
        margin: "0 0 4mm 0",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "6mm",
        lineHeight: 1.6,
      }}
    >
      <div>
        <InfoRow label="Client Name:" value={<b>{booking.client_name}</b>} />
        <InfoRow label="CNIC:" value={<span style={{ fontFamily: "JetBrains Mono, monospace" }}>{booking.cnic ?? "—"}</span>} />
        <InfoRow label="Phone:" value={booking.mobile ?? "—"} />
        <InfoRow label="Address:" value={booking.address ?? "—"} />
      </div>
      <div>
        <InfoRow label="Booking ID:" value={<b style={{ fontFamily: "JetBrains Mono, monospace" }}>{booking.booking_id}</b>} />
        <InfoRow label="Unit:" value={`${booking.unit_type ?? "—"} No. ${booking.unit_id} · ${booking.floor ?? "—"} Floor`} />
        <InfoRow label="Unit Size:" value={`${fmtPKR(booking.size_sqft)} Sq. Ft.`} />
        <InfoRow label="Booking Date:" value={fmtDateDDMMYYYY(booking.booking_date)} />
        <InfoRow label="Statement Date:" value={fmtDateDDMMYYYY(today)} />
      </div>
    </div>
  );

  const TotalsBlock = () => (
    <div
      style={{
        border: "1pt solid #1B2B4B",
        marginTop: "0",
        padding: "3mm 4mm",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "6mm",
        fontFamily: '"Times New Roman", serif',
        fontSize: "9.5pt",
      }}
    >
      <div>
        <div style={{ fontFamily: "Arial, sans-serif", fontSize: "9pt", fontWeight: 700, textDecoration: "underline", marginBottom: "1.5mm" }}>
          Payment Breakdown:
        </div>
        <TotalsRow label="Cash Payments:" value={totals.cash} />
        <TotalsRow label="Bank Transfer Payments:" value={totals.bank} />
        <TotalsRow label="Total Cash + Bank:" value={totals.cashBank} bold />
        <TotalsRow label="Adjustment Credit Applied:" value={totals.adj} />
        <div style={{ borderTop: "0.5pt solid #999", margin: "1mm 0" }} />
        <TotalsRow label="TOTAL RECEIVED:" value={totals.total} bold size={11} />
      </div>
      <div>
        <TotalsRow label="Contract Value:" value={contractValue} />
        <TotalsRow label="Total Received:" value={totals.total} />
        <div style={{ borderTop: "0.5pt solid #999", margin: "1mm 0" }} />
        <TotalsRow label="OUTSTANDING BALANCE:" value={remaining} bold />
        {remaining > 0 ? (
          <>
            <TotalsRow label="Overdue Amount:" value={overdue.amt} color="#b91c1c" />
            <div style={{ display: "flex", justifyContent: "space-between", color: "#b91c1c", marginTop: "0.5mm" }}>
              <span>Overdue Installments:</span>
              <span>{overdue.count} installments</span>
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center", color: "#15803d", fontWeight: 700, marginTop: "2mm", fontSize: "11pt" }}>
            ✓ FULLY PAID
          </div>
        )}
      </div>
    </div>
  );

  const hasNotes = filtered.some((p) => (p.remarks ?? "").trim()) || totals.adj > 0;
  const NotesBox = () =>
    hasNotes ? (
      <div style={{ marginTop: "3mm", border: "0.5pt solid #999", padding: "2mm 3mm", minHeight: "15mm" }}>
        <div style={{ fontFamily: "Arial, sans-serif", fontSize: "9pt", fontWeight: 700, marginBottom: "1mm" }}>
          Notes & Remarks
        </div>
        <div style={{ fontStyle: "italic", color: "#555", fontSize: "9pt" }}>
          {filtered.filter((p) => (p.remarks ?? "").trim()).map((p) => (
            <div key={p.receipt_no}>• {p.receipt_no}: {p.remarks}</div>
          ))}
          {totals.adj > 0 && (
            <div>Adjustment credit reflects agreed asset value, not realized amount. Internal figures maintained separately.</div>
          )}
        </div>
      </div>
    ) : null;

  const SignatureBlock = () => (
    <div style={{ marginTop: "6mm", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10mm", fontSize: "10pt" }}>
      <div>
        <div>Verified By:</div>
        <div style={{ margin: "8mm 0 1mm 0" }}>___________________________</div>
        <div>Accounts Officer</div>
        <div>Precise Realtors & Builders (Pvt.) Ltd.</div>
        <div style={{ marginTop: "2mm" }}>Date: ___________________</div>
      </div>
      <div>
        <div>Client Acknowledgment:</div>
        <div style={{ margin: "8mm 0 1mm 0" }}>___________________________</div>
        <div>{booking.client_name}</div>
        <div>CNIC: {booking.cnic ?? "—"}</div>
        <div style={{ marginTop: "2mm" }}>Date: ___________________</div>
      </div>
    </div>
  );

  const TitleBlock = ({ pageOf }: { pageOf?: string }) => (
    <div>
      <div
        style={{
          textAlign: "center",
          fontWeight: 700,
          fontSize: "13pt",
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          margin: "4mm 0 1mm 0",
        }}
      >
        Client Payment History
      </div>
      <div style={{ textAlign: "center", fontStyle: "italic", fontSize: "10pt", margin: "0 0 4mm 0" }}>
        Statement of Payments Received
        {pageOf ? <span style={{ marginLeft: 8, color: "#555" }}>· {pageOf}</span> : null}
      </div>
      {(fromDate || toDate) && (
        <div style={{ textAlign: "center", fontSize: "9pt", color: "#555", marginBottom: "3mm", fontStyle: "italic" }}>
          * This statement shows payments from {fromDate || "—"} to {toDate || "—"} only. Full payment history available on request.
        </div>
      )}
    </div>
  );

  return (
    <div>
      {/* On-screen toolbar */}
      <div className="ph-screen-only flex items-center justify-between gap-3 mb-3">
        <Link to={`/bookings/${booking.booking_id}`} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ChevronLeft className="h-3 w-3" /> Back to booking
        </Link>
        <div className="flex items-center gap-2">
          <Select value={letterhead} onValueChange={(v) => setLetterhead(v as any)}>
            <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="precise">Precise Realtors & Builders</SelectItem>
              <SelectItem value="plain">Plain (no letterhead)</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="ph-screen-only card-elevated p-3 mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 w-[150px]" />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 w-[150px]" />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="adj" checked={showAdjustments} onCheckedChange={setShowAdjustments} />
          <Label htmlFor="adj" className="text-xs">Show adjustment payments</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="rem" checked={showRemarks} onCheckedChange={setShowRemarks} />
          <Label htmlFor="rem" className="text-xs">Show remarks column</Label>
        </div>
      </div>

      {/* Quick stats */}
      <div className="ph-screen-only card-elevated p-3 mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Stat label="Total Payments" value={String(total)} />
        <Stat label="Cash + Bank" value={`PKR ${fmtPKR(totals.cashBank)}`} />
        <Stat label="Last Payment" value={lastPaymentDate ? fmtDateDDMMYYYY(lastPaymentDate) : "—"} />
        <Stat label="Days Since Last" value={daysSinceLast == null ? "—" : `${daysSinceLast} days`} />
        {daysSinceLast != null && daysSinceLast > 180 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-destructive/15 text-destructive border border-destructive/30">
            No payment in 6+ months
          </span>
        )}
        {daysSinceLast != null && daysSinceLast > 90 && daysSinceLast <= 180 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-orange-100 text-orange-800 border border-orange-300">
            No payment in 90+ days
          </span>
        )}
      </div>

      {/* Printable canvas */}
      <div className="ph-print-root mx-auto" style={{ width: "210mm" }}>
        <div className="ph-sheet shadow-[0_2px_18px_rgba(0,0,0,0.15)] mb-6" style={sheetStyle}>
          <TitleBlock pageOf={splitNeeded ? "Page 1 of 2" : undefined} />
          <InfoBlock />
          <ContractBar />
          <RowsTable rendered={page1Render} />
          {!splitNeeded && (
            <>
              <TotalsBlock />
              <NotesBox />
              <SignatureBlock />
            </>
          )}
        </div>
        {splitNeeded && (
          <div className="ph-sheet shadow-[0_2px_18px_rgba(0,0,0,0.15)] mb-6" style={sheetStyle}>
            <div style={{ textAlign: "center", fontSize: "11pt", fontWeight: 700, margin: "0 0 4mm 0" }}>
              Payment History (Continued) — {booking.client_name} — {booking.booking_id}
            </div>
            <RowsTable rendered={page2Render} continuation />
            <TotalsBlock />
            <NotesBox />
            <SignatureBlock />
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "2mm", margin: "0.6mm 0" }}>
      <span style={{ fontFamily: "Arial, sans-serif", fontSize: "8.5pt", fontWeight: 700, color: "#555", minWidth: "30mm" }}>
        {label}
      </span>
      <span style={{ fontSize: "9.5pt", color: "#000" }}>{value}</span>
    </div>
  );
}

function TotalsRow({
  label, value, bold, size, color,
}: { label: string; value: number; bold?: boolean; size?: number; color?: string }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      fontWeight: bold ? 700 : 400,
      fontSize: size ? `${size}pt` : undefined,
      color,
      padding: "0.4mm 0",
    }}>
      <span style={{ fontFamily: bold ? "Arial, sans-serif" : undefined }}>{label}</span>
      <span style={{ fontFamily: "JetBrains Mono, monospace", textAlign: "right" }}>PKR {fmtPKR(value)}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-1.5 rounded-md bg-muted/60 border border-border">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function tdStyle(opts: {
  tier: { row: number; body: number };
  align: "left" | "right" | "center";
  mono?: boolean;
  bold?: boolean;
  color?: string;
}): React.CSSProperties {
  return {
    padding: "1mm 2mm",
    fontSize: `${opts.tier.body}pt`,
    fontFamily: opts.mono ? "JetBrains Mono, monospace" : '"Times New Roman", serif',
    fontWeight: opts.bold ? 700 : 400,
    color: opts.color,
    textAlign: opts.align,
    verticalAlign: "middle",
    borderRight: "0.25pt solid #eee",
  };
}
