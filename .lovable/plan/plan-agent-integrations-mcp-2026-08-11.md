# Plan - Agent Integrations (MCP)

This plan adds support for Model Context Protocol (MCP) integrations to the application. This allows users to connect external agent capabilities (like specialized AI assistants or data connectors) to their workflow.

## User Review Required

> [!IMPORTANT]
> This feature introduces external agent connectivity. By default, no external servers are connected. The user must explicitly provide MCP server URLs in the Settings page.

## Proposed Changes

### Integration Layer
- Create `src/integrations/mcp/client.ts` to manage connections to MCP servers.
- Implement a hook `useMCP` to provide MCP capabilities throughout the app.

### Settings & Management
- Add a new "Agent Integrations (MCP)" section to `src/pages/Settings.tsx`.
- Allow users to add/remove MCP server endpoints.
- Provide a status indicator for active connections.

### UI Components
- Add an `MCPServerConfig` component for managing individual server settings.
- Add an `MCPSearch` or `AgentToolbar` if requested for active interaction (currently focusing on the integration layer).

## Technical Details

- **Protocol**: Implementation of the Model Context Protocol over SSE (Server-Sent Events) or WebSockets, depending on the server type.
- **State Management**: Persist MCP server URLs in the user's settings (database/local storage) and manage active connection instances in a React Context.
- **Security**: MCP server URLs are stored securely and connections are established client-side.

## ASCII Diagram

```text
[ React App ] <--> [ useMCP Hook ] <--> [ MCP Client ]
                                           |
                                           +-- [ Server A (SSE) ]
                                           +-- [ Server B (WebSocket) ]
```
