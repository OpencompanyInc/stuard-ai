/**
 * Serverless Chat HTTP Endpoint
 *
 * POST /v1/serverless/chat
 *
 * Allows direct API access to the serverless agent (cloud-sync mode).
 * Used by the desktop app or API clients when the user opts into cloud-only
 * mode without a running VM.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { requireAuth } from '../auth/http';
import { runServerlessAgent } from './serverless-agent';

function writeJson(res: ServerResponse, status: number, obj: any) {
  try {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  } catch {
    try { res.writeHead(500); res.end('{"ok":false}'); } catch {}
  }
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: any) => {
      try { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); } catch {}
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

export async function handleServerlessChatRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const { pathname } = parsedUrl;
  const method = req.method || '';

  // CORS preflight
  if (method === 'OPTIONS' && pathname.startsWith('/v1/serverless')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return true;
  }

  // POST /v1/serverless/chat — send a message to the serverless agent
  if (method === 'POST' && pathname === '/v1/serverless/chat') {
    const auth = await requireAuth(req, res);
    if (!auth?.success || !auth.userId) return true;

    try {
      const body = await readBody(req);
      const message = String(body.message || '').trim();
      if (!message) {
        writeJson(res, 400, { ok: false, error: 'message is required' });
        return true;
      }

      const result = await runServerlessAgent({
        userId: auth.userId,
        message,
        conversationId: body.conversationId || null,
        model: body.model || 'balanced',
        source: 'api',
        attachments: body.attachments,
        extraContext: body.extraContext,
      });

      writeJson(res, result.ok ? 200 : 500, result);
    } catch (e: any) {
      writeJson(res, 500, { ok: false, error: String(e?.message || 'internal_error') });
    }
    return true;
  }

  return false;
}
