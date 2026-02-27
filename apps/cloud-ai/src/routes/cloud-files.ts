/**
 * Cloud Files API Routes
 * 
 * File browser operations on the user's VM filesystem via VM agent relay.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken } from '../supabase';
import { sendVMCommand } from '../services/vm-command';

function json(res: ServerResponse, status: number, body: any): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage, maxBytes = 5 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

async function authenticate(req: IncomingMessage, res: ServerResponse): Promise<{ userId: string } | null> {
  const auth = String(req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = token ? await verifyToken(token) : null;
  if (!user) { json(res, 401, { ok: false, error: 'unauthorized' }); return null; }
  return user;
}

export async function handleCloudFilesRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = parsedUrl.pathname;
  const method = req.method || '';

  if (!path.startsWith('/v1/cloud-engine/files')) return false;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return true;
  }

  const user = await authenticate(req, res);
  if (!user) return true;

  // GET /v1/cloud-engine/files?path=...
  if (method === 'GET' && path === '/v1/cloud-engine/files') {
    const filePath = parsedUrl.searchParams.get('path') || '.';
    const result = await sendVMCommand(user.userId, 'file_list', { path: filePath });
    if (!result.ok) {
      json(res, 502, { ok: false, error: result.error || 'vm_command_failed' });
      return true;
    }
    json(res, 200, { ok: true, entries: result.result });
    return true;
  }

  // GET /v1/cloud-engine/files/read?path=...
  if (method === 'GET' && path === '/v1/cloud-engine/files/read') {
    const filePath = parsedUrl.searchParams.get('path');
    if (!filePath) { json(res, 400, { ok: false, error: 'path_required' }); return true; }
    const result = await sendVMCommand(user.userId, 'file_read', { path: filePath });
    if (!result.ok) {
      json(res, 502, { ok: false, error: result.error || 'vm_command_failed' });
      return true;
    }
    json(res, 200, { ok: true, ...result.result });
    return true;
  }

  // POST /v1/cloud-engine/files/write
  if (method === 'POST' && path === '/v1/cloud-engine/files/write') {
    try {
      const body = await readBody(req);
      if (!body.path) { json(res, 400, { ok: false, error: 'path_required' }); return true; }
      const result = await sendVMCommand(user.userId, 'file_write', {
        path: body.path,
        content: body.content || '',
        encoding: body.encoding || 'utf-8',
      });
      if (!result.ok) {
        json(res, 502, { ok: false, error: result.error || 'vm_command_failed' });
        return true;
      }
      json(res, 200, { ok: true });
    } catch (e: any) {
      json(res, 400, { ok: false, error: e?.message || 'invalid_request' });
    }
    return true;
  }

  // DELETE /v1/cloud-engine/files?path=...
  if (method === 'DELETE' && path === '/v1/cloud-engine/files') {
    const filePath = parsedUrl.searchParams.get('path');
    if (!filePath) { json(res, 400, { ok: false, error: 'path_required' }); return true; }
    const result = await sendVMCommand(user.userId, 'file_delete', { path: filePath });
    if (!result.ok) {
      json(res, 502, { ok: false, error: result.error || 'vm_command_failed' });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  // POST /v1/cloud-engine/files/rename
  if (method === 'POST' && path === '/v1/cloud-engine/files/rename') {
    try {
      const body = await readBody(req);
      if (!body.oldPath || !body.newPath) { json(res, 400, { ok: false, error: 'oldPath_and_newPath_required' }); return true; }
      const result = await sendVMCommand(user.userId, 'file_rename', { oldPath: body.oldPath, newPath: body.newPath });
      if (!result.ok) {
        json(res, 502, { ok: false, error: result.error || 'vm_command_failed' });
        return true;
      }
      json(res, 200, { ok: true });
    } catch (e: any) {
      json(res, 400, { ok: false, error: e?.message || 'invalid_request' });
    }
    return true;
  }

  // POST /v1/cloud-engine/files/mkdir
  if (method === 'POST' && path === '/v1/cloud-engine/files/mkdir') {
    try {
      const body = await readBody(req);
      if (!body.path) { json(res, 400, { ok: false, error: 'path_required' }); return true; }
      const result = await sendVMCommand(user.userId, 'file_mkdir', { path: body.path });
      if (!result.ok) {
        json(res, 502, { ok: false, error: result.error || 'vm_command_failed' });
        return true;
      }
      json(res, 200, { ok: true });
    } catch (e: any) {
      json(res, 400, { ok: false, error: e?.message || 'invalid_request' });
    }
    return true;
  }

  return false;
}
