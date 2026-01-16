/**
 * MCP Server Types
 *
 * We only support remote OAuth-based MCP servers for the best UX.
 * These work like traditional integrations - click Connect, OAuth flow, done!
 */

/**
 * Remote MCP Integration - OAuth-based MCPs like Notion, Linear, Stripe
 */
export interface MCPIntegration {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'productivity' | 'development' | 'payments' | 'communication';

  // MCP endpoint (SSE or Streamable HTTP)
  mcpUrl: string;

  // OAuth configuration
  oauth: {
    // Some MCPs handle OAuth internally via their MCP endpoint
    // Others need traditional OAuth flow
    type: 'mcp-native' | 'oauth2';

    // For oauth2 type - traditional OAuth endpoints
    authorizationUrl?: string;
    tokenUrl?: string;
    clientId?: string;
    scopes?: string[];
  };

  // Provider for external_accounts table
  provider: string;

  // Whether this integration is available
  available: boolean;
}

/**
 * User's connected MCP status (stored in external_accounts)
 */
export interface MCPConnectionStatus {
  connected: boolean;
  provider: string;
  scopes?: string[];
  connectedAt?: string;
}

/**
 * Tool search result from embedding similarity
 */
export interface ToolSearchResult {
  name: string;
  description: string;
  category: string;
  similarity: number;
}
