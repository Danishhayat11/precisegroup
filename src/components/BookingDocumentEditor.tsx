import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Printer, Save, RotateCcw, FileText } from "lucide-react";
import { fmtDate, fmtPKR } from "@/lib/format";
import { toast } from "sonner";
import PrintPreviewModal from "@/components/PrintPreviewModal";

type DocType =
  | "Legal Notice"
  | "Allotment Letter"
  | "Possession Letter"
  | "Provisional Possession"
  | "Payment Receipt"
  | "Payment Plan";

const DOC_TYPES: DocType[] = [
  "Legal Notice",
  "Allotment Letter",
  "Possession Letter",
  "Provisional Possession",
  "Payment Receipt",
  "Payment Plan",
];

function buildTemplate(type: DocType, b: any, payments: any[] = [], ledger: any[] = []): string {
  const today = fmtDate(new Date().toISOString());
  const client = (b.client_name ?? "").toString();
  const unit = b.unit_id ?? "";
  const project = b.project_name ?? "";
  const cnic = b.cnic ?? "";
  const so = b.so_wo ?? "";
  const addr = b.address ?? "";
  const sold = fmtPKR(b.sold_unit_value);
  const dp = fmtPKR(b.down_payment);
  const inst = fmtPKR(b.installment_amount);
  const noInst = b.no_of_installments ?? "—";
  const freq = b.installment_frequency ?? "Monthly";
  const possAmt = fmtPKR(b.possession_amount);
  const possDue = fmtDate(b.possession_due_date);
  const remaining = fmtPKR(b.remaining_balance);
  const overdueCount = b.current_overdue_count ?? 0;
  const overdueAmt = fmtPKR(b.total_overdue_amount);
  const lastPayment = payments[payments.length - 1];

  switch (type) {
    case "Legal Notice":
      return `PRECISE REALTORS & BUILDERS (PVT.) LTD.
LEGAL NOTICE — NON-PAYMENT OF INSTALLMENTS

Date: ${today}
Reference: ${b.booking_id}

To,
${client}
S/O – W/O: ${so}
CNIC: ${cnic}
Address: ${addr}

Subject: Notice of Default — Unit ${unit}, ${project}

Dear ${client},

We refer to your booking for Unit ${unit} in ${project} dated ${fmtDate(b.booking_date)} against a total sold value of ${sold}.

Our records indicate that ${overdueCount} installment(s) amounting to ${overdueAmt} remain overdue and unpaid as of ${today}. Despite previous reminders, the outstanding amount has not been cleared.

You are hereby formally called upon to clear the overdue amount of ${overdueAmt} within fifteen (15) days from the date of this notice, failing which the Company shall be constrained to initiate the following actions without further notice:

  1. Cancellation of allotment / booking.
  2. Forfeiture of paid amounts as per the booking terms.
  3. Re-sale of the unit to any third party.
  4. Legal proceedings for recovery of dues, costs and damages.

This notice is being issued without prejudice to any other rights and remedies available to the Company under law.

For Precise Realtors & Builders (Pvt.) Ltd.


_________________________
Authorised Signatory`;

    case "Allotment Letter":
      return `PRECISE REALTORS & BUILDERS (PVT.) LTD.
ALLOTMENT LETTER

Date: ${today}
Booking Ref: ${b.booking_id}

To,
${client}
S/O – W/O: ${so}
CNIC: ${cnic}
Address: ${addr}

Subject: Provisional Allotment of Unit ${unit}, ${project}

Dear ${client},

We are pleased to confirm the provisional allotment of the following unit in your favour, subject to the terms of booking and timely payment of all installments:

  Project           : ${project}
  Unit No.          : ${unit}
  Type / Floor      : ${b.unit_type ?? "—"} / ${b.floor ?? "—"}
  Covered Area      : ${b.size_sqft ?? "—"} sqft
  Sold Rate / sqft  : ${fmtPKR(b.sold_rate)}
  Sold Unit Value   : ${sold}
  Down Payment      : ${dp}
  Installments      : ${noInst} × ${inst} (${freq})
  Possession Amount : ${possAmt}
  Possession Due    : ${possDue}

You are required to abide by the agreed payment plan. Failure to make timely payments may result in cancellation of this allotment and forfeiture as per booking terms.

We thank you for choosing Precise Realtors & Builders.

For Precise Realtors & Builders (Pvt.) Ltd.


_________________________
Authorised Signatory`;

    case "Possession Letter":
      return `PRECISE REALTORS & BUILDERS (PVT.) LTD.
POSSESSION LETTER

Date: ${today}
Booking Ref: ${b.booking_id}

To,
${client}
CNIC: ${cnic}
Address: ${addr}

Subject: Handover of Possession — Unit ${unit}, ${project}

Dear ${client},

This is to confirm that, having received full and final payment against Unit ${unit} in ${project}, physical possession of the said unit is hereby handed over to you on ${today}.

  Total Sold Value : ${sold}
  Total Received   : ${fmtPKR((Number(b.cash_received) || 0) + (Number(b.adjustment_credit) || 0))}
  Remaining Balance: ${remaining}

You are now entitled to take occupancy of the unit. Any future maintenance, utility and society dues shall be borne by you in accordance with the building bye-laws.

We wish you a comfortable stay.

For Precise Realtors & Builders (Pvt.) Ltd.


_________________________
Authorised Signatory                 Allottee Signature`;

    case "Provisional Possession":
      return `PRECISE REALTORS & BUILDERS (PVT.) LTD.
PROVISIONAL POSSESSION LETTER

Date: ${today}
Booking Ref: ${b.booking_id}

To,
${client}
CNIC: ${cnic}

Subject: Provisional Possession of Unit ${unit}, ${project}

Dear ${client},

Subject to clearance of the remaining balance of ${remaining}, provisional possession of Unit ${unit} in ${project} is hereby granted to you with effect from ${today}.

  Sold Unit Value      : ${sold}
  Down Payment         : ${dp}
  Possession Amount    : ${possAmt}
  Remaining Balance    : ${remaining}

This provisional possession shall stand converted into final possession upon receipt of all outstanding dues. Until such time, the title and ownership of the unit shall remain with the Company.

For Precise Realtors & Builders (Pvt.) Ltd.


_________________________
Authorised Signatory                 Allottee Signature`;

    case "Payment Receipt": {
      const r = lastPayment;
      return `PRECISE REALTORS & BUILDERS (PVT.) LTD.
PAYMENT RECEIPT

Receipt No : ${r?.receipt_no ?? "—"}
Date       : ${fmtDate(r?.payment_date ?? new Date().toISOString())}
Booking    : ${b.booking_id}

Received with thanks from ${client} (CNIC: ${cnic}) the sum of
${fmtPKR(r?.amount ?? 0)}
on account of ${r?.payment_head ?? "—"} for Unit ${unit}, ${project}.

  Mode of Payment : ${r?.payment_mode ?? "—"}
  Account         : ${r?.account ?? "—"}
  Instrument      : ${r?.instrument_no ?? "—"}

Running Balance after this receipt:
  Total Sold Value : ${sold}
  Cash Received    : ${fmtPKR(b.cash_received)}
  Adj. Credit      : ${fmtPKR(b.adjustment_credit)}
  Remaining        : ${remaining}

For Precise Realtors & Builders (Pvt.) Ltd.


_________________________
Authorised Signatory                 Received By`;
    }

    case "Payment Plan": {
      const lines = ledger
        .slice(0, 30)
        .map(
          (l: any) =>
            `  ${String(l.term_no ?? "").padStart(3, " ")}.  ${fmtDate(l.due_date).padEnd(12)}  ${(l.particulars ?? "").padEnd(28)}  ${fmtPKR(l.due_amount)}`
        )
        .join("\n");
      return `PRECISE REALTORS & BUILDERS (PVT.) LTD.
AGREED PAYMENT PLAN

Date: ${today}
Booking Ref: ${b.booking_id}

Client     : ${client}
CNIC       : ${cnic}
Project    : ${project}
Unit       : ${unit}

Sold Unit Value     : ${sold}
Down Payment        : ${dp}
No. of Installments : ${noInst} (${freq})
Installment Amount  : ${inst}
Possession Amount   : ${possAmt}
Possession Due      : ${possDue}

Schedule of Payments:
  #    Due Date      Particulars                   Amount
  ----------------------------------------------------------
${lines || "  (Ledger is empty)"}

The client agrees to make all payments on or before the due dates listed above. Late payments may attract penalties and may result in cancellation as per booking terms.

For Precise Realtors & Builders (Pvt.) Ltd.


_________________________                _________________________
Authorised Signatory                      Allottee Signature`;
    }
  }
}

function storageKey(bookingId: string, type: DocType) {
  return `precise:doc-draft:${bookingId}:${type}`;
}

export default function BookingDocumentEditor({
  booking, payments, ledger,
}: { booking: any; payments: any[]; ledger: any[] }) {
  const [type, setType] = useState<DocType>("Allotment Letter");
  const baseTemplate = useMemo(() => buildTemplate(type, booking, payments, ledger), [type, booking, payments, ledger]);
  const [text, setText] = useState<string>(baseTemplate);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Load draft (or fall back to template) whenever type changes
  useEffect(() => {
    const k = storageKey(booking.booking_id, type);
    const draft = localStorage.getItem(k);
    if (draft) {
      setText(draft);
      try {
        const meta = JSON.parse(localStorage.getItem(k + ":meta") ?? "null");
        setSavedAt(meta?.savedAt ?? null);
      } catch { setSavedAt(null); }
    } else {
      setText(baseTemplate);
      setSavedAt(null);
    }
  }, [type, booking.booking_id, baseTemplate]);

  const handleReset = () => {
    setText(baseTemplate);
    toast.success("Reset to default template");
  };

  const handleSave = () => {
    const k = storageKey(booking.booking_id, type);
    localStorage.setItem(k, text);
    const stamp = new Date().toISOString();
    localStorage.setItem(k + ":meta", JSON.stringify({ savedAt: stamp }));
    setSavedAt(stamp);
    toast.success("Draft saved");
  };

  const handlePrint = () => {
    try {
      // Strip the textual letterhead block at the top of templates so it doesn't
      // double up with the printed letterhead image.
      const body = text.replace(/^PRECISE REALTORS & BUILDERS \(PVT\.\) LTD\.\s*\n/i, "");
      printOnLetterhead({
        title: `${type} — ${booking.booking_id}`,
        body: `<pre class="body">${body
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`,
        html: true,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Unable to open print window");
    }
  };


  return (
    <div className="card-elevated overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <div className="text-sm font-semibold">Document Editor</div>
          {savedAt && (
            <span className="text-[11px] text-muted-foreground">
              · Draft saved {new Date(savedAt).toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">Document type</Label>
            <Select value={type} onValueChange={(v) => setType(v as DocType)}>
              <SelectTrigger className="h-9 w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" onClick={handleReset} title="Reset to template">
            <RotateCcw className="h-4 w-4 mr-1" /> Reset
          </Button>
          <Button variant="outline" size="sm" onClick={handleSave}>
            <Save className="h-4 w-4 mr-1" /> Save Draft
          </Button>
          <Button size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
        </div>
      </div>
      <div className="p-4 bg-muted/30">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="w-full min-h-[640px] rounded-md border bg-card text-foreground font-mono text-[13px] leading-relaxed p-5 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}
        />
        <div className="text-[11px] text-muted-foreground mt-2">
          Template auto-fills from the booking. Edit freely — Save Draft keeps your changes per booking + document type.
        </div>
      </div>
    </div>
  );
}
