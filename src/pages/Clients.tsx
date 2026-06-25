import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, Column } from "@/components/DataTable";
import { maskCNIC } from "@/lib/format";

export default function Clients() {
  const { data: rows = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => (await supabase.from("clients").select("*").order("name")).data ?? [],
  });
  const columns: Column<any>[] = [
    { key: "ref", header: "Client Ref", cell: (r) => <span className="font-mono text-xs text-primary">{r.client_ref}</span> },
    { key: "name", header: "Name", cell: (r) => <span className="capitalize font-medium">{r.name}</span> },
    { key: "so", header: "S/O · W/O", cell: (r) => r.so_wo },
    { key: "cnic", header: "CNIC", cell: (r) => <span className="font-mono text-xs">{maskCNIC(r.cnic)}</span> },
    { key: "mob", header: "Mobile", cell: (r) => <span className="font-mono text-xs">{r.mobile}</span> },
    { key: "addr", header: "Address", cell: (r) => r.address },
  ];
  return (
    <div>
      <PageHeader title="Clients" description={`${rows.length} clients`} />
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.client_ref} searchKeys={["client_ref","name","cnic","mobile","address"]} />
    </div>
  );
}
