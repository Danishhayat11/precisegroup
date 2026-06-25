import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, Column } from "@/components/DataTable";
import { StatusBadge, statusTone } from "@/components/StatusBadge";
import { fmtPKR } from "@/lib/format";

export default function Units() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["units"],
    queryFn: async () => (await supabase.from("units").select("*").order("unit_id")).data ?? [],
  });

  // Duplicate active-booking detection
  const linkedCount: Record<string, number> = {};
  rows.forEach((u: any) => { if (u.linked_booking_id) linkedCount[u.unit_id] = (linkedCount[u.unit_id] ?? 0) + 1; });

  const columns: Column<any>[] = [
    { key: "id", header: "Unit", cell: (r) => <span className="font-mono text-primary">{r.unit_id}</span> },
    { key: "proj", header: "Project", cell: (r) => r.project_name },
    { key: "type", header: "Type", cell: (r) => r.unit_type },
    { key: "floor", header: "Floor", cell: (r) => r.floor },
    { key: "size", header: "Size (sqft)", align: "right", cell: (r) => fmtPKR(r.size_sqft) },
    { key: "rate", header: "Base Rate", align: "right", cell: (r) => fmtPKR(r.base_rate) },
    { key: "std", header: "Standard Value", align: "right", cell: (r) => fmtPKR(r.standard_value) },
    { key: "status", header: "Status", cell: (r) => <StatusBadge label={r.status} tone={statusTone(r.status)} /> },
    { key: "booking", header: "Linked Booking", cell: (r) => r.linked_booking_id
      ? <div className="flex items-center gap-2">
          <span className="font-mono text-xs">{r.linked_booking_id}</span>
          {linkedCount[r.unit_id] > 1 && <StatusBadge label="Duplicate" tone="danger" />}
        </div>
      : <span className="text-muted-foreground">—</span> },
  ];

  return (
    <div>
      <PageHeader title="Units" description={`${rows.length} units · ${rows.filter((u: any) => u.status === "Available").length} available`} />
      {isLoading ? <div className="text-muted-foreground">Loading…</div> :
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.unit_id} searchKeys={["unit_id","unit_no","project_name","unit_type","floor","linked_booking_id"]} />}
    </div>
  );
}
