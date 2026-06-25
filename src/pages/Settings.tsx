import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/lib/auth";

export default function Settings() {
  const { user, roles } = useAuth();
  const { data: dealers = [] } = useQuery({ queryKey: ["s-dealers"], queryFn: async () => (await supabase.from("dealers").select("*")).data ?? [] });
  const { data: projects = [] } = useQuery({ queryKey: ["s-projects"], queryFn: async () => (await supabase.from("projects").select("*")).data ?? [] });

  const heads = ["Down Payment", "Installment 01-24", "Possession", "Adjustment Credit", "Other"];
  const modes = ["Cash", "Bank Transfer", "Cheque", "Online", "Adjustment", "Other"];
  const accounts = ["Cash in Hand", "Bank - HBL", "Bank - Meezan", "Bank - UBL", "Adjustment Account"];

  return (
    <div>
      <PageHeader title="Settings" description="Reference lists and your account" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Account">
          <Row k="Email" v={user?.email ?? "—"} />
          <Row k="Role" v={<span className="capitalize">{roles[0] ?? "viewer"}</span>} />
        </Card>
        <Card title="Projects">{projects.map((p: any) => <Row key={p.project_code} k={p.project_code} v={p.project_name} />)}</Card>
        <Card title="Dealers">{dealers.map((d: any) => <Row key={d.name} k={d.name} v={null} />)}</Card>
        <Card title="Payment heads">{heads.map((h) => <Row key={h} k={h} v={null} />)}</Card>
        <Card title="Payment modes">{modes.map((m) => <Row key={m} k={m} v={null} />)}</Card>
        <Card title="Accounts">{accounts.map((a) => <Row key={a} k={a} v={null} />)}</Card>
      </div>
    </div>
  );
}
function Card({ title, children }: { title: string; children: any }) {
  return <div className="card-elevated p-5"><div className="text-sm font-semibold mb-3">{title}</div><div className="divide-y">{children}</div></div>;
}
function Row({ k, v }: { k: string; v: any }) {
  return <div className="flex justify-between py-1.5 text-sm"><span>{k}</span>{v !== null && <span className="text-muted-foreground">{v}</span>}</div>;
}
