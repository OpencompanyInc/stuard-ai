import type { IncomingMessage, ServerResponse } from 'http';
import { ENABLE_ROUTING } from '../utils/config';

export function handleHealth(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  const path = req.url || '/';
  if (req.method === 'GET' && (path === '/' || path === '/health')) {
    const body = JSON.stringify({ service: 'cloud-ai', ok: true, routing: ENABLE_ROUTING });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
    return true;
  }
  return false;
}
