/**
 * Hot Storage Routes
 *
 * API for users to view storage plans, purchase/upgrade storage,
 * check usage and quotas, and trigger manual syncs.
 *
 * Prefix: /v1/storage
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken } from '../supabase';
import {
  listStoragePlans,
  getStoragePlan,
  getUserStorageInfo,
  purchaseStoragePlan,
  checkColdStorageQuota,
} from '../services/hot-storage';
import { syncToCloud, restoreFromCloud, getSyncStatus } from '../services/sync-engine';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

async function readBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<any> {
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

async function authenticate(req: IncomingMessage, res: ServerResponse): Promise<{ userId: string; email?: string } | null> {
  const auth = String(req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = token ? await verifyToken(token) : null;
  if (!user) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return null;
  }
  return user;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleStorageRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = parsedUrl.pathname;
  const method = req.method || '';

  if (!path.startsWith('/v1/storage')) return false;

  // ── CORS preflight ───────────────────────────────────────────────────────
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return true;
  }

  // ── GET /v1/storage/plans ────────────────────────────────────────────────
  // Public: list available storage plans
  if (method === 'GET' && path === '/v1/storage/plans') {
    const plans = listStoragePlans();
    json(res, 200, { ok: true, plans });
    return true;
  }

  // ── GET /v1/storage/info ─────────────────────────────────────────────────
  // Authenticated: get user's current storage plan, usage, quotas
  if (method === 'GET' && path === '/v1/storage/info') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const info = await getUserStorageInfo(user.userId);
      json(res, 200, { ok: true, ...info });
    } catch (e: any) {
      console.error('[storage] info error:', e?.message);
      json(res, 500, { ok: false, error: 'info_failed' });
    }
    return true;
  }

  // ── GET /v1/storage/quota ────────────────────────────────────────────────
  // Authenticated: check cold storage quota
  if (method === 'GET' && path === '/v1/storage/quota') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const quota = await checkColdStorageQuota(user.userId);
      json(res, 200, { ok: true, ...quota });
    } catch (e: any) {
      json(res, 500, { ok: false, error: 'quota_check_failed' });
    }
    return true;
  }

  // ── POST /v1/storage/purchase ────────────────────────────────────────────
  // Authenticated: purchase or upgrade storage plan
  if (method === 'POST' && path === '/v1/storage/purchase') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const body = await readBody(req);
      const planId = String(body.planId || '').trim();
      if (!planId) {
        json(res, 400, { ok: false, error: 'missing_plan_id' });
        return true;
      }
      if (!getStoragePlan(planId)) {
        json(res, 400, { ok: false, error: 'invalid_plan_id', availablePlans: listStoragePlans().map(p => p.id) });
        return true;
      }

      const result = await purchaseStoragePlan(user.userId, planId);
      json(res, result.ok ? 200 : 400, result);
    } catch (e: any) {
      console.error('[storage] purchase error:', e?.message);
      json(res, 500, { ok: false, error: 'purchase_failed' });
    }
    return true;
  }

  // ── GET /v1/storage/sync-status ──────────────────────────────────────────
  // Authenticated: check sync status between VM hot disk and GCS
  if (method === 'GET' && path === '/v1/storage/sync-status') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const status = await getSyncStatus(user.userId);
      json(res, 200, { ok: true, ...status });
    } catch (e: any) {
      json(res, 500, { ok: false, error: 'sync_status_failed' });
    }
    return true;
  }

  // ── POST /v1/storage/sync ───────────────────────────────────────────────
  // Authenticated: trigger manual sync (VM hot disk → GCS cold storage)
  if (method === 'POST' && path === '/v1/storage/sync') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const body = await readBody(req);
      const direction = String(body.direction || 'upload').trim();

      if (direction === 'upload') {
        const result = await syncToCloud(user.userId);
        json(res, result.success ? 200 : 500, { ok: result.success, ...result });
      } else if (direction === 'download') {
        const result = await restoreFromCloud(user.userId);
        json(res, result.success ? 200 : 500, { ok: result.success, ...result });
      } else {
        json(res, 400, { ok: false, error: 'invalid_direction', valid: ['upload', 'download'] });
      }
    } catch (e: any) {
      console.error('[storage] sync error:', e?.message);
      json(res, 500, { ok: false, error: 'sync_failed' });
    }
    return true;
  }

  // ── GET /v1/storage/agent-data-url ────────────────────────────────────
  // Authenticated: get signed upload + download URLs for agent data (knowledge.db, memory.db).
  // Used by desktop to push/pull agent databases directly to/from GCS.
  if (method === 'GET' && path === '/v1/storage/agent-data-url') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const {
        generateAgentDataUploadUrl,
        generateAgentDataDownloadUrl,
        generateAgentDataDeltaUploadUrl,
        generateAgentDataDeltaDownloadUrl,
      } = await import('../services/cold-storage');
      const [uploadResult, downloadResult, deltaUploadResult, deltaDownloadResult] = await Promise.all([
        generateAgentDataUploadUrl(user.userId),
        generateAgentDataDownloadUrl(user.userId),
        generateAgentDataDeltaUploadUrl(user.userId),
        generateAgentDataDeltaDownloadUrl(user.userId),
      ]);
      json(res, 200, {
        ok: true,
        uploadUrl: uploadResult.uploadUrl,
        downloadUrl: downloadResult?.downloadUrl || null,
        deltaUploadUrl: deltaUploadResult.uploadUrl,
        deltaDownloadUrl: deltaDownloadResult?.downloadUrl || null,
        objectName: uploadResult.objectName,
        deltaObjectName: deltaUploadResult.objectName,
      });
    } catch (e: any) {
      console.error('[storage] agent-data-url error:', e?.message);
      json(res, 500, { ok: false, error: 'agent_data_url_failed' });
    }
    return true;
  }

  return false;
}
