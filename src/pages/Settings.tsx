import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/lib/auth";
import { useMCP } from "@/integrations/mcp/useMCP";
import { Plus, Trash2, RefreshCw, Server, AlertCircle, CheckCircle2, Shield, Power, PowerOff, Loader2, Zap, Clock } from "lucide-react";

export default function Settings() {
  const { user, roles } = useAuth();
  const { servers, addServer, removeServer, reconnect, testConnection } = useMCP();
  
  // Form State
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  
  // Validation State
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; success?: boolean; message?: string }>>({});

  const { data: dealers = [] } = useQuery({ queryKey: ["s-dealers"], queryFn: async () => (await supabase.from("dealers").select("*")).data ?? [] });
  const { data: projects = [] } = useQuery({ queryKey: ["s-projects"], queryFn: async () => (await supabase.from("projects").select("*")).data ?? [] });

  const heads = ["Down Payment", "Installment 01-24", "Possession", "Adjustment Credit", "Other"];
  const modes = ["Cash", "Bank Transfer", "Cheque", "Online", "Adjustment", "Other"];
  const accounts = ["Cash in Hand", "Bank - HBL", "Bank - Meezan", "Bank - UBL", "Adjustment Account"];

  const handleTest = async (id: string, retries = 0) => {
    setTestResults(prev => ({ ...prev, [id]: { loading: true } }));
    try {
      const result = await testConnection(id, { timeout: 5000, retries });
      setTestResults(prev => ({ ...prev, [id]: { loading: false, success: result.success, message: result.message } }));
      
      if (result.success) {
        // Clear message after 5 seconds for success
        setTimeout(() => {
          setTestResults(prev => {
            const next = { ...prev };
            if (next[id]) {
              const { message, ...rest } = next[id];
              next[id] = rest;
            }
            return next;
          });
        }, 5000);
      }
    } catch (err) {
      setTestResults(prev => ({ ...prev, [id]: { loading: false, success: false, message: "Test failed unexpectedly" } }));
    }
  };

  const validateUrl = (url: string) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!newName.trim()) {
      setError("Server name is required");
      return;
    }

    if (!newUrl.trim()) {
      setError("Server URL is required");
      return;
    }

    if (!validateUrl(newUrl)) {
      setError("Please enter a valid URL (e.g., http://localhost:3001/sse)");
      return;
    }

    setIsValidating(true);
    try {
      await addServer(newName, newUrl);
      setNewName("");
      setNewUrl("");
      setApiKey("");
      setError(null);
    } catch (err) {
      setError("Failed to add server integration");
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Reference lists and your account" />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Account">
          <Row k="Email" v={user?.email ?? "—"} />
          <Row k="Role" v={<span className="capitalize">{roles[0] ?? "viewer"}</span>} />
        </Card>

        <Card title="Agent Integrations (MCP)">
          <div className="space-y-6">
            <div className="bg-muted/30 border rounded-lg p-4">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Plus size={16} className="text-primary" />
                Add New Connection
              </h3>
              <form onSubmit={handleAddServer} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Local Python Agent" 
                      className="w-full bg-background border rounded px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">SSE Endpoint</label>
                    <input 
                      type="text" 
                      placeholder="http://localhost:3001/sse" 
                      className="w-full bg-background border rounded px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none"
                      value={newUrl}
                      onChange={e => setNewUrl(e.target.value)}
                    />
                  </div>
                </div>
                
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1">
                    <Shield size={10} /> API Key / Token (Optional)
                  </label>
                  <input 
                    type="password" 
                    placeholder="Enter credential if required" 
                    className="w-full bg-background border rounded px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                  />
                </div>

                {error && (
                  <div className="text-xs text-destructive flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1">
                    <AlertCircle size={12} />
                    {error}
                  </div>
                )}

                <button 
                  type="submit" 
                  disabled={isValidating}
                  className="w-full py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {isValidating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Connect Agent
                </button>
              </form>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium flex items-center justify-between">
                Active Connections
                <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                  {servers.length} configured
                </span>
              </h3>
              
              <div className="divide-y border rounded-lg overflow-hidden bg-background">
                {servers.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground italic flex flex-col items-center gap-2">
                    <Server size={24} className="opacity-20" />
                    No MCP servers configured yet
                  </div>
                )}
                {servers.map(server => (
                  <div key={server.id} className="group">
                    <div className="p-4 flex items-center justify-between hover:bg-muted/10 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className={`p-2 rounded-full ${
                          server.status === 'connected' ? 'bg-green-500/10 text-green-500' :
                          server.status === 'error' ? 'bg-red-500/10 text-red-500' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {server.status === 'connected' ? <Power size={18} /> :
                           server.status === 'error' ? <AlertCircle size={18} /> :
                           <PowerOff size={18} className={server.status === 'connecting' ? 'animate-pulse' : ''} />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{server.name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full uppercase font-bold ${
                              server.status === 'connected' ? 'bg-green-500/20 text-green-600' :
                              'bg-muted text-muted-foreground'
                            }`}>
                              {server.status}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground font-mono mt-0.5 truncate max-w-[200px]">{server.url}</div>
                          {server.lastTest && (
                            <div className={`text-[10px] mt-1 flex items-center gap-1.5 ${
                              server.lastTest.success ? 'text-green-600/70' : 'text-destructive/70'
                            }`}>
                              <Clock size={10} />
                              <span>Last test: {new Date(server.lastTest.timestamp).toLocaleTimeString()}</span>
                              {!server.lastTest.success && (
                                <span className="italic truncate max-w-[150px]"> — {server.lastTest.message}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => handleTest(server.id)}
                          disabled={server.status !== 'connected' || testResults[server.id]?.loading}
                          className={`p-2 rounded-md transition-colors disabled:opacity-30 ${
                            server.lastTest?.success 
                              ? 'text-green-500 hover:bg-green-500/10' 
                              : 'text-muted-foreground hover:bg-muted'
                          }`}
                          title="Test Connection"
                        >
                          {testResults[server.id]?.loading ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                        </button>
                        <button 
                          onClick={() => reconnect(server.id)}
                          className="p-2 hover:bg-muted rounded-md text-muted-foreground transition-colors"
                          title="Reconnect / Refresh"
                        >
                          <RefreshCw size={16} />
                        </button>
                        <button 
                          onClick={() => removeServer(server.id)}
                          className="p-2 hover:bg-destructive/10 hover:text-destructive rounded-md text-muted-foreground transition-colors"
                          title="Disconnect & Remove"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    {testResults[server.id]?.message && (
                      <div className={`px-14 pb-3 text-[11px] animate-in fade-in slide-in-from-top-1 flex items-center justify-between gap-4 ${
                        testResults[server.id]?.success ? 'text-green-600' : 'text-destructive'
                      }`}>
                        <span className="flex-1">{testResults[server.id]?.message}</span>
                        {!testResults[server.id]?.success && !testResults[server.id]?.loading && (
                          <button
                            onClick={() => handleTest(server.id, 2)}
                            className="text-[10px] font-bold uppercase tracking-wider bg-destructive/10 px-2 py-0.5 rounded hover:bg-destructive/20 transition-colors flex items-center gap-1"
                          >
                            <RefreshCw size={10} />
                            Retry (3x)
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card title="Projects">{projects.map((p) => <Row key={p.project_code} k={p.project_code} v={p.project_name} />)}</Card>
        <Card title="Dealers">{dealers.map((d) => <Row key={d.name} k={d.name} v={null} />)}</Card>
        <Card title="Payment heads">{heads.map((h) => <Row key={h} k={h} v={null} />)}</Card>
        <Card title="Payment modes">{modes.map((m) => <Row key={m} k={m} v={null} />)}</Card>
        <Card title="Accounts">{accounts.map((a) => <Row key={a} k={a} v={null} />)}</Card>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-elevated flex flex-col h-full">
      <div className="px-5 py-4 border-b">
        <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{title}</div>
      </div>
      <div className="p-5 flex-1">
        {children}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between py-2 text-sm border-b last:border-0 border-muted/50">
      <span className="text-muted-foreground">{k}</span>
      {v !== null && <span className="font-medium">{v}</span>}
    </div>
  );
}
