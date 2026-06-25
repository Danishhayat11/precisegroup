import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, Column } from "@/components/DataTable";
import { StatusBadge, statusTone } from "@/components/StatusBadge";
import { fmtDate, fmtPKR } from "@/lib/format";
import { Link } from "react-router-dom";

export default function Payments() {
  const { data: rows = [] } = useQuery({
    queryKey: ["payments"],
    queryFn: async () => (await supabase.from("payments").select("*").order("payment_date", { ascending: false })).data ?? [],
  });

  const total = rows.reduce((s: number, p: any) => s + (Number(p.safe_cash_amount) || 0), 0);

  const columns: Column<any>[] = [
    { key: "rec", header: "Receipt", cell: (r) => <span className="font-mono text-xs text-primary">{r.receipt_no}</span> },
    { key: "date", header: "Date", cell: (r) => fmtDate(r.payment_date) },
    { key: "booking", header: "Booking", cell: (r) => <Link to={`/bookings/${r.booking_id}`} className="font-mono text-xs text-primary hover:underline">{r.booking_id}</Link> },
    { key: "client", header: "Client", cell: (r) => <span className="capitalize">{r.client_name}</span> },
    { key: "head", header: "Head", cell: (r) => r.payment_head },
    { key: "mode", header: "Mode", cell: (r) => <StatusBadge label={r.payment_mode ?? "—"} tone={r.payment_mode === "Adjustment" ? "adjustment" : "info"} /> },
    { key: "amt", header: "Amount", align: "right", cell: (r) => <span className="tabular-nums">{fmtPKR(r.amount)}</span> },
    { key: "safe", header: "Safe Cash", align: "right", cell: (r) => <span className="tabular-nums">{fmtPKR(r.safe_cash_amount)}</span> },
    { key: "acct", header: "Account", cell: (r) => <span className="text-xs text-muted-foreground">{r.account}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Payments"
        description={`${rows.length} receipts · Total safe cash: ${fmtPKR(total)}`}
      />
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.receipt_no}
        searchKeys={["receipt_no","booking_id","client_name","payment_head","payment_mode","account"]} />
    </div>
  );
}
