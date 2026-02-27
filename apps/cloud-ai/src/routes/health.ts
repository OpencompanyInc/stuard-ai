import type { IncomingMessage, ServerResponse } from 'http';
import { ENABLE_ROUTING } from '../utils/config';
import { sendVMCommand } from '../services/vm-command';
import { getConnectionStats } from '../services/vm-bridge';

export function handleHealth(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  const path = req.url?.split('?')[0] || '/';
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

  // Dev-only: test VM command relay (only in non-production)
  if (req.method === 'GET' && path === '/dev/vm-test' && process.env.NODE_ENV !== 'production') {
    const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const userId = parsed.searchParams.get('userId') || 'dev-local-user-00000000';
    const command = parsed.searchParams.get('cmd') || 'ping';
    const stats = getConnectionStats();

    sendVMCommand(userId, command, {}, 10_000)
      .then(result => {
        const body = JSON.stringify({ ok: true, connections: stats, command, userId, vmResult: result });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
      })
      .catch(err => {
        const body = JSON.stringify({ ok: false, connections: stats, error: err?.message || 'failed' });
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
      });
    return true;
  }

  return false;
}
