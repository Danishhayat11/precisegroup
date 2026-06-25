import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, Column } from "@/components/DataTable";
import { StatusBadge, statusTone } from "@/components/StatusBadge";
import { fmtPKR } from "@/lib/format";
import { Link } from "react-router-dom";

export default function Adjustments() {
  const { data: rows = [] } = useQuery({
    queryKey: ["adj"],
    queryFn: async () => (await supabase.from("adjustments").select("*")).data ?? [],
  });
  const totalApproved = rows.reduce((s: number, r: any) => s + (Number(r.approved_value) || 0), 0);
  const totalRealized = rows.reduce((s: number, r: any) => s + (Number(r.realized_value) || 0), 0);
  const totalLoss = rows.reduce((s: number, r: any) => s + (Number(r.company_loss_gain) || 0), 0);

  const columns: Column<any>[] = [
    { key: "id", header: "Adjustment", cell: (r) => <span className="font-mono text-xs text-primary">{r.adjustment_id}</span> },
    { key: "bk", header: "Booking", cell: (r) => <Link to={`/bookings/${r.booking_id}`} className="font-mono text-xs text-primary hover:underline">{r.booking_id}</Link> },
    { key: "client", header: "Client", cell: (r) => <span className="capitalize">{r.client_name}</span> },
    { key: "unit", header: "Unit", cell: (r) => <span className="font-mono text-xs">{r.unit_id}</span> },
    { key: "asset", header: "Asset / Remarks", cell: (r) => r.asset_description },
    { key: "appr", header: "Approved Credit", align: "right", cell: (r) => <span className="tabular-nums">{fmtPKR(r.approved_value)}</span> },
    { key: "real", header: "Realized", align: "right", cell: (r) => <span className="tabular-nums">{fmtPKR(r.realized_value)}</span> },
    { key: "lg", header: "Loss / Gain", align: "right", cell: (r) => {
      const v = Number(r.company_loss_gain) || 0;
      return <span className={`tabular-nums font-medium ${v > 0 ? "text-destructive" : v < 0 ? "text-success" : ""}`}>{fmtPKR(v)}</span>;
    } },
    { key: "type", header: "Type", cell: (r) => <StatusBadge label={r.loss_gain_type ?? "—"} tone={statusTone(r.loss_gain_type)} /> },
  ];

  return (
    <div>
      <PageHeader title="Adjustments / Loss Register"
        description={`${rows.length} entries · Approved ${fmtPKR(totalApproved)} · Realized ${fmtPKR(totalRealized)} · Loss ${fmtPKR(totalLoss)}`} />
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.adjustment_id}
        searchKeys={["adjustment_id","booking_id","client_name","unit_id","asset_description"]} />
    </div>
  );
}
