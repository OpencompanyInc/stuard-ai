/**
 * Local MCP Server (desktop front door)
 *
 * Exposes a loopback MCP endpoint that local coding agents — Claude Code, Codex,
 * Cursor — connect to. It is a thin authenticated reverse proxy to the cloud MCP
 * engine (`/mcp/server` in cloud-ai):
 *
 *   coding agent ──(http 127.0.0.1)──► this server ──(authed https)──► cloud /mcp/server
 *
 * Why a proxy and not a native server:
 *  - The coding agent only ever talks to localhost — no cloud auth, no PAT to
 *    paste. We inject the desktop's own (auto-refreshed) cloud token outbound.
 *  - Device/desktop tools "just work" because the desktop running this server is
 *    the same desktop the cloud relays device tools back to (it's online by def).
 *  - Zero tool logic is duplicated; the cloud engine (search/execute/ask/status)
 *    is reused verbatim, including its INTERNAL_TOOLS gating.
 *
 * Security: bound to 127.0.0.1 only, and a generated local token (in userData)
 * must be presented as `Authorization: Bearer <localToken>`. We swap it for the
 * real cloud token before forwarding, so the local token never reaches the cloud
 * and the cloud token never reaches the coding agent.
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import logger from '../utils/logger';
import { getCloudAiHttpBase } from './social-trigger-client';
import { getValidMainAccessToken } from './auth-session';

const DEFAULT_PORT = Number(process.env.STUARD_MCP_PORT || 8788);
const LOCAL_PATHS = new Set(['/mcp', '/mcp/server']);

let server: http.Server | undefined;
let activePort = 0;
let localToken = '';

interface McpLocalInfo {
  running: boolean;
  url: string;
  token: string;
}

function tokenPath(): string {
  return path.join(app.getPath('userData'), 'mcp-local-token.json');
}

function configSnippetPath(): string {
  return path.join(app.getPath('userData'), 'mcp-config.json');
}

/** Load (or generate + persist) the loopback bearer token coding agents must present. */
function ensureLocalToken(): string {
  if (localToken) return localToken;
  try {
    const raw = fs.readFileSync(tokenPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.token && typeof parsed.token === 'string') {
      localToken = parsed.token;
      return localToken;
    }
  } catch { /* not created yet */ }
  localToken = `slmcp_${crypto.randomBytes(24).toString('hex')}`;
  try {
    fs.writeFileSync(tokenPath(), JSON.stringify({ token: localToken }, null, 2), { encoding: 'utf-8', mode: 0o600 });
  } catch (e: any) {
    logger.warn?.(`[mcp-local] could not persist local token: ${e?.message || e}`);
  }
  return localToken;
}

/** Write a ready-to-paste MCP client config so the user can wire their coding agent. */
function writeConfigSnippet(): void {
  const snippet = {
    mcpServers: {
      stuard: {
        type: 'http',
        url: `http://127.0.0.1:${activePort}/mcp`,
        headers: { Authorization: `Bearer ${localToken}` },
      },
    },
  };
  try {
    fs.writeFileSync(configSnippetPath(), JSON.stringify(snippet, null, 2), { encoding: 'utf-8', mode: 0o600 });
  } catch { /* best-effort */ }
}

const HOP_BY_HOP = new Set(['connection', 'transfer-encoding', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade']);

function unauthorized(res: http.ServerResponse): void {
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Bearer realm="stuard-local-mcp"',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ error: 'unauthorized', hint: 'Set Authorization: Bearer <local token from Stuard settings>' }));
}

async function handleProxy(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Validate the loopback token presented by the coding agent.
  const auth = String(req.headers['authorization'] || '');
  const presented = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!presented || presented !== ensureLocalToken()) {
    unauthorized(res);
    return;
  }

  // Swap in the desktop's (auto-refreshed) cloud token for the upstream call.
  let cloudToken: string | null = null;
  try {
    cloudToken = await getValidMainAccessToken();
  } catch { /* handled below */ }
  if (!cloudToken) {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'not_signed_in', hint: 'Sign in to Stuard to use the MCP server.' }));
    return;
  }

  const target = new URL('/mcp/server', getCloudAiHttpBase());
  const mod = target.protocol === 'https:' ? https : http;

  const fwdHeaders: Record<string, string> = {
    authorization: `Bearer ${cloudToken}`,
    'content-type': String(req.headers['content-type'] || 'application/json'),
    accept: String(req.headers['accept'] || 'application/json, text/event-stream'),
  };
  // Preserve MCP session continuity headers.
  for (const h of ['mcp-session-id', 'mcp-protocol-version', 'last-event-id']) {
    const v = req.headers[h];
    if (typeof v === 'string') fwdHeaders[h] = v;
  }

  const upstream = mod.request(
    target,
    { method: req.method, headers: fwdHeaders },
    (pres) => {
      const respHeaders: Record<string, string | string[]> = { 'Access-Control-Allow-Origin': '*' };
      for (const [k, v] of Object.entries(pres.headers)) {
        if (v === undefined) continue;
        if (HOP_BY_HOP.has(k.toLowerCase())) continue;
        respHeaders[k] = v as string | string[];
      }
      res.writeHead(pres.statusCode || 502, respHeaders);
      pres.pipe(res);
    }
  );

  upstream.on('error', (err: any) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'upstream_error', message: err?.message || String(err) }));
    } else {
      try { res.end(); } catch { /* already closed */ }
    }
  });

  // Stream the client request body up. Only abort upstream on a *premature*
  // client disconnect (response not finished) — destroying on normal completion
  // would reset the upstream socket and surface as a spurious "socket hang up".
  req.pipe(upstream);
  res.on('close', () => {
    if (!res.writableEnded) {
      try { upstream.destroy(); } catch { /* noop */ }
    }
  });
}

function createServerOn(port: number): void {
  const srv = http.createServer((req, res) => {
    try {
      const method = String(req.method || 'GET').toUpperCase();
      const u = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      const pathname = u.pathname.replace(/\/+$/, '') || '/';

      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id',
          'Access-Control-Max-Age': '600',
        });
        res.end();
        return;
      }

      if (!LOCAL_PATHS.has(pathname)) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }

      void handleProxy(req, res).catch((err: any) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'proxy_failed', message: err?.message || String(err) }));
        }
      });
    } catch (err: any) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'server_error', message: err?.message || String(err) }));
      } catch { /* noop */ }
    }
  });

  srv.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE' && port !== 0) {
      logger.warn?.(`[mcp-local] port ${port} in use, falling back to an ephemeral port`);
      createServerOn(0);
      return;
    }
    logger.error?.(`[mcp-local] server error: ${err?.message || err}`);
  });

  srv.listen(port, '127.0.0.1', () => {
    server = srv;
    activePort = (srv.address() as any)?.port || port;
    ensureLocalToken();
    writeConfigSnippet();
    logger.info?.(`[mcp-local] listening on http://127.0.0.1:${activePort}/mcp (config: ${configSnippetPath()})`);
  });
}

export function startMcpLocalServer(): void {
  if (server) return;
  try {
    ensureLocalToken();
    createServerOn(DEFAULT_PORT);
  } catch (err: any) {
    logger.error?.(`[mcp-local] failed to start: ${err?.message || err}`);
  }
}

export function stopMcpLocalServer(): void {
  try { server?.close(); } catch { /* noop */ }
  server = undefined;
  activePort = 0;
}

/** Connection details for Settings UI / IPC so the user can configure their agent. */
export function getMcpLocalServerInfo(): McpLocalInfo {
  return {
    running: !!server,
    url: activePort ? `http://127.0.0.1:${activePort}/mcp` : '',
    token: server ? ensureLocalToken() : '',
  };
}