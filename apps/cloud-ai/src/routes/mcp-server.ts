/**
 * Stuard MCP Server route — Stuard as an MCP *server* for external clients.
 *
 * Lets coding agents (Claude Code, Codex, Cursor, Claude Desktop) connect to
 * Stuard over the MCP Streamable HTTP transport and drive the same tools the main
 * Stuard agent can run. This is the inverse of routes/mcp.ts (Stuard as an MCP
 * client of Notion/Linear/Stripe).
 *
 *   POST/GET/DELETE  /mcp/server
 *   Authorization: Bearer <Stuard access token>
 *
 * Per-request user context is injected via the bridge AsyncLocalStorage so the
 * MCP tools execute on the same path as a chat turn: cloud/registry tools run
 * inline, device tools relay to the user's connected desktop, and when the
 * desktop is offline device-only tools fail cleanly (see docs/mcp-server.md).
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyAccessToken } from '../auth';
import { getDesktopWs } from '../services/vm-bridge';
import { withClientBridge, runWithSecrets } from '../tools/bridge';
import { getMcpServer } from '../mcp-server/server';

const MCP_SERVER_PATH = '/mcp/server';

/** Isolated so swapping the access token for a long-lived PAT later stays localized. */
async function authenticateMcpRequest(req: IncomingMessage): Promise<{ userId: string; email?: string } | null> {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const result = await verifyAccessToken(token);
  if (!result.success || !result.userId) return null;
  return { userId: result.userId, email: result.email };
}

function sendJson(res: ServerResponse, status: number, data: any): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

export async function handleMcpServerRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL
): Promise<boolean> {
  if (parsedUrl.pathname !== MCP_SERVER_PATH) return false;

  const user = await authenticateMcpRequest(req);
  if (!user) {
    // MCP clients expect 401 with WWW-Authenticate to trigger their auth flow.
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="stuard-mcp"',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
    return true;
  }

  const server = getMcpServer();
  const ws = getDesktopWs(user.userId);

  // Drive the transport inside the user's bridge context so tools see the right
  // identity and (when online) can relay to the desktop.
  //
  // Stateless JSON mode (serverless: true → enableJsonResponse, fresh transport
  // per request): our tools are request/response (+ polling for async jobs), so
  // we don't need server→client SSE push or cross-request session state. JSON
  // responses also survive the desktop→cloud proxy hop cleanly, whereas the
  // default long-lived SSE stream is fragile through two layers.
  //
  // __subagentKind marks this as a non-interactive editing context so the
  // workflow tools (modify_workflow / edit_workflow) auto-persist their changes
  // to disk — there is no canvas "Save" button on the MCP path, so without it
  // the client's edits would apply in memory and then vanish. It has no other
  // effect (bridge subagent metadata is keyed off __subagentId, which we omit).
  const secrets = { userId: user.userId, __subagentKind: 'mcp' };
  const run = () =>
    server.startHTTP({ url: parsedUrl, httpPath: MCP_SERVER_PATH, req, res, options: { serverless: true } });

  try {
    if (ws) {
      await withClientBridge(ws, run, secrets);
    } else {
      await runWithSecrets(secrets, run);
    }
  } catch (err: any) {
    if (!res.headersSent) {
      sendJson(res, 500, { success: false, error: err?.message || 'MCP server error' });
    } else {
      try { res.end(); } catch { /* already closed */ }
    }
  }
  return true;
}