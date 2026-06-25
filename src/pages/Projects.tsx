import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, Column } from "@/components/DataTable";
import { fmtDate, fmtPKR } from "@/lib/format";
import { StatusBadge, statusTone } from "@/components/StatusBadge";

export default function Projects() {
  const { data: rows = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await supabase.from("projects").select("*")).data ?? [],
  });
  const { data: units = [] } = useQuery({
    queryKey: ["units-for-projects"],
    queryFn: async () => (await supabase.from("units").select("project_code,status")).data ?? [],
  });
  const enriched = rows.map((p: any) => {
    const u = units.filter((x: any) => x.project_code === p.project_code);
    return { ...p, _total: u.length, _booked: u.filter((x: any) => x.status === "Booked").length };
  });

  const columns: Column<any>[] = [
    { key: "code", header: "Code", cell: (r) => <span className="font-mono text-primary">{r.project_code}</span> },
    { key: "name", header: "Project", cell: (r) => <span className="font-medium">{r.project_name}</span> },
    { key: "loc", header: "Location", cell: (r) => r.location },
    { key: "status", header: "Status", cell: (r) => <StatusBadge label={r.status} tone={statusTone(r.status)} /> },
    { key: "start", header: "Start", cell: (r) => fmtDate(r.start_date) },
    { key: "end", header: "Completion", cell: (r) => fmtDate(r.expected_completion_date) },
    { key: "units", header: "Units (Booked / Total)", align: "right", cell: (r) => <span className="tabular-nums">{r._booked} / {r._total}</span> },
  ];
  return (
    <div>
      <PageHeader title="Projects" description={`${rows.length} projects`} />
      <DataTable rows={enriched} columns={columns} rowKey={(r) => r.project_code} searchKeys={["project_code","project_name","location"]} />
    </div>
  );
}
