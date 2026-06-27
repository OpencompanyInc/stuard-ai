/**
 * MCP Integration Routes
 *
 * Routes for remote OAuth-based MCP integrations (Notion, Linear, Stripe).
 * These work like traditional integrations - click Connect, OAuth, done!
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyAccessToken } from '../auth';
import {
  MCP_INTEGRATIONS,
  getMCPIntegration,
  getMCPIntegrationsByCategory,
  searchMCPIntegrations,
  getConnectedMCPIntegrations,
  getMCPConnectionStatus,
  getMCPToolsForIntegration,
  disconnectMCPClient,
} from '../mcp';

function sendJson(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

async function getAuthUser(req: IncomingMessage): Promise<{ userId: string; email?: string } | null> {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const result = await verifyAccessToken(token);
  if (!result.success || !result.userId) return null;
  return { userId: result.userId, email: result.email };
}

export async function handleMCPRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL
): Promise<boolean> {
  const pathname = parsedUrl.pathname;
  const method = req.method || 'GET';

  // =====================
  // PUBLIC: Registry endpoints (no auth required)
  // =====================

  // GET /mcp/integrations - List all available MCP integrations
  if (pathname === '/mcp/integrations' && method === 'GET') {
    sendJson(res, 200, {
      success: true,
      integrations: MCP_INTEGRATIONS,
    });
    return true;
  }

  // GET /mcp/integrations/:id - Get specific MCP integration info
  if (pathname.startsWith('/mcp/integrations/') && method === 'GET') {
    const id = pathname.slice('/mcp/integrations/'.length);
    const integration = getMCPIntegration(id);
    if (!integration) {
      sendJson(res, 404, { success: false, error: 'Integration not found' });
      return true;
    }
    sendJson(res, 200, { success: true, integration });
    return true;
  }

  // GET /mcp/integrations/category/:category - List by category
  if (pathname.startsWith('/mcp/category/') && method === 'GET') {
    const category = pathname.slice('/mcp/category/'.length) as any;
    const integrations = getMCPIntegrationsByCategory(category);
    sendJson(res, 200, { success: true, integrations });
    return true;
  }

  // GET /mcp/search?q=query - Search integrations
  if (pathname === '/mcp/search' && method === 'GET') {
    const query = parsedUrl.searchParams.get('q') || '';
    const integrations = searchMCPIntegrations(query);
    sendJson(res, 200, { success: true, integrations });
    return true;
  }

  // =====================
  // PROTECTED: User connection endpoints (auth required)
  // =====================

  // Check auth for all /mcp/connections/* routes
  if (pathname.startsWith('/mcp/connections') || pathname.startsWith('/mcp/tools')) {
    const user = await getAuthUser(req);
    if (!user) {
      sendJson(res, 401, { success: false, error: 'Unauthorized' });
      return true;
    }

    // GET /mcp/connections - Get user's connected MCP integrations
    if (pathname === '/mcp/connections' && method === 'GET') {
      const connections = await getConnectedMCPIntegrations(user.userId);
      sendJson(res, 200, {
        success: true,
        connections,
      });
      return true;
    }

    // GET /mcp/connections/:id/status - Get connection status for specific integration
    if (pathname.match(/^\/mcp\/connections\/[^/]+\/status$/) && method === 'GET') {
      const id = pathname.split('/')[3];
      const status = await getMCPConnectionStatus(user.userId, id);
      sendJson(res, 200, { success: true, status });
      return true;
    }

    // GET /mcp/tools/:id - Get tools from a connected MCP integration
    if (pathname.startsWith('/mcp/tools/') && method === 'GET') {
      const id = pathname.slice('/mcp/tools/'.length);
      const tools = await getMCPToolsForIntegration(user.userId, id);
      sendJson(res, 200, {
        success: true,
        tools: tools || [],
      });
      return true;
    }

    // POST /mcp/disconnect/:id - Disconnect from an MCP integration
    if (pathname.startsWith('/mcp/disconnect/') && method === 'POST') {
      const id = pathname.slice('/mcp/disconnect/'.length);
      await disconnectMCPClient(user.userId, id);
      sendJson(res, 200, { success: true });
      return true;
    }
  }

  return false;
}
