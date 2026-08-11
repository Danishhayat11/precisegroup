import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/lib/auth";
import { useMCP } from "@/integrations/mcp/useMCP";
import { Plus, Trash2, RefreshCw, Server, AlertCircle, CheckCircle2 } from "lucide-react";

export default function Settings() {
  const { user, roles } = useAuth();
  const { servers, addServer, removeServer, reconnect } = useMCP();
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const { data: dealers = [] } = useQuery({ queryKey: ["s-dealers"], queryFn: async () => (await supabase.from("dealers").select("*")).data ?? [] });
  const { data: projects = [] } = useQuery({ queryKey: ["s-projects"], queryFn: async () => (await supabase.from("projects").select("*")).data ?? [] });

  const heads = ["Down Payment", "Installment 01-24", "Possession", "Adjustment Credit", "Other"];
  const modes = ["Cash", "Bank Transfer", "Cheque", "Online", "Adjustment", "Other"];
  const accounts = ["Cash in Hand", "Bank - HBL", "Bank - Meezan", "Bank - UBL", "Adjustment Account"];

  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newUrl) return;
    await addServer(newName, newUrl);
    setNewName("");
    setNewUrl("");
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Reference lists and your account" />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Account">
          <Row k="Email" v={user?.email ?? "—"} />
          <Row k="Role" v={<span className="capitalize">{roles[0] ?? "viewer"}</span>} />
        </Card>

        <Card title="Agent Integrations (MCP)">
          <div className="space-y-4">
            <form onSubmit={handleAddServer} className="flex gap-2 mb-4">
              <input 
                type="text" 
                placeholder="Server Name" 
                className="flex-1 bg-muted rounded px-3 py-1.5 text-sm"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
              <input 
                type="text" 
                placeholder="SSE URL (e.g. http://localhost:3001/sse)" 
                className="flex-[2] bg-muted rounded px-3 py-1.5 text-sm"
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
              />
              <button type="submit" className="p-1.5 bg-primary text-primary-foreground rounded hover:opacity-90">
                <Plus size={16} />
              </button>
            </form>

            <div className="divide-y">
              {servers.length === 0 && (
                <div className="py-4 text-center text-sm text-muted-foreground italic">
                  No MCP servers configured
                </div>
              )}
              {servers.map(server => (
                <div key={server.id} className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={
                      server.status === 'connected' ? 'text-green-500' :
                      server.status === 'error' ? 'text-red-500' :
                      'text-muted-foreground'
                    }>
                      {server.status === 'connected' ? <CheckCircle2 size={16} /> :
                       server.status === 'error' ? <AlertCircle size={16} /> :
                       <Server size={16} className={server.status === 'connecting' ? 'animate-pulse' : ''} />}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{server.name}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">{server.url}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => reconnect(server.id)}
                      className="p-1.5 hover:bg-muted rounded text-muted-foreground"
                      title="Reconnect"
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button 
                      onClick={() => removeServer(server.id)}
                      className="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded text-muted-foreground"
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
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
  return <div className="card-elevated p-5"><div className="text-sm font-semibold mb-3">{title}</div>{children}</div>;
}

function Row({ k, v }: { k: string; v: any }) {
  return <div className="flex justify-between py-1.5 text-sm border-b last:border-0"><span>{k}</span>{v !== null && <span className="text-muted-foreground">{v}</span>}</div>;
}
