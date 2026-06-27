/**
 * MCP Integration Module
 *
 * Remote OAuth-based MCP servers (Notion, Linear, Stripe).
 * Works like traditional integrations - click Connect, OAuth, done!
 */

// Types
export type {
  MCPIntegration,
  MCPConnectionStatus,
  ToolSearchResult,
} from './types';

// Registry of MCP integrations
export {
  MCP_INTEGRATIONS,
  getMCPIntegration,
  getMCPIntegrationsByCategory,
  getAvailableMCPIntegrations,
  searchMCPIntegrations,
} from './registry';

// Client management
export {
  getMCPClientForIntegration,
  getMCPToolsForIntegration,
  getMCPToolsForIntegrations,
  disconnectMCPClient,
  disconnectAllMCPClients,
  getMCPClientStatus,
} from './client';

// Storage (uses external_accounts table)
export {
  getMCPConnectionStatus,
  getConnectedMCPIntegrations,
  saveMCPConnection,
  removeMCPConnection,
} from './storage';
