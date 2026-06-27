/**
 * Cloud Files API Routes
 *
 * File browser operations on the user's VM filesystem via VM agent relay.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken } from '../supabase';
import { sendVMCommand } from '../services/vm-command';
import { mintViewSession, lookupViewSession, VIEW_SESSION_TTL_MS } from '../services/view-sessions';

const MIME_BY_EXT: Record<string, string> = {
  // Web
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml',
  // Images
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon',
  // Video
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mkv: 'video/x-matroska', m4v: 'video/x-m4v', ogv: 'video/ogg',
  // Audio
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus',
  // Docs
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  // Fonts
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};

function mimeForExt(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] || 'application/octet-stream';
}

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

async function readBody(req: IncomingMessage, maxBytes = 64 * 1024 * 1024): Promise<any> {
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

  // GET /v1/cloud-engine/files/serve/<sid>/<vm-path...>
  // No Authorization header (iframes can't attach one) — sid in URL is the
  // capability. Resolves <vm-path> against the user's VM and streams bytes
  // with the right Content-Type so HTML can load sibling CSS/JS/images.
  if (method === 'GET' && path.startsWith('/v1/cloud-engine/files/serve/')) {
    const rest = path.slice('/v1/cloud-engine/files/serve/'.length);
    const slash = rest.indexOf('/');
    if (slash === -1) { json(res, 400, { ok: false, error: 'path_required' }); return true; }
    const sid = rest.slice(0, slash);
    let vmPath = rest.slice(slash + 1);
    try { vmPath = decodeURIComponent(vmPath); } catch { /* keep raw */ }
    const sess = lookupViewSession(sid);
    if (!sess) { json(res, 401, { ok: false, error: 'invalid_session' }); return true; }
    const result = await sendVMCommand(sess.userId, 'file_read', { path: vmPath });
    if (!result.ok || !result.result) {
      json(res, 502, { ok: false, error: result.error || 'vm_command_failed' });
      return true;
    }
    const { content, encoding } = result.result as { content: string; encoding?: string };
    const ext = (vmPath.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    const mime = mimeForExt(ext);
    const buf = encoding === 'base64'
      ? Buffer.from(content || '', 'base64')
      : Buffer.from(content || '', 'utf-8');
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': buf.length,
      // Iframe content needs this to resolve relative URLs the same way a
      // real web origin would. The sid scopes auth, so caching per-sid is
      // safe for its short lifetime.
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(buf);
    return true;
  }

  const user = await authenticate(req, res);
  if (!user) return true;

  // POST /v1/cloud-engine/files/view-session
  // Mints a short-lived sid the iframe can use to load files via /serve/.
  if (method === 'POST' && path === '/v1/cloud-engine/files/view-session') {
    const { sid, expiresAt } = mintViewSession(user.userId);
    json(res, 200, { ok: true, sid, expiresAt, ttlMs: VIEW_SESSION_TTL_MS });
    return true;
  }

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
      }, 120_000);
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

  // POST /v1/cloud-engine/files/upload — binary upload (base64-encoded body)
  // Body: { path: string, contentBase64: string }
  // Convenience wrapper around files/write so the UI can stream user-selected
  // files (images, PDFs, archives) into the VM workspace.
  if (method === 'POST' && path === '/v1/cloud-engine/files/upload') {
    try {
      const body = await readBody(req);
      const filePath = typeof body.path === 'string' ? body.path.trim() : '';
      const contentBase64 = typeof body.contentBase64 === 'string' ? body.contentBase64 : '';
      if (!filePath) { json(res, 400, { ok: false, error: 'path_required' }); return true; }
      if (!contentBase64) { json(res, 400, { ok: false, error: 'content_required' }); return true; }
      const result = await sendVMCommand(user.userId, 'file_write', {
        path: filePath,
        content: contentBase64,
        encoding: 'base64',
      }, 180_000);
      if (!result.ok) {
        json(res, 502, { ok: false, error: result.error || 'vm_command_failed' });
        return true;
      }
      const sizeBytes = Math.floor((contentBase64.length * 3) / 4);
      json(res, 200, { ok: true, path: filePath, size: sizeBytes });
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
