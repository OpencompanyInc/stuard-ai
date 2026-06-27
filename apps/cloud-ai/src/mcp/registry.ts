/**
 * MCP Integrations Registry
 *
 * Remote OAuth-based MCP servers that work like traditional integrations.
 * Users click Connect, complete OAuth, and tools become available.
 */

import type { MCPIntegration } from './types';

/**
 * Available MCP Integrations
 *
 * All these use remote MCP servers with OAuth authentication.
 * No local setup required - just like Google/GitHub integrations.
 */
export const MCP_INTEGRATIONS: MCPIntegration[] = [
  {
    id: 'notion',
    name: 'Notion',
    description: 'Access and manage Notion pages, databases, and content. Create, read, update pages and search your workspace.',
    icon: 'notion',
    category: 'productivity',
    mcpUrl: 'https://mcp.notion.com/mcp',
    oauth: {
      // Notion MCP handles OAuth internally
      type: 'mcp-native',
    },
    provider: 'notion-mcp',
    available: true,
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Manage Linear issues, projects, and workflows. Create issues, update status, add comments, and track progress.',
    icon: 'linear',
    category: 'development',
    mcpUrl: 'https://mcp.linear.app/mcp',
    oauth: {
      // Linear MCP handles OAuth internally
      type: 'mcp-native',
    },
    provider: 'linear-mcp',
    available: true,
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Access Stripe payments data. View customers, subscriptions, invoices, and payment history.',
    icon: 'stripe',
    category: 'payments',
    mcpUrl: 'https://mcp.stripe.com',
    oauth: {
      // Stripe MCP handles OAuth internally
      type: 'mcp-native',
    },
    provider: 'stripe-mcp',
    available: true,
  },
];

/**
 * Get an MCP integration by ID
 */
export function getMCPIntegration(id: string): MCPIntegration | undefined {
  return MCP_INTEGRATIONS.find(i => i.id === id);
}

/**
 * Get MCP integrations by category
 */
export function getMCPIntegrationsByCategory(category: MCPIntegration['category']): MCPIntegration[] {
  return MCP_INTEGRATIONS.filter(i => i.category === category);
}

/**
 * Get all available MCP integrations
 */
export function getAvailableMCPIntegrations(): MCPIntegration[] {
  return MCP_INTEGRATIONS.filter(i => i.available);
}

/**
 * Search MCP integrations
 */
export function searchMCPIntegrations(query: string): MCPIntegration[] {
  const q = query.toLowerCase();
  return MCP_INTEGRATIONS.filter(i =>
    i.name.toLowerCase().includes(q) ||
    i.description.toLowerCase().includes(q)
  );
}
