/**
 * Cloud Snapshots API Routes
 * 
 * Create, list, restore, and delete VM snapshots.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, getSnapshots, getSnapshot } from '../supabase';
import { createUserSnapshot, restoreUserSnapshot, deleteUserSnapshot } from '../services/snapshot-manager';

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

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { resolve({}); }
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

export async function handleCloudSnapshotsRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = parsedUrl.pathname;
  const method = req.method || '';

  if (!path.startsWith('/v1/cloud-engine/snapshots')) return false;

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

  // POST /v1/cloud-engine/snapshots — Create snapshot
  if (method === 'POST' && path === '/v1/cloud-engine/snapshots') {
    try {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) { json(res, 400, { ok: false, error: 'name_required' }); return true; }
      const snapshot = await createUserSnapshot(user.userId, name, body.description);
      if (!snapshot) { json(res, 500, { ok: false, error: 'snapshot_creation_failed' }); return true; }
      json(res, 201, { ok: true, snapshot });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'snapshot_error' });
    }
    return true;
  }

  // GET /v1/cloud-engine/snapshots — List snapshots
  if (method === 'GET' && path === '/v1/cloud-engine/snapshots') {
    const snapshots = await getSnapshots(user.userId);
    json(res, 200, { ok: true, snapshots });
    return true;
  }

  // Extract snapshot ID from path: /v1/cloud-engine/snapshots/:id
  const idMatch = path.match(/^\/v1\/cloud-engine\/snapshots\/([a-f0-9-]+?)(?:\/|$)/);
  if (!idMatch) return false;
  const snapshotId = idMatch[1];

  // GET /v1/cloud-engine/snapshots/:id
  if (method === 'GET' && path === `/v1/cloud-engine/snapshots/${snapshotId}`) {
    const snapshot = await getSnapshot(user.userId, snapshotId);
    if (!snapshot) { json(res, 404, { ok: false, error: 'snapshot_not_found' }); return true; }
    json(res, 200, { ok: true, snapshot });
    return true;
  }

  // POST /v1/cloud-engine/snapshots/:id/restore
  if (method === 'POST' && path === `/v1/cloud-engine/snapshots/${snapshotId}/restore`) {
    const result = await restoreUserSnapshot(user.userId, snapshotId);
    if (!result.success) {
      json(res, 500, { ok: false, error: result.error || 'restore_failed' });
      return true;
    }
    json(res, 200, { ok: true, message: 'Snapshot restored' });
    return true;
  }

  // DELETE /v1/cloud-engine/snapshots/:id
  if (method === 'DELETE' && path === `/v1/cloud-engine/snapshots/${snapshotId}`) {
    const result = await deleteUserSnapshot(user.userId, snapshotId);
    if (!result.success) {
      json(res, 500, { ok: false, error: result.error || 'delete_failed' });
      return true;
    }
    json(res, 200, { ok: true, message: 'Snapshot deleted' });
    return true;
  }

  return false;
}
