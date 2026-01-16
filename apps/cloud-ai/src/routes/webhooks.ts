import type { IncomingMessage, ServerResponse } from 'http';
import { writeLog } from '../utils/logger';

export async function handleWebhooks(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  if (req.method === 'POST' && (parsedUrl.pathname || '').startsWith('/webhooks/incoming')) {
    try {
      const expected = process.env.WEBHOOK_SECRET || '';
      if (expected) {
        const qToken = parsedUrl.searchParams.get('token') || '';
        const hAuth = String(req.headers['authorization'] || '');
        const hToken = hAuth.startsWith('Bearer ') ? hAuth.slice(7) : '';
        const token = qToken || hToken;
        if (token !== expected) {
          const body = JSON.stringify({ ok: false, error: 'forbidden' });
          res.writeHead(403, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Access-Control-Allow-Origin': '*' });
          res.end(body);
          return true;
        }
      }
      const chunks: Buffer[] = [];
      req.on('data', (c) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let bodyObj: any = raw;
        try { bodyObj = JSON.parse(raw); } catch {}
        writeLog('webhook_incoming', { path: parsedUrl.pathname, length: raw.length });
        const resp = JSON.stringify({ ok: true });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(resp),
          'Access-Control-Allow-Origin': '*',
        });
        res.end(resp);
      });
      return true;
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: 'internal_error', message: e?.message || 'failed' }));
      return true;
    }
  }
  return false;
}
