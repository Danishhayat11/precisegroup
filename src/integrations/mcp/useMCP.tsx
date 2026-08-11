import { createContext, useContext, useEffect, useState } from 'react';
import { mcpManager, MCPServer } from './client';

interface MCPContextType {
  servers: MCPServer[];
  addServer: (name: string, url: string) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  reconnect: (id: string) => Promise<void>;
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
      addServer: (name, url) => mcpManager.addServer(name, url),
      removeServer: (id) => mcpManager.removeServer(id),
      reconnect: (id) => mcpManager.connect(id)
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
