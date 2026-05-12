import type { IncomingMessage, ServerResponse } from 'http';
import { authenticateHttpLegacy, sendAuthError } from '../auth/http';
import { AuthErrorCode } from '../auth';
import { getSyncPreferences, updateSyncPreferences, invalidateSyncCache } from '../supabase';

/**
 * GET  /v1/preferences/sync  → read sync preferences
 * PATCH /v1/preferences/sync → update sync preferences (partial JSON body)
 */
export async function handlePreferencesRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  if (parsedUrl.pathname !== '/v1/preferences/sync') return false;

  const authResult = await authenticateHttpLegacy(req, parsedUrl);
  if (!authResult.success || !authResult.userId) {
    sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
    return true;
  }
  const userId = authResult.userId;

  // GET — read
  if (req.method === 'GET') {
    const prefs = await getSyncPreferences(userId);
    const body = JSON.stringify({ ok: true, ...prefs });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
    return true;
  }

  // PATCH — update
  if (req.method === 'PATCH') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    let payload: any;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: 'invalid_json' }));
      return true;
    }
    const ok = await updateSyncPreferences(userId, {
      sync_accounts: typeof payload.sync_accounts === 'boolean' ? payload.sync_accounts : undefined,
      sync_conversations: typeof payload.sync_conversations === 'boolean' ? payload.sync_conversations : undefined,
      sync_memories: typeof payload.sync_memories === 'boolean' ? payload.sync_memories : undefined,
      sync_integrations: typeof payload.sync_integrations === 'boolean' ? payload.sync_integrations : undefined,
      timezone: payload.timezone !== undefined ? (typeof payload.timezone === 'string' ? payload.timezone : null) : undefined,
    });
    // Invalidate the sync cache when sync flags change
    if (ok && (typeof payload.sync_accounts === 'boolean' || typeof payload.sync_integrations === 'boolean')) {
      invalidateSyncCache(userId);
    }
    const body = JSON.stringify({ ok });
    res.writeHead(ok ? 200 : 500, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
    return true;
  }

  // OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    });
    res.end();
    return true;
  }

  return false;
}
