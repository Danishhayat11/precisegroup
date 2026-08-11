import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export interface MCPServer {
  id: string;
  name: string;
  url: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  lastTest?: {
    timestamp: number;
    success: boolean;
    message: string;
  };
}

class MCPManager {
  private clients: Map<string, Client> = new Map();
  private servers: MCPServer[] = [];
  private onUpdate: (servers: MCPServer[]) => void = () => {};

  constructor() {
    const saved = localStorage.getItem('mcp_servers');
    if (saved) {
      try {
        this.servers = JSON.parse(saved).map((s: Record<string, unknown>) => ({ ...s, status: 'disconnected' }));
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
    await this.connect(id);
    // Automatically test connection after initial connection attempt
    if (this.servers.find(s => s.id === id)?.status === 'connected') {
      await this.testConnection(id);
    }
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
        capabilities: {}
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

  async testConnection(id: string, options?: { timeout?: number; retries?: number }): Promise<{ success: boolean; message: string }> {
    const { timeout = 5000, retries = 0 } = options || {};
    let attempts = 0;
    const maxAttempts = retries + 1;

    while (attempts < maxAttempts) {
      const client = this.clients.get(id);
      if (!client) {
        return { success: false, message: "Client not connected" };
      }

      try {
        // Create a promise that rejects after timeout
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Connection test timed out")), timeout);
        });

        // Race the tool listing against the timeout
        await Promise.race([client.listTools(), timeoutPromise]);
        
        const result = { success: true, message: "Successfully verified connection and capabilities." };
        this.updateLastTest(id, result);
        return result;
      } catch (error: unknown) {
        attempts++;
        console.error(`Connection test attempt ${attempts}/${maxAttempts} failed for ${id}:`, error);
        
        if (attempts >= maxAttempts) {
          const result = { success: false, message: error.message || "Failed to communicate with MCP server." };
          this.updateLastTest(id, result);
          return result;
        }
        
        // Wait briefly before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * 500));
      }
    }

    return { success: false, message: "Maximum retry attempts reached." };
  }

  private updateLastTest(id: string, result: { success: boolean; message: string }) {
    this.servers = this.servers.map(s => s.id === id ? { 
      ...s, 
      lastTest: { timestamp: Date.now(), ...result } 
    } : s);
    this.save();
    this.onUpdate([...this.servers]);
  }

  getServers() {
    return [...this.servers];
  }
}

export const mcpManager = new MCPManager();
