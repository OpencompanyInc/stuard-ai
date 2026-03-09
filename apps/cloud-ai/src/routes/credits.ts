import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, getCreditSummary } from '../supabase';
import { creditsPerUsd } from '../pricing';

export async function handleCredits(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  if (req.method === 'GET' && parsedUrl.pathname === '/v1/credits') {
    try {
      const auth = String(req.headers['authorization'] || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const authUser = token ? await verifyToken(token) : null;
      if (!authUser) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
        return true;
      }
      const summary = await getCreditSummary(authUser.userId);
      const body = JSON.stringify({ ok: true, ...summary, creditsPerUsd: creditsPerUsd() });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
      return true;
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: 'internal_error', message: e?.message || 'failed' }));
      return true;
    }
  }
  return false;
}
