import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, Column } from "@/components/DataTable";
import { StatusBadge, statusTone } from "@/components/StatusBadge";
import { fmtDate, fmtPKR } from "@/lib/format";
import { Link } from "react-router-dom";

export default function Ledger() {
  const { data: rows = [] } = useQuery({
    queryKey: ["ledger-all"],
    queryFn: async () => (await supabase.from("installment_ledger").select("*").order("due_date")).data ?? [],
  });

  const today = new Date().toISOString().slice(0, 10);
  const enriched = rows.map((l: any) => {
    const due = Number(l.due_amount) || 0;
    const paid = Number(l.paid_amount) || 0;
    const remaining = Math.max(due - paid, 0);
    const isInstallment = !/down payment|possession/i.test(l.particulars ?? "");
    let status = "Pending";
    if (remaining <= 0) status = "Paid";
    else if (paid > 0) status = "Partial";
    else if (isInstallment && l.due_date && l.due_date < today) status = "Overdue";
    const days = (isInstallment && l.due_date && l.due_date < today && remaining > 0)
      ? Math.floor((Date.now() - new Date(l.due_date).getTime()) / 86400000) : 0;
    return { ...l, _status: status, _remaining: remaining, _days: days };
  });

  const columns: Column<any>[] = [
    { key: "lg", header: "Ledger", cell: (r) => <span className="font-mono text-xs">{r.ledger_id}</span> },
    { key: "bk", header: "Booking", cell: (r) => <Link to={`/bookings/${r.booking_id}`} className="font-mono text-xs text-primary hover:underline">{r.booking_id}</Link> },
    { key: "client", header: "Client", cell: (r) => <span className="capitalize">{r.client_name}</span> },
    { key: "part", header: "Particulars", cell: (r) => r.particulars },
    { key: "due", header: "Due Date", cell: (r) => fmtDate(r.due_date) },
    { key: "amt", header: "Due", align: "right", cell: (r) => <span className="tabular-nums">{fmtPKR(r.due_amount)}</span> },
    { key: "paid", header: "Paid", align: "right", cell: (r) => <span className="tabular-nums">{fmtPKR(r.paid_amount)}</span> },
    { key: "rem", header: "Remaining", align: "right", cell: (r) => <span className="tabular-nums font-medium">{fmtPKR(r._remaining)}</span> },
    { key: "days", header: "Days Late", align: "right", cell: (r) => r._days || "—" },
    { key: "st", header: "Status", cell: (r) => <StatusBadge label={r._status} tone={statusTone(r._status)} /> },
  ];

  return (
    <div>
      <PageHeader title="Installment Ledger" description={`${enriched.length} ledger entries across all bookings`} />
      <DataTable rows={enriched} columns={columns} rowKey={(r) => r.ledger_id}
        searchKeys={["booking_id","client_name","particulars","ledger_id"]} />
    </div>
  );
}
