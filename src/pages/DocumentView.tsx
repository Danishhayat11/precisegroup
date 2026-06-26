import { useParams, Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Printer, ChevronLeft } from "lucide-react";
import { fmtDate, fmtPKR } from "@/lib/format";
import { useState, useEffect } from "react";
import { LETTERHEAD_URL } from "@/lib/print";
import PrintPreviewModal from "@/components/PrintPreviewModal";

const titles: Record<string, string> = {
  "receipt": "Payment Receipt", "payment-plan": "Payment Plan", "allotment": "Allotment Letter",
  "possession": "Possession Letter", "prov-possession": "Provisional Possession Letter",
  "legal-notice": "Legal Notice", "deposit-summary": "Deposit Summary",
  "transfer-form": "Transfer Form", "sale-agreement": "Sale Agreement",
  "transfer-checklist": "Transfer Checklist", "affidavit": "Affidavit of Transfer",
  "transfer-letter": "Transfer Letter",
};

export default function DocumentView() {
  const { type = "receipt" } = useParams();
  const [params, setParams] = useSearchParams();
  const bookingId = params.get("booking") ?? "";
  const [selected, setSelected] = useState(bookingId);
  const [previewOpen, setPreviewOpen] = useState(false);

  const { data: bookings = [] } = useQuery({
    queryKey: ["doc-bookings"],
    queryFn: async () => (await supabase.from("bookings").select("booking_id,client_name,unit_id,project_name")).data ?? [],
  });

  const { data: booking } = useQuery({
    queryKey: ["doc-booking", selected],
    enabled: !!selected,
    queryFn: async () => (await supabase.from("bookings").select("*").eq("booking_id", selected).maybeSingle()).data,
  });

  const { data: ledger = [] } = useQuery({
    queryKey: ["doc-ledger", selected],
    enabled: !!selected && (type === "payment-plan" || type === "deposit-summary"),
    queryFn: async () => (await supabase.from("installment_ledger").select("*").eq("booking_id", selected).order("term_no")).data ?? [],
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["doc-payments", selected],
    enabled: !!selected && (type === "receipt" || type === "deposit-summary"),
    queryFn: async () => (await supabase.from("payments").select("*").eq("booking_id", selected).order("payment_date")).data ?? [],
  });

  useEffect(() => { if (selected !== bookingId) setParams(selected ? { booking: selected } : {}); }, [selected]);

  const title = titles[type] ?? "Document";

  return (
    <div>
      <Link to="/documents" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3 print:hidden">
        <ChevronLeft className="h-3 w-3" /> All documents
      </Link>
      <div className="mb-4 flex flex-col sm:flex-row sm:items-end gap-3 print:hidden">
        <div className="flex-1">
          <div className="text-2xl font-semibold">{title}</div>
          <div className="text-sm text-muted-foreground">Pick a booking to auto-fill the template</div>
        </div>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm min-w-[260px]">
          <option value="">Select booking…</option>
          {bookings.map((b: any) => (
            <option key={b.booking_id} value={b.booking_id}>{b.booking_id} — {b.client_name} ({b.unit_id})</option>
          ))}
        </select>
        <Button onClick={() => setPreviewOpen(true)} disabled={!booking}>
          <Printer className="h-4 w-4 mr-1" /> Print Preview
        </Button>
      </div>

      {!booking ? (
        <div className="card-elevated p-12 text-center text-muted-foreground">Select a booking to preview.</div>
      ) : (
        <>
          <div
            className="mx-auto bg-white text-black shadow-[var(--shadow-elegant)] print:shadow-none letterhead-page"
            style={{
              width: "210mm",
              minHeight: "297mm",
              backgroundImage: `url('${LETTERHEAD_URL}')`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "top center",
              backgroundSize: "210mm 297mm",
              padding: "58mm 22mm 38mm 24mm",
              boxSizing: "border-box",
            }}
          >
            {renderDocBody({ title, booking, payments, ledger, type })}
          </div>

          <PrintPreviewModal
            open={previewOpen}
            onOpenChange={setPreviewOpen}
            title={`${title} — ${booking.booking_id}`}
            mode="react"
          >
            {renderDocBody({ title, booking, payments, ledger, type })}
          </PrintPreviewModal>
        </>
      )}
    </div>
  );
}

function renderDocBody({ title, booking, payments, ledger, type }: any) {
  return (
    <>
      <div className="text-center mb-5">
        <div className="font-bold uppercase tracking-wider text-[14pt] underline">{title}</div>
        <div className="text-[10pt] text-gray-700 mt-1">Dated: {fmtDate(new Date())}</div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm mb-6">
        <div><span className="text-gray-500">Booking ID</span><div className="font-mono">{booking.booking_id}</div></div>
        <div><span className="text-gray-500">Booking Date</span><div>{fmtDate(booking.booking_date)}</div></div>
        <div><span className="text-gray-500">Client</span><div className="capitalize font-medium">{booking.client_name}</div></div>
        <div><span className="text-gray-500">S/O · W/O</span><div>{booking.so_wo}</div></div>
        <div><span className="text-gray-500">CNIC</span><div className="font-mono">{booking.cnic}</div></div>
        <div><span className="text-gray-500">Mobile</span><div className="font-mono">{booking.mobile}</div></div>
        <div className="col-span-2"><span className="text-gray-500">Address</span><div>{booking.address}</div></div>
        <div><span className="text-gray-500">Project</span><div>{booking.project_name}</div></div>
        <div><span className="text-gray-500">Unit</span><div className="font-mono">{booking.unit_id} ({booking.unit_type} · {booking.floor})</div></div>
      </div>

      {type === "receipt" && (
        <div>
          <div className="text-sm font-semibold mb-2">Payments received</div>
          <table className="w-full text-xs border border-black/20">
            <thead><tr className="bg-gray-100"><th className="text-left p-2">Receipt</th><th className="text-left p-2">Date</th><th className="text-left p-2">Head</th><th className="text-left p-2">Mode</th><th className="text-right p-2">Amount</th></tr></thead>
            <tbody>
              {payments.map((p: any) => (
                <tr key={p.receipt_no} className="border-t border-black/15"><td className="p-2 font-mono">{p.receipt_no}</td><td className="p-2">{fmtDate(p.payment_date)}</td><td className="p-2">{p.payment_head}</td><td className="p-2">{p.payment_mode}</td><td className="p-2 text-right tabular-nums">{fmtPKR(p.amount)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-black"><td colSpan={4} className="p-2 font-semibold">Total</td><td className="p-2 text-right tabular-nums font-semibold">{fmtPKR(payments.reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0))}</td></tr></tfoot>
          </table>
        </div>
      )}

      {(type === "payment-plan" || type === "deposit-summary") && (
        <div>
          <div className="grid grid-cols-4 gap-3 text-sm mb-4">
            <Stat l="Contract" v={fmtPKR(booking.total_contract_value)} />
            <Stat l="Down Payment" v={fmtPKR(booking.down_payment)} />
            <Stat l="Cash Received" v={fmtPKR(booking.cash_received)} />
            <Stat l="Remaining" v={fmtPKR(booking.remaining_balance)} />
          </div>
          <div className="text-sm font-semibold mb-2">Schedule</div>
          <table className="w-full text-xs border border-black/20">
            <thead><tr className="bg-gray-100"><th className="text-left p-2">#</th><th className="text-left p-2">Particulars</th><th className="text-left p-2">Due Date</th><th className="text-right p-2">Due</th><th className="text-right p-2">Paid</th><th className="text-left p-2">Status</th></tr></thead>
            <tbody>
              {ledger.map((l: any) => (
                <tr key={l.ledger_id} className="border-t border-black/15">
                  <td className="p-2">{l.term_no}</td><td className="p-2">{l.particulars}</td>
                  <td className="p-2">{fmtDate(l.due_date)}</td>
                  <td className="p-2 text-right tabular-nums">{fmtPKR(l.due_amount)}</td>
                  <td className="p-2 text-right tabular-nums">{fmtPKR(l.paid_amount)}</td>
                  <td className="p-2">{l.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!["receipt","payment-plan","deposit-summary"].includes(type) && (
        <div className="text-sm leading-relaxed space-y-3">
          <p>This is to formally confirm the <span className="font-semibold">{title.toLowerCase()}</span> against the booking referenced above.</p>
          <p>Unit <span className="font-mono">{booking.unit_id}</span> in <span className="font-medium">{booking.project_name}</span> is recorded against client <span className="font-medium capitalize">{booking.client_name}</span> (CNIC {booking.cnic}) for a total contract value of <span className="font-semibold">PKR {fmtPKR(booking.total_contract_value)}</span>.</p>
          <p>Total amount received to date (cash &amp; bank): <span className="font-semibold">PKR {fmtPKR(booking.cash_received)}</span>. Remaining balance: <span className="font-semibold">PKR {fmtPKR(booking.remaining_balance)}</span>.</p>
          <p>This document is issued in line with the agreed payment plan and the records maintained at Precise Realtors &amp; Builders (Pvt.) Ltd.</p>
          <div className="grid grid-cols-2 gap-12 mt-16 pt-12">
            <div className="border-t border-black pt-2 text-xs text-gray-700">Client Signature</div>
            <div className="border-t border-black pt-2 text-xs text-gray-700">For Precise Realtors &amp; Builders</div>
          </div>
        </div>
      )}

      <div className="mt-10 text-[9pt] text-gray-500 text-center">Generated on {fmtDate(new Date())} · Precise ERP</div>
    </>
  );
}


function Stat({ l, v }: { l: string; v: string }) {
  return <div className="border border-black/15 rounded p-2"><div className="text-[10px] text-gray-500">{l}</div><div className="font-semibold tabular-nums">{v}</div></div>;
}
