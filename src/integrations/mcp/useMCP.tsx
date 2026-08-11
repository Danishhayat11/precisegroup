import { createContext, useContext, useEffect, useState } from 'react';
import { mcpManager, MCPServer } from './client';

interface MCPContextType {
  servers: MCPServer[];
  addServer: (name: string, url: string, settings?: MCPServer['settings']) => Promise<void>;
  updateSettings: (id: string, settings: MCPServer['settings']) => void;
  removeServer: (id: string) => Promise<void>;
  reconnect: (id: string) => Promise<void>;
  testConnection: (id: string, options?: { timeout?: number; retries?: number }) => Promise<{ success: boolean; message: string; diagnostics?: { timingMs: number; lastTool?: string } }>;
}

const MCPContext = createContext<MCPContextType | undefined>(undefined);

export function MCPProvider({ children }: { children: React.ReactNode }) {
  const [servers, setServers] = useState<MCPServer[]>([]);

  useEffect(() => {
    mcpManager.setUpdateCallback(setServers);
  }, []);

  return (
    <MCPContext.Provider value={{
      servers,
      addServer: (name, url, settings) => mcpManager.addServer(name, url, settings),
      updateSettings: (id, settings) => mcpManager.updateSettings(id, settings),
      removeServer: (id) => mcpManager.removeServer(id),
      reconnect: (id) => mcpManager.connect(id),
      testConnection: (id, options) => mcpManager.testConnection(id, options)
    }}>
      {children}
    </MCPContext.Provider>
  );
}

export function useMCP() {
  const context = useContext(MCPContext);
  if (context === undefined) {
    throw new Error('useMCP must be used within an MCPProvider');
  }
  return context;
}
