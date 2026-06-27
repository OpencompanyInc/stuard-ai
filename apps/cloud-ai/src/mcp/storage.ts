/**
 * MCP Integration Status
 *
 * Uses the existing external_accounts table to track MCP connections.
 * MCP integrations work like other integrations (Google, GitHub, etc.)
 */

import { getSupabaseService, getExternalAccount, upsertExternalAccount } from '../supabase';
import { MCP_INTEGRATIONS } from './registry';
import type { MCPConnectionStatus } from './types';

/**
 * Check if a user has connected an MCP integration
 */
export async function getMCPConnectionStatus(
  userId: string,
  integrationId: string
): Promise<MCPConnectionStatus> {
  const integration = MCP_INTEGRATIONS.find(i => i.id === integrationId);
  if (!integration) {
    return { connected: false, provider: integrationId };
  }

  try {
    const account = await getExternalAccount(userId, integration.provider);
    if (account?.access_token) {
      return {
        connected: true,
        provider: integration.provider,
      };
    }
  } catch {
    // Ignore
  }

  return { connected: false, provider: integration.provider };
}

/**
 * Get all connected MCP integrations for a user
 */
export async function getConnectedMCPIntegrations(
  userId: string
): Promise<Array<{ id: string; provider: string; accessToken?: string }>> {
  const connected: Array<{ id: string; provider: string; accessToken?: string }> = [];

  for (const integration of MCP_INTEGRATIONS) {
    if (!integration.available) continue;

    try {
      const account = await getExternalAccount(userId, integration.provider);
      if (account?.access_token) {
        connected.push({
          id: integration.id,
          provider: integration.provider,
          accessToken: account.access_token,
        });
      }
    } catch {
      // Ignore
    }
  }

  return connected;
}

/**
 * Save MCP connection (after OAuth callback)
 */
export async function saveMCPConnection(
  userId: string,
  integrationId: string,
  credentials: {
    access_token: string;
    refresh_token?: string;
    expires_at?: string;
    scopes?: string[];
  }
): Promise<boolean> {
  const integration = MCP_INTEGRATIONS.find(i => i.id === integrationId);
  if (!integration) return false;

  try {
    await upsertExternalAccount({
      userId,
      provider: integration.provider,
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
      expires_at: credentials.expires_at,
      scopes: credentials.scopes,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove MCP connection
 */
export async function removeMCPConnection(
  userId: string,
  integrationId: string
): Promise<boolean> {
  const supabase = getSupabaseService();
  if (!supabase) return false;

  const integration = MCP_INTEGRATIONS.find(i => i.id === integrationId);
  if (!integration) return false;

  try {
    const { error } = await supabase
      .from('external_accounts')
      .delete()
      .eq('user_id', userId)
      .eq('provider', integration.provider);

    return !error;
  } catch {
    return false;
  }
}
