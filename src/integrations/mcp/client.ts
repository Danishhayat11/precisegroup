import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export interface MCPServer {
  id: string;
  name: string;
  url: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
}

class MCPManager {
  private clients: Map<string, Client> = new Map();
  private servers: MCPServer[] = [];
  private onUpdate: (servers: MCPServer[]) => void = () => {};

  constructor() {
    const saved = localStorage.getItem('mcp_servers');
    if (saved) {
      try {
        this.servers = JSON.parse(saved).map((s: any) => ({ ...s, status: 'disconnected' }));
      } catch (e) {
        console.error('Failed to load MCP servers', e);
      }
    }
  }

  setUpdateCallback(callback: (servers: MCPServer[]) => void) {
    this.onUpdate = callback;
    this.onUpdate([...this.servers]);
  }

  async addServer(name: string, url: string) {
    const id = crypto.randomUUID();
    const newServer: MCPServer = { id, name, url, status: 'disconnected' };
    this.servers.push(newServer);
    this.save();
    this.connect(id);
  }

  async removeServer(id: string) {
    const client = this.clients.get(id);
    if (client) {
      await client.close();
      this.clients.delete(id);
    }
    this.servers = this.servers.filter(s => s.id !== id);
    this.save();
    this.onUpdate([...this.servers]);
  }

  async connect(id: string) {
    const server = this.servers.find(s => s.id === id);
    if (!server) return;

    try {
      this.updateStatus(id, 'connecting');
      
      const transport = new SSEClientTransport(new URL(server.url));
      const client = new Client({
        name: "Precise-Web-Client",
        version: "1.0.0",
      }, {
        capabilities: {
          prompts: {},
          resources: {},
          tools: {},
        }
      });

      await client.connect(transport);
      this.clients.set(id, client);
      this.updateStatus(id, 'connected');
    } catch (error) {
      console.error(`Failed to connect to MCP server ${server.name}:`, error);
      this.updateStatus(id, 'error');
    }
  }

  private updateStatus(id: string, status: MCPServer['status']) {
    this.servers = this.servers.map(s => s.id === id ? { ...s, status } : s);
    this.onUpdate([...this.servers]);
  }

  private save() {
    localStorage.setItem('mcp_servers', JSON.stringify(this.servers.map(({ status, ...s }) => s)));
  }

  getServers() {
    return [...this.servers];
  }
}

export const mcpManager = new MCPManager();
