import { useQuery } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, Column } from "@/components/DataTable";
import { fmtDate } from "@/lib/format";
import { AuditBackToPaymentLink } from "@/components/AuditBackToPaymentLink";

export default function AuditLog() {
  const [params] = useSearchParams();
  const highlight = params.get("highlight");
  const filterAction = params.get("action");
  const filterEntity = params.get("entity");
  const filterEntityId = params.get("entity_id");

  const { data: rows = [] } = useQuery({
    queryKey: ["audit", filterAction, filterEntity, filterEntityId],
    queryFn: async () => {
      let q = supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(500);
      if (filterAction) q = q.eq("action", filterAction);
      if (filterEntity) q = q.eq("entity", filterEntity);
      if (filterEntityId) q = q.eq("entity_id", filterEntityId);
      return (await q).data ?? [];
    },
  });

  const columns: Column<any>[] = [
    { key: "when", header: "When", cell: (r) => fmtDate(r.created_at) },
    { key: "actor", header: "Actor", cell: (r) => r.actor_email ?? "system" },
    { key: "act", header: "Action", cell: (r) => <span className="font-mono text-xs">{r.action}</span> },
    { key: "ent", header: "Entity", cell: (r) => `${r.entity ?? ""}${r.entity_id ? ` · ${r.entity_id}` : ""}` },
    {
      key: "back",
      header: "",
      cell: (r) => {
        // Back link only makes sense for blocked payment-save attempts: we can
        // open the Payment form pre-filled with the receipt + the exact attempt.
        if (r.action !== "payment.save.blocked" || !r.entity_id) return null;
        return (
          <Link
            to={`/payments?openReceipt=${encodeURIComponent(r.entity_id)}&audit=${encodeURIComponent(r.id)}`}
            className="inline-flex items-center gap-1 rounded border border-destructive/30 bg-destructive/5 px-2 py-0.5 text-[11px] font-semibold text-destructive hover:bg-destructive/10"
            title={`Open the Payment form for ${r.entity_id} with this exact blocked attempt loaded`}
          >
            <ArrowLeftToLine className="h-3 w-3" />
            Back to payment
          </Link>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title="Audit Log" description="System activity trail" />
      {(filterAction || filterEntity || filterEntityId) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>Filtered:</span>
          {filterAction && <span className="rounded border px-1.5 py-0.5 font-mono">action={filterAction}</span>}
          {filterEntity && <span className="rounded border px-1.5 py-0.5 font-mono">entity={filterEntity}</span>}
          {filterEntityId && <span className="rounded border px-1.5 py-0.5 font-mono">entity_id={filterEntityId}</span>}
          <Link to="/audit" className="text-primary hover:underline">Clear</Link>
        </div>
      )}
      <DataTable
        rows={rows}
        columns={highlight ? [
          { key: "mark", header: "", cell: (r) => highlight === r.id
            ? <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">latest</span>
            : null,
          },
          ...columns,
        ] : columns}
        rowKey={(r) => r.id}
        empty="No audit entries yet. Future create/edit/delete operations and imports will appear here."
      />
    </div>
  );
}
