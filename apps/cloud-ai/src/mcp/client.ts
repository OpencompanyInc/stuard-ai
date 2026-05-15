/**
 * MCP Client for Remote OAuth-based MCPs
 *
 * Manages connections to remote MCP servers like Notion, Linear, Stripe.
 * These servers handle OAuth internally - we just connect and use tools.
 */

import { MCPClient } from '@mastra/mcp';
import { getMCPIntegration } from './registry';

// Cache of active MCP clients
// Key: `${userId}:${integrationId}`
const clientCache = new Map<string, {
  client: MCPClient;
  createdAt: number;
}>();

// Client TTL - 30 minutes
const CLIENT_TTL_MS = 30 * 60 * 1000;

/**
 * Get or create an MCP client for a specific integration
 */
export async function getMCPClientForIntegration(
  userId: string,
  integrationId: string,
  accessToken?: string
): Promise<MCPClient | null> {
  const integration = getMCPIntegration(integrationId);
  if (!integration || !integration.available) {
    return null;
  }

  const cacheKey = `${userId}:${integrationId}`;
  const now = Date.now();

  // Check cache
  const cached = clientCache.get(cacheKey);
  if (cached && (now - cached.createdAt) < CLIENT_TTL_MS) {
    return cached.client;
  }

  // Disconnect old client if exists
  if (cached) {
    try {
      await cached.client.disconnect();
    } catch {
      // Ignore
    }
    clientCache.delete(cacheKey);
  }

  // Create new client
  try {
    const serverConfig: any = {
      url: new URL(integration.mcpUrl),
    };

    // Add auth header if we have a token
    if (accessToken) {
      serverConfig.requestInit = {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      };
    }

    const client = new MCPClient({
      id: `stuard-${integrationId}-${userId}`,
      servers: {
        [integrationId]: serverConfig,
      },
    });

    clientCache.set(cacheKey, {
      client,
      createdAt: now,
    });

    return client;
  } catch (error) {
    console.error(`[MCP] Failed to create client for ${integrationId}:`, error);
    return null;
  }
}

/**
 * Get tools from a specific MCP integration
 */
export async function getMCPToolsForIntegration(
  userId: string,
  integrationId: string,
  accessToken?: string
): Promise<Record<string, any>> {
  const client = await getMCPClientForIntegration(userId, integrationId, accessToken);
  if (!client) {
    return {};
  }

  try {
    return await client.listTools();
  } catch (error) {
    console.error(`[MCP] Failed to get tools for ${integrationId}:`, error);
    return {};
  }
}

/**
 * Get tools from multiple MCP integrations
 */
export async function getMCPToolsForIntegrations(
  userId: string,
  integrations: Array<{ id: string; accessToken?: string }>
): Promise<Record<string, any>> {
  const allTools: Record<string, any> = {};

  await Promise.all(
    integrations.map(async ({ id, accessToken }) => {
      const tools = await getMCPToolsForIntegration(userId, id, accessToken);
      Object.assign(allTools, tools);
    })
  );

  return allTools;
}

/**
 * Disconnect an MCP client for a specific integration
 */
export async function disconnectMCPClient(
  userId: string,
  integrationId?: string
): Promise<void> {
  if (integrationId) {
    const cacheKey = `${userId}:${integrationId}`;
    const cached = clientCache.get(cacheKey);
    if (cached) {
      try {
        await cached.client.disconnect();
      } catch {
        // Ignore
      }
      clientCache.delete(cacheKey);
    }
  } else {
    // Disconnect all for user
    const keysToDelete: string[] = [];
    for (const [key, cached] of clientCache.entries()) {
      if (key.startsWith(`${userId}:`)) {
        try {
          await cached.client.disconnect();
        } catch {
          // Ignore
        }
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      clientCache.delete(key);
    }
  }
}

/**
 * Disconnect all MCP clients (for shutdown)
 */
export async function disconnectAllMCPClients(): Promise<void> {
  for (const [, cached] of clientCache.entries()) {
    try {
      await cached.client.disconnect();
    } catch {
      // Ignore
    }
  }
  clientCache.clear();
}

/**
 * Get MCP client status for a user
 */
export function getMCPClientStatus(userId: string): {
  connected: boolean;
  integrations: string[];
} {
  const integrations: string[] = [];

  for (const key of clientCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      const integrationId = key.split(':')[1];
      integrations.push(integrationId);
    }
  }

  return {
    connected: integrations.length > 0,
    integrations,
  };
}
