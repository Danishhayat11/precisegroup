import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, Column } from "@/components/DataTable";
import { fmtDate } from "@/lib/format";

export default function AuditLog() {
  const { data: rows = [] } = useQuery({
    queryKey: ["audit"],
    queryFn: async () => (await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(500)).data ?? [],
  });
  const columns: Column<any>[] = [
    { key: "when", header: "When", cell: (r) => fmtDate(r.created_at) },
    { key: "actor", header: "Actor", cell: (r) => r.actor_email ?? "system" },
    { key: "act", header: "Action", cell: (r) => <span className="font-mono text-xs">{r.action}</span> },
    { key: "ent", header: "Entity", cell: (r) => `${r.entity ?? ""}${r.entity_id ? ` · ${r.entity_id}` : ""}` },
  ];
  return (
    <div>
      <PageHeader title="Audit Log" description="System activity trail" />
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id}
        empty="No audit entries yet. Future create/edit/delete operations and imports will appear here." />
    </div>
  );
}
