import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, Column } from "@/components/DataTable";
import { StatusBadge, statusTone } from "@/components/StatusBadge";
import { fmtDate, fmtPKR } from "@/lib/format";

export default function Bookings() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["bookings"],
    queryFn: async () => (await supabase.from("bookings").select("*").order("booking_date", { ascending: false })).data ?? [],
  });

  const columns: Column<any>[] = [
    { key: "id", header: "Booking", cell: (r) => <span className="font-mono text-xs text-primary">{r.booking_id}</span> },
    { key: "date", header: "Date", cell: (r) => fmtDate(r.booking_date) },
    { key: "client", header: "Client", cell: (r) => <span className="capitalize">{r.client_name}</span> },
    { key: "unit", header: "Unit", cell: (r) => <span className="font-mono text-xs">{r.unit_id}</span> },
    { key: "value", header: "Contract", align: "right", cell: (r) => <span className="tabular-nums">{fmtPKR(r.total_contract_value)}</span> },
    { key: "cash", header: "Cash Recvd", align: "right", cell: (r) => <span className="tabular-nums">{fmtPKR(r.cash_received)}</span> },
    { key: "rem", header: "Remaining", align: "right", cell: (r) => <span className="tabular-nums font-medium">{fmtPKR(r.remaining_balance)}</span> },
    { key: "ov", header: "Overdue", align: "right", cell: (r) => r.current_overdue_count > 0 ? <span className="text-destructive font-medium tabular-nums">{r.current_overdue_count}</span> : <span className="text-muted-foreground">0</span> },
    { key: "risk", header: "Risk", cell: (r) => <StatusBadge label={r.risk_level} tone={statusTone(r.risk_level)} /> },
    { key: "status", header: "Status", cell: (r) => <StatusBadge label={r.booking_status} tone={statusTone(r.booking_status)} /> },
  ];

  return (
    <div>
      <PageHeader title="Bookings" description={`${rows.length} bookings imported from MASTER_ENTRY`} />
      {isLoading ? <div className="text-muted-foreground">Loading…</div> :
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.booking_id}
          rowHref={(r) => `/bookings/${r.booking_id}`}
          searchKeys={["booking_id","client_name","unit_id","cnic","mobile","project_name"]}
          empty="No bookings yet." />}
    </div>
  );
}
