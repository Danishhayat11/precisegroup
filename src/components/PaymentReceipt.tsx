import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, fmtPKR, maskCNIC } from "@/lib/format";
import PrintPreviewModal from "@/components/PrintPreviewModal";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receiptNo: string | null;
}

export function PaymentReceipt({ open, onOpenChange, receiptNo }: Props) {
  const { data } = useQuery({
    queryKey: ["receipt", receiptNo],
    enabled: !!receiptNo && open,
    queryFn: async () => {
      const { data: pay } = await supabase.from("payments").select("*").eq("receipt_no", receiptNo!).maybeSingle();
      if (!pay) return null;
      const { data: booking } = await supabase.from("bookings").select("*").eq("booking_id", pay.booking_id!).maybeSingle();
      // Running totals: cash-vs-adjustment kept separate
      const { data: history } = await supabase
        .from("payments")
        .select("amount,safe_cash_amount,non_cash_adjustment,payment_date,receipt_no")
        .eq("booking_id", pay.booking_id!)
        .order("payment_date", { ascending: true });
      const upToHere = (history ?? []).filter((p: any) => {
        if (p.payment_date < pay.payment_date) return true;
        if (p.payment_date === pay.payment_date && p.receipt_no <= pay.receipt_no) return true;
        return false;
      });
      const cashToDate = upToHere.reduce((s, p: any) => s + Number(p.safe_cash_amount || 0), 0);
      const adjToDate = upToHere.reduce((s, p: any) => s + (p.non_cash_adjustment ? Number(p.amount || 0) : 0), 0);
      return { pay, booking, cashToDate, adjToDate };
    },
  });

  if (!receiptNo) return null;
  const pay = data?.pay;
  const b = data?.booking;
  const contract = Number(b?.total_contract_value ?? b?.sold_unit_value ?? 0);
  const totalReceived = (data?.cashToDate ?? 0) + (data?.adjToDate ?? 0);
  const remaining = Math.max(contract - totalReceived, 0);

  const body = (
    <div style={{ fontFamily: '"Times New Roman", Georgia, serif', fontSize: "11.5pt", color: "#1B2B4B" }}>
      <h2 style={{ textAlign: "center", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 6mm 0", fontSize: "14pt", color: "#1B2B4B" }}>
        Payment Receipt
      </h2>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5mm", fontSize: "10.5pt" }}>
        <div><strong>Receipt #:</strong> {pay?.receipt_no}</div>
        <div><strong>Date:</strong> {fmtDate(pay?.payment_date)}</div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10.5pt", marginBottom: "5mm" }}>
        <tbody>
          <Row label="Client Name" value={b?.client_name} />
          <Row label="CNIC" value={maskCNIC(b?.cnic)} />
          <Row label="Booking ID" value={pay?.booking_id} />
          <Row label="Unit" value={`${b?.unit_id ?? ""} (${b?.unit_type ?? "—"})`} />
          <Row label="Floor" value={b?.floor} />
        </tbody>
      </table>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10.5pt", marginBottom: "5mm" }}>
        <tbody>
          <Row label="Payment Head" value={pay?.payment_head} />
          <Row label="Payment Type" value={pay?.payment_mode} />
          {pay?.account && <Row label="Bank" value={pay?.account} />}
          <Row label="Cheque / Reference" value={pay?.cheque_txn_no || "—"} />
          <Row label="Amount" value={`PKR ${fmtPKR(pay?.amount)}`} strong />
          <Row label="Received By" value={pay?.posted_by || "—"} />
        </tbody>
      </table>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10.5pt", marginBottom: "6mm", border: "1px solid #1B2B4B33" }}>
        <thead>
          <tr style={{ background: "#1B2B4B0d" }}>
            <th colSpan={2} style={{ padding: "2mm 3mm", textAlign: "left", fontSize: "10.5pt" }}>Account Running Balance (after this receipt)</th>
          </tr>
        </thead>
        <tbody>
          <Row label="Contract Value" value={`PKR ${fmtPKR(contract)}`} />
          <Row label="Cash / Bank Received to Date" value={`PKR ${fmtPKR(data?.cashToDate ?? 0)}`} />
          <Row label="Adjustment Credit Applied" value={`PKR ${fmtPKR(data?.adjToDate ?? 0)}`} />
          <Row label="Total Received" value={`PKR ${fmtPKR(totalReceived)}`} strong />
          <Row label="Remaining Balance" value={`PKR ${fmtPKR(remaining)}`} strong />
        </tbody>
      </table>

      {pay?.remarks && (
        <div style={{ marginBottom: "8mm", fontSize: "10pt" }}>
          <strong>Notes:</strong> {pay.remarks}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "18mm", fontSize: "10.5pt" }}>
        <div style={{ width: "60mm", textAlign: "center" }}>
          <div style={{ borderTop: "1px solid #1B2B4B", paddingTop: "1.5mm" }}>Client Signature</div>
        </div>
        <div style={{ width: "60mm", textAlign: "center" }}>
          <div style={{ borderTop: "1px solid #1B2B4B", paddingTop: "1.5mm" }}>Authorized Signatory</div>
          <div style={{ fontSize: "9pt", color: "#555", marginTop: "1mm" }}>
            Date: ___________________
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <PrintPreviewModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Payment Receipt — ${receiptNo}`}
      mode="react"
    >
      {body}
    </PrintPreviewModal>
  );
}

function Row({ label, value, strong }: { label: string; value: any; strong?: boolean }) {
  return (
    <tr>
      <td style={{ padding: "1.5mm 3mm", width: "55mm", color: "#555" }}>{label}</td>
      <td style={{ padding: "1.5mm 3mm", fontWeight: strong ? 700 : 400 }}>{value ?? "—"}</td>
    </tr>
  );
}
