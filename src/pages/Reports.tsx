import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { fmtPKR } from "@/lib/format";

export default function Reports() {
  const { data } = useQuery({
    queryKey: ["reports"],
    queryFn: async () => {
      const [bookings, payments, ledger, dealers] = await Promise.all([
        supabase.from("bookings").select("*"),
        supabase.from("payments").select("*"),
        supabase.from("installment_ledger").select("*"),
        supabase.from("dealers").select("*"),
      ]);
      return { bookings: bookings.data ?? [], payments: payments.data ?? [], ledger: ledger.data ?? [], dealers: dealers.data ?? [] };
    },
  });
  if (!data) return <div className="text-muted-foreground">Loading…</div>;

  const dealerCommission = (data.dealers ?? []).map((d: any) => {
    const total = data.bookings.filter((b: any) => b.dealer_name === d.name)
      .reduce((s: number, b: any) => s + (Number(b.dealer_commission_amount) || 0), 0);
    return { name: d.name, total };
  });

  const today = new Date().toISOString().slice(0, 10);
  const aging = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  data.ledger.forEach((l: any) => {
    const rem = Math.max((Number(l.due_amount) || 0) - (Number(l.paid_amount) || 0), 0);
    if (!l.due_date || l.due_date >= today || rem <= 0) return;
    if (/down payment|possession/i.test(l.particulars ?? "")) return;
    const days = Math.floor((Date.now() - new Date(l.due_date).getTime()) / 86400000);
    if (days <= 30) aging["0-30"] += rem;
    else if (days <= 60) aging["31-60"] += rem;
    else if (days <= 90) aging["61-90"] += rem;
    else aging["90+"] += rem;
  });

  return (
    <div>
      <PageHeader title="Reports" description="Operational and accounting reports rolled up from live data" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReportCard title="Aging — overdue receivable" rows={Object.entries(aging).map(([k, v]) => ({ label: `${k} days`, value: fmtPKR(v as number) }))} />
        <ReportCard title="Dealer commission" rows={dealerCommission.map((d: any) => ({ label: d.name, value: fmtPKR(d.total) }))} />
        <ReportCard title="Payment collection by head" rows={Object.entries(
          data.payments.reduce((acc: Record<string, number>, p: any) => {
            const h = p.payment_head ?? "Other";
            acc[h] = (acc[h] ?? 0) + (Number(p.safe_cash_amount) || 0);
            return acc;
          }, {})
        ).map(([k, v]) => ({ label: k, value: fmtPKR(v as number) }))} />
        <ReportCard title="Project-wise sales" rows={Object.entries(
          data.bookings.reduce((acc: Record<string, number>, b: any) => {
            const p = b.project_name ?? "—";
            acc[p] = (acc[p] ?? 0) + (Number(b.total_contract_value) || 0);
            return acc;
          }, {})
        ).map(([k, v]) => ({ label: k, value: fmtPKR(v as number) }))} />
      </div>

      <div className="card-elevated overflow-hidden mt-4">
        <div className="p-4 border-b text-sm font-semibold">Client statements</div>
        <div className="overflow-x-auto max-h-[60vh]">
          <table className="w-full text-sm table-sticky">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2.5 border-b">Booking</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Client</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Unit</th>
                <th className="text-right font-medium px-4 py-2.5 border-b">Contract Value</th>
                <th className="text-right font-medium px-4 py-2.5 border-b">Cash Received</th>
                <th className="text-right font-medium px-4 py-2.5 border-b">Outstanding</th>
                <th className="text-right font-medium px-4 py-2.5 border-b">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.bookings.map((b: any) => (
                <tr key={b.booking_id} className="border-t">
                  <td className="px-4 py-2 font-mono text-xs text-primary">{b.booking_id}</td>
                  <td className="px-4 py-2 capitalize">{b.client_name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{b.unit_id}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtPKR(b.total_contract_value)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtPKR(b.cash_received)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtPKR(b.remaining_balance)}</td>
                  <td className="px-4 py-2 text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/payment-history/${b.booking_id}`}>
                        <Printer className="h-3.5 w-3.5 mr-1" /> Print Client Statement
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ReportCard({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  return (
    <div className="card-elevated overflow-hidden">
      <div className="p-4 border-b text-sm font-semibold">{title}</div>
      <div className="divide-y">
        {rows.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">No data</div> :
          rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between px-5 py-2.5 text-sm">
              <span>{r.label}</span>
              <span className="tabular-nums font-medium">{r.value}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
