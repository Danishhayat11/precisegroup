import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logDocumentAction } from "@/lib/audit";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { fmtPKR, fmtDate } from "@/lib/format";
import { amountInWordsPK } from "@/lib/amountInWords";
import { Printer, FileText, AlertTriangle, Ban, Gavel, Search, Sparkles, Save, Download, History, Pencil } from "lucide-react";
import { format, addDays, parseISO } from "date-fns";
import html2pdf from "html2pdf.js";

type DocKey = "legal" | "final" | "final_cancel" | "cancellation";

const DOC_META: Record<DocKey, { title: string; short: string; icon: any; deadline: number; recommendedFor: (n: number) => boolean }> = {
  legal:         { title: "Legal Notice (Show Cause)",                   short: "1. Legal Notice",                       icon: FileText,        deadline: 15, recommendedFor: (n) => n >= 1 && n <= 2 },
  final:         { title: "Final Legal Notice",                          short: "2. Final Legal Notice",                 icon: AlertTriangle,   deadline: 10, recommendedFor: (n) => n >= 3 && n <= 4 },
  final_cancel:  { title: "Final Legal Notice — Cancellation Warning",   short: "3. Final + Cancellation Warning",       icon: Gavel,           deadline: 10, recommendedFor: (n) => n >= 5 },
  cancellation:  { title: "Final Cancellation Notice",                   short: "4. Cancellation Notice",                icon: Ban,             deadline: 0,  recommendedFor: () => false },
};

const FMT_DATE = (d?: string | Date | null) => (d ? format(typeof d === "string" ? parseISO(d) : d, "dd-MM-yyyy") : "____________");

function clientTitle(b: any): string {
  const g = (b?.gender || b?.title || "").toString().toLowerCase();
  if (g.startsWith("f") || g.includes("mrs") || g.includes("ms")) return "Ms.";
  return "Mr.";
}

function noticeRef(unit: string, doc: DocKey, serial = 1) {
  const u = (unit || "MA").replace(/[^A-Z0-9-]/gi, "");
  const yr = new Date().getFullYear();
  const s = String(serial).padStart(3, "0");
  return doc === "cancellation" ? `PRB/MA/${u}/CAN/${s}` : `PRB/MA/${u}/${yr}-${s}`;
}

export default function Documents() {
  const [search, setSearch] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [docType, setDocType] = useState<DocKey | null>(null);
  const [prevNotice1, setPrevNotice1] = useState("");
  const [prevNotice2, setPrevNotice2] = useState("");

  const { data: bookings = [] } = useQuery({
    queryKey: ["doc-bookings-all"],
    queryFn: async () => (await supabase.from("bookings").select("*").order("client_name")).data ?? [],
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bookings.slice(0, 20);
    return bookings.filter((b: any) =>
      [b.booking_id, b.client_name, b.unit_id, b.cnic].some((v) => (v || "").toString().toLowerCase().includes(q))
    ).slice(0, 20);
  }, [search, bookings]);

  const booking = bookings.find((b: any) => b.booking_id === bookingId);

  const { data: ledger = [] } = useQuery({
    queryKey: ["doc-ledger-all", bookingId],
    enabled: !!bookingId,
    queryFn: async () =>
      (await supabase.from("installment_ledger").select("*").eq("booking_id", bookingId).order("due_date")).data ?? [],
  });

  const overdueRows = useMemo(
    () => ledger.filter((l: any) => (l.status || "").toLowerCase() === "overdue" || (l.days_overdue ?? 0) > 0),
    [ledger]
  );
  const overdueAmount = useMemo(
    () => overdueRows.reduce((s: number, l: any) => s + (Number(l.due_amount || 0) - Number(l.paid_amount || 0)), 0),
    [overdueRows]
  );
  const overdueCount = overdueRows.length || booking?.current_overdue_count || 0;

  // Auto-recommend a doc once booking is picked
  useEffect(() => {
    if (!booking || docType) return;
    const n = overdueCount;
    if (n >= 5) setDocType("final_cancel");
    else if (n >= 3) setDocType("final");
    else if (n >= 1) setDocType("legal");
  }, [booking, overdueCount]); // eslint-disable-line

  const todayStr = FMT_DATE(new Date());
  const deadlineStr = docType ? FMT_DATE(addDays(new Date(), DOC_META[docType].deadline)) : "";
  const ref = booking && docType ? noticeRef(booking.unit_id, docType) : "";

  const ctx = booking && docType
    ? {
        ref,
        today: todayStr,
        deadline: deadlineStr,
        title: clientTitle(booking),
        name: (booking.client_name || "").toUpperCase(),
        father: booking.so_wo ? `S/O ${booking.so_wo}` : "",
        cnic: booking.cnic || "____________",
        address: booking.address || "____________",
        unitNo: booking.unit_id || "____________",
        unitType: booking.unit_type || "Unit",
        floor: booking.floor || "",
        project: booking.project_name || "Manal Arcade",
        size: booking.size_sqft ? Number(booking.size_sqft).toLocaleString("en-PK") : "____",
        bookingDate: FMT_DATE(booking.booking_date),
        contractDate: FMT_DATE(booking.booking_date),
        overdueCount,
        overdueAmount,
        overdueAmtFmt: `PKR ${fmtPKR(overdueAmount)}/-`,
        overdueWords: amountInWordsPK(overdueAmount),
        prev1: FMT_DATE(prevNotice1),
        prev2: FMT_DATE(prevNotice2),
        overdueRows,
      }
    : null;

  return (
    <div>
      <PageHeader
        title="Document Center — Legal Notices"
        description="Auto-populate and print A4 legal documents for defaulting clients"
      />

      {/* STEP 1 */}
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold">Step 1 — Select booking</div>
            <div className="text-xs text-muted-foreground">Search by Booking ID, Client Name, Unit or CNIC</div>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-8" />
          </div>
        </div>

        {!bookingId && (
          <div className="border rounded-md max-h-64 overflow-y-auto divide-y">
            {filtered.length === 0 && <div className="p-3 text-sm text-muted-foreground">No bookings match.</div>}
            {filtered.map((b: any) => (
              <button
                key={b.booking_id}
                onClick={() => { setBookingId(b.booking_id); setDocType(null); }}
                className="w-full text-left p-3 hover:bg-muted flex items-center justify-between gap-3"
              >
                <div>
                  <div className="font-medium capitalize">{b.client_name}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {b.booking_id} · {b.unit_id}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs">Overdue: <span className="font-semibold">{b.current_overdue_count ?? 0}</span></div>
                  <div className="text-xs">PKR {fmtPKR(b.total_overdue_amount || 0)}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {booking && (
          <div className="bg-muted/40 rounded-md p-3 flex flex-wrap gap-4 items-center text-sm">
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Client</div>
              <div className="font-semibold capitalize">{booking.client_name}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Unit</div>
              <div className="font-mono">{booking.unit_id}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Overdue</div>
              <div><span className="font-semibold">{overdueCount}</span> installments</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Amount</div>
              <div className="font-semibold">PKR {fmtPKR(overdueAmount)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Risk</div>
              <Badge variant={booking.risk_level === "HIGH" ? "destructive" : "secondary"}>{booking.risk_level || "LOW"}</Badge>
            </div>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setBookingId(""); setDocType(null); }}>
              Change booking
            </Button>
          </div>
        )}
      </Card>

      {/* STEP 2 */}
      {booking && (
        <Card className="p-4 mb-4">
          <div className="text-sm font-semibold mb-1">Step 2 — Select document (escalation order)</div>
          <div className="text-xs text-muted-foreground mb-3">
            Recommended for this client based on <span className="font-semibold">{overdueCount}</span> overdue installments.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            {(Object.keys(DOC_META) as DocKey[]).map((k) => {
              const m = DOC_META[k];
              const recommended = m.recommendedFor(overdueCount);
              const active = docType === k;
              return (
                <button
                  key={k}
                  onClick={() => setDocType(k)}
                  className={`text-left rounded-lg border p-3 transition relative ${
                    active ? "border-primary bg-primary/5 ring-1 ring-primary"
                           : recommended ? "border-accent bg-accent/10 hover:bg-accent/15"
                                         : "hover:bg-muted"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <m.icon className="h-4 w-4 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-xs font-semibold">{m.short}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{m.title}</div>
                    </div>
                  </div>
                  {recommended && (
                    <Badge className="absolute -top-2 -right-2 text-[9px] gap-1" variant="default">
                      <Sparkles className="h-2.5 w-2.5" /> Recommended
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* STEP 3 */}
      {booking && docType && (docType === "final" || docType === "final_cancel" || docType === "cancellation") && (
        <Card className="p-4 mb-4">
          <div className="text-sm font-semibold mb-3">Step 3 — Previous notice dates</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Date of previous notice sent</Label>
              <Input type="date" value={prevNotice1} onChange={(e) => setPrevNotice1(e.target.value)} />
            </div>
            {(docType === "final_cancel" || docType === "cancellation") && (
              <div>
                <Label className="text-xs">Date of second previous notice</Label>
                <Input type="date" value={prevNotice2} onChange={(e) => setPrevNotice2(e.target.value)} />
              </div>
            )}
          </div>
        </Card>
      )}

      {/* STEP 4 — preview */}
      {ctx && docType && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <div className="text-sm font-semibold">Step 4 — Document preview</div>
              <div className="text-xs text-muted-foreground">
                Ref: <span className="font-mono">{ctx.ref}</span> · Generated {ctx.today}
              </div>
            </div>
            <Button onClick={() => {
              void logDocumentAction({
                action: "document.print",
                documentType: DOC_META[docType].title,
                referenceNo: ctx.ref,
                bookingId: bookingId,
              });
              window.print();
            }}><Printer className="h-4 w-4 mr-1" /> Print</Button>
          </div>

          <div id="doc-print" className="bg-white text-black border rounded-md shadow-sm mx-auto"
               style={{ width: "210mm", minHeight: "297mm", padding: "25mm", boxSizing: "border-box", fontFamily: '"Times New Roman", Georgia, serif', fontSize: "11pt", lineHeight: 1.55 }}>
            <DocBody doc={docType} c={ctx} />
          </div>
        </Card>
      )}

      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
          body * { visibility: hidden !important; }
          #doc-print, #doc-print * { visibility: visible !important; }
          #doc-print { position: absolute; left: 0; top: 0; border: 0 !important; box-shadow: none !important; }
        }
      `}</style>
    </div>
  );
}

function Letterhead({ variant = "manal" }: { variant?: "manal" | "precise" }) {
  return (
    <div style={{ textAlign: "center", borderBottom: "1.5pt solid #1B2B4B", paddingBottom: "8pt", marginBottom: "14pt" }}>
      <div style={{ fontWeight: 700, fontSize: "16pt", letterSpacing: "1px", color: "#1B2B4B" }}>
        {variant === "precise" ? "PRECISE REALTORS & BUILDERS (PVT.) LTD." : "MANAL ARCADE"}
      </div>
      <div style={{ fontSize: "10pt", color: "#555", marginTop: "2pt" }}>
        {variant === "precise" ? "MANAL ARCADE, B-17, ISLAMABAD" : "A vision for your living style"}
      </div>
      <div style={{ fontSize: "9pt", color: "#777", marginTop: "2pt" }}>
        NTN: 8169355 · CUI: 0150809
      </div>
    </div>
  );
}

function Footer({ variant = "manal" }: { variant?: "manal" | "precise" }) {
  return (
    <div style={{ marginTop: "24pt", paddingTop: "8pt", borderTop: "1pt solid #1B2B4B", fontSize: "8.5pt", color: "#444", textAlign: "center", lineHeight: 1.4 }}>
      {variant === "precise"
        ? <>Precise Realtors &amp; Builders (Pvt.) Ltd. · Manal Arcade, B-1 Markaz, B-17, Islamabad</>
        : <>
            033 45533767 · 0331 2220520 · 0344 5533767 · manalarcade@gmail.com · www.precisegroupintl.com<br />
            Office #01, 1st Floor, Manal Arcade, B-1 Markaz, B-17 Islamabad · Plot #04 Block B-Ext, MPCHS B-17, Islamabad
          </>}
    </div>
  );
}

function Highlight({ children }: { children: any }) {
  return <span style={{ color: "#1d4ed8", fontWeight: 600 }}>{children}</span>;
}

function OverdueTable({ rows }: { rows: any[] }) {
  if (!rows?.length) return null;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10pt", margin: "10pt 0" }}>
      <thead>
        <tr style={{ background: "#f0f0f0" }}>
          <th style={{ border: "0.6pt solid #555", padding: "4pt 6pt", textAlign: "left", width: "10%" }}>Sr.</th>
          <th style={{ border: "0.6pt solid #555", padding: "4pt 6pt", textAlign: "left" }}>Particulars</th>
          <th style={{ border: "0.6pt solid #555", padding: "4pt 6pt", textAlign: "left", width: "25%" }}>Due Date</th>
          <th style={{ border: "0.6pt solid #555", padding: "4pt 6pt", textAlign: "right", width: "25%" }}>Amount (PKR)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.ledger_id || i}>
            <td style={{ border: "0.6pt solid #555", padding: "4pt 6pt" }}>{i + 1}</td>
            <td style={{ border: "0.6pt solid #555", padding: "4pt 6pt" }}>{r.particulars || "Installment"}</td>
            <td style={{ border: "0.6pt solid #555", padding: "4pt 6pt" }}>{FMT_DATE(r.due_date)}</td>
            <td style={{ border: "0.6pt solid #555", padding: "4pt 6pt", textAlign: "right" }}>
              {fmtPKR(Number(r.due_amount || 0) - Number(r.paid_amount || 0))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BankBlock() {
  return (
    <div style={{ margin: "8pt 0", padding: "8pt 10pt", background: "#f7f7f7", border: "0.5pt solid #ccc", fontSize: "10.5pt" }}>
      <div><strong>Bank:</strong> Al Habib Limited</div>
      <div><strong>Account Title:</strong> Precise Realtors &amp; Builders (Pvt.) Ltd.</div>
      <div><strong>Account No.:</strong> 0440-0981-002027-01-4</div>
      <div><strong>IBAN:</strong> PK12BAHL0440098100202701</div>
    </div>
  );
}

function ToBlock({ c }: { c: any }) {
  return (
    <div style={{ margin: "10pt 0" }}>
      <div><strong>To:</strong> <Highlight>{c.title} {c.name}</Highlight> {c.father && <Highlight>{c.father}</Highlight>}</div>
      <div><strong>CNIC:</strong> <Highlight>{c.cnic}</Highlight></div>
      <div><strong>Address:</strong> <Highlight>{c.address}</Highlight></div>
    </div>
  );
}

function Signature({ name = "Authorized Signatory", entity }: { name?: string; entity?: string }) {
  return (
    <div style={{ marginTop: "30pt" }}>
      <div>For and on behalf of</div>
      <div><strong>{entity || "Precise Realtors & Builders (Pvt.) Ltd."}</strong></div>
      <div style={{ marginTop: "40pt", borderTop: "1pt solid #000", width: "60%" }} />
      <div style={{ fontSize: "10pt", marginTop: "2pt" }}>{name}</div>
    </div>
  );
}

function DocBody({ doc, c }: { doc: DocKey; c: any }) {
  if (doc === "legal") {
    return (
      <>
        <Letterhead />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5pt" }}>
          <div><Highlight>{c.ref}</Highlight></div>
          <div>Date: <Highlight>{c.today}</Highlight></div>
        </div>
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: "13pt", textDecoration: "underline", margin: "16pt 0 12pt" }}>
          LEGAL NOTICE
        </div>
        <ToBlock c={c} />
        <p><strong>Subject:</strong> Show Cause Notice for Non-Payment of Installments — <Highlight>{c.unitType} No. {c.unitNo}</Highlight>, <Highlight>{c.project}</Highlight></p>
        <p>Dear <Highlight>{c.title} {c.name}</Highlight>,</p>
        <p>This is to formally notify you, as per the records of Precise Realtors and Builders Pvt. Ltd., that despite repeated reminders, you have failed to clear the outstanding installments against <Highlight>{c.unitType} No. {c.unitNo}</Highlight>, Manal Arcade, B-1 Markaz, B-17, Islamabad. Such continued default is a material breach of the booking.</p>
        <p>You are hereby given a final opportunity to clear your outstanding dues as per the following instructions:</p>
        <p><strong>Required Action:</strong></p>
        <ol style={{ paddingLeft: "20pt" }}>
          <li>Pay the outstanding amount of <Highlight>{c.overdueAmtFmt}</Highlight> (<Highlight>{c.overdueWords}</Highlight>) within fifteen (15) days into the Company's designated account:
            <BankBlock />
          </li>
          <li>Provide a written explanation justifying the delay within the same period.</li>
          <li>Submit proof of payment via email to manalarcade@gmail.com and WhatsApp at +92 344 5533767.</li>
        </ol>
        <p><strong>Consequences of Non-Compliance:</strong></p>
        <p>If full payment is not received within the stipulated fifteen (15) days (by <Highlight>{c.deadline}</Highlight>), your allotment of <Highlight>{c.unitType} No. {c.unitNo}</Highlight> shall be cancelled without further notice. Precise Realtors and Builders Pvt. Ltd. shall be entitled to resell the {c.unitType} to another buyer. Any amounts previously paid shall be subject to deductions as per company policy, and no further claims shall be entertained.</p>
        <p>This is the final and binding notice. No extension of time shall be granted.</p>
        <p><strong>Overdue Installments Detail:</strong></p>
        <OverdueTable rows={c.overdueRows} />
        <Signature />
        <p style={{ fontSize: "10pt", marginTop: "12pt" }}>This notice is being served through registered courier and additionally forwarded to your WhatsApp number for record purposes.</p>
        <Footer />
      </>
    );
  }

  if (doc === "final") {
    return (
      <>
        <Letterhead />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5pt" }}>
          <div><Highlight>{c.ref}</Highlight></div>
          <div>DATE: <Highlight>{c.today}</Highlight></div>
        </div>
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: "13pt", textDecoration: "underline", margin: "16pt 0 12pt" }}>
          FINAL LEGAL NOTICE
        </div>
        <ToBlock c={c} />
        <p><strong>Subject:</strong> Final Legal Notice for Non-Payment of Installments — <Highlight>{c.unitType} No. {c.unitNo}</Highlight>, <Highlight>{c.project}</Highlight></p>
        <p>This Final Legal Notice is hereby issued on behalf of Precise Realtors and Builders Pvt. Ltd.</p>
        <p>You were previously served with a legal notice dated <Highlight>{c.prev1}</Highlight> regarding your persistent failure to clear outstanding installments in respect of <Highlight>{c.unitType} No. {c.unitNo}</Highlight>, Manal Arcade, B-17, Islamabad. Despite lawful service, you have neither responded nor made payment and continue to remain in willful default.</p>
        <p>Your conduct constitutes a material and continuing breach of the Booking Agreement executed with the Company.</p>
        <p>You are hereby called upon, for the final and last time, to deposit the outstanding amount of <Highlight>{c.overdueAmtFmt}</Highlight> (<Highlight>{c.overdueWords}</Highlight>) within ten (10) days from receipt of this notice (by <Highlight>{c.deadline}</Highlight>) into the Company's designated account:</p>
        <BankBlock />
        <p>Email: manalarcade@gmail.com · WhatsApp: +92 344 5533767</p>
        <p>Failing compliance, and strictly in accordance with the Booking Agreement, the Company shall without further notice be entitled to:</p>
        <ol style={{ paddingLeft: "20pt" }}>
          <li>Cancel your booking/allotment of <Highlight>{c.unitType} No. {c.unitNo}</Highlight> automatically.</li>
          <li>Resell or re-allot the {c.unitType} to any third party at its discretion.</li>
          <li>Deduct twenty percent (20%) of the total unit price upon third-party sale towards cancellation charges, expenses, and damages.</li>
          <li>Refund any remaining balance, if applicable, only after resale, subject to verification and Company policy.</li>
          <li>Treat you as having no right, title, interest, or claim whatsoever in the {c.unitType}; and</li>
          <li>Initiate appropriate civil and/or criminal proceedings at your risk as to cost and consequences, without prejudice to other remedies.</li>
        </ol>
        <p>This notice is final, binding, and conclusive. No extension, waiver, or concession shall be granted.</p>
        <OverdueTable rows={c.overdueRows} />
        <Signature />
        <p style={{ fontSize: "10pt", marginTop: "12pt" }}>This notice is being served through registered courier and simultaneously transmitted via WhatsApp for due service, record, and evidentiary purposes.</p>
        <Footer />
      </>
    );
  }

  if (doc === "final_cancel") {
    return (
      <>
        <Letterhead />
        <div style={{ textAlign: "right", fontSize: "10.5pt" }}>Date: <Highlight>{c.today}</Highlight></div>
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: "13pt", textDecoration: "underline", margin: "12pt 0 4pt" }}>
          FINAL LEGAL NOTICE
        </div>
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: "11pt", margin: "0 0 12pt" }}>
          (CANCELLATION, TERMINATION OF RIGHTS &amp; FINAL DEMAND)
        </div>
        <ToBlock c={c} />
        <p><strong>SUBJECT:</strong> FINAL NOTICE — CANCELLATION OF BOOKING &amp; TERMINATION OF RIGHTS DUE TO PERSISTENT DEFAULT — <Highlight>{c.unitType} {c.unitNo}</Highlight>, MANAL ARCADE, B-17 ISLAMABAD</p>
        <p>This Final Legal Notice is issued on behalf of PRECISE REALTORS &amp; BUILDERS (PVT.) LTD. in continuation of earlier legal notices duly served upon you, including the notice dated <Highlight>{c.prev1}</Highlight> and the Final Legal Notice dated <Highlight>{c.prev2}</Highlight>, whereby you were called upon to clear your outstanding liability.</p>
        <p>Under the Agreement to Sell dated <Highlight>{c.contractDate}</Highlight>, you purchased <Highlight>{c.unitType} No. {c.unitNo}</Highlight> (approximately <Highlight>{c.size}</Highlight> sq. ft.) in Manal Arcade, Plot No. 04, Block B-1 Markaz, Sector B-17, Islamabad, and were obligated to pay all installments as per the agreed payment schedule.</p>
        <p>As per Company records, the outstanding amount payable by you is <Highlight>{c.overdueAmtFmt}</Highlight> (<Highlight>{c.overdueWords}</Highlight>).</p>
        <p>Despite repeated notices, reminders, and sufficient opportunity, you have willfully failed to discharge your contractual obligations.</p>
        <p><strong>FINAL AND LAST OPPORTUNITY</strong></p>
        <p>You are hereby granted a final, strict, and non-extendable period of ten (10) days from <Highlight>{c.today}</Highlight> (by <Highlight>{c.deadline}</Highlight>) to:</p>
        <ol style={{ paddingLeft: "20pt" }}>
          <li>Pay the entire outstanding amount of <Highlight>{c.overdueAmtFmt}</Highlight> into the Company's designated account:
            <BankBlock />
          </li>
          <li>Submit proof of payment via WhatsApp at +92 344 5533767.</li>
        </ol>
        <p><strong>CONSEQUENCES OF DEFAULT</strong></p>
        <p>Take Final Notice That upon your failure to comply within the stipulated period:</p>
        <ul style={{ paddingLeft: "20pt" }}>
          <li>Your booking/allotment shall be cancelled automatically, without any further notice or correspondence.</li>
          <li>You shall cease to have any right, title, interest, claim, or lien whatsoever in respect of the said {c.unitType}.</li>
          <li>The Company shall be fully and absolutely entitled to resell, re-allot, transfer, or otherwise dispose of the said property to any third party, at its sole discretion, without any reference to you.</li>
          <li>Any amounts previously paid by you shall be adjusted, forfeited, and/or dealt with strictly in accordance with the terms of the Agreement, including recovery of losses, damages, and costs.</li>
          <li>The Company shall be at liberty of initiating appropriate civil and/or criminal proceedings, including but not limited to action under applicable laws, entirely at your risk as to cost and consequences.</li>
        </ul>
        <p>This notice is issued without prejudice to all rights, remedies, and claims available to the Company under the Agreement and applicable law.</p>
        <p>This Final Notice is being served through registered courier and electronic means (including WhatsApp) for proper service, record, and evidentiary purposes.</p>
        <Signature />
        <Footer />
      </>
    );
  }

  // cancellation
  return (
    <>
      <Letterhead variant="precise" />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5pt" }}>
        <div><Highlight>{c.ref}</Highlight></div>
        <div>Date: <Highlight>{c.today}</Highlight></div>
      </div>
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: "13pt", textDecoration: "underline", margin: "16pt 0 12pt" }}>
        FINAL CANCELLATION NOTICE
      </div>
      <ToBlock c={c} />
      <p><strong>Subject:</strong> Cancellation of Booking / Allotment of <Highlight>{c.unitType} No. {c.unitNo}</Highlight>, Manal Arcade</p>
      <p>Dear <Highlight>{c.title} {c.name}</Highlight>,</p>
      <p>This is to formally notify you that despite service of previous notices, including the Legal Notice dated <Highlight>{c.prev1}</Highlight> and Final Legal Notice dated <Highlight>{c.prev2}</Highlight>, you have failed to clear the outstanding amount of <Highlight>{c.overdueAmtFmt}</Highlight> against <Highlight>{c.unitType} No. {c.unitNo}</Highlight>, Manal Arcade, B-1 Markaz, B-17, Islamabad.</p>
      <p>Your continued default constitutes a material breach of the booking/allotment terms. Therefore, Precise Realtors &amp; Builders (Pvt.) Ltd. hereby cancels your booking/allotment of <Highlight>{c.unitType} No. {c.unitNo}</Highlight> with immediate effect.</p>
      <p>Consequently, you shall have no right, title, interest, lien, claim, possession claim, or demand in respect of the said {c.unitType}. The Company is entitled to resell/re-allot the {c.unitType} to any third party and to deduct 20% of the total unit price, along with all outstanding dues, damages, costs, charges, expenses, and any other lawful deductions as per agreement/company policy.</p>
      <p>Any remaining balance, if legally payable, shall be considered only after resale/re-allotment and final reconciliation of accounts. Any payment made after this notice shall not revive the booking unless expressly accepted in writing by the Company through an authorized signatory.</p>
      <p>This cancellation is final, binding, conclusive, and without prejudice to all legal rights and remedies of the Company.</p>
      <p><strong>Mode of Service:</strong> This notice is being served through TCS courier and also forwarded through WhatsApp for record and legal purposes.</p>
      <div style={{ margin: "10pt 0" }}>
        <div>TCS Tracking No.: ____________________</div>
        <div>WhatsApp No.: +92 344 5533767</div>
      </div>
      <Signature />
      <Footer variant="precise" />
    </>
  );
}
