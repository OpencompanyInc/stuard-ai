/**
 * File Index Routes
 *
 * Provides API endpoints for semantic file indexing operations.
 * Uses Gemini Embedding 2 for direct chunk + embed (no LLM summarization needed).
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { requireAuth, sendJson } from '../auth/http';
import { processPendingFiles } from '../services/file-indexing';

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

export async function handleFileIndexRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL
): Promise<boolean> {
  const { pathname } = parsedUrl;

  // POST /v1/file-index/batch - Process pending files (kept for backwards compat)
  if (pathname === '/v1/file-index/batch' && req.method === 'POST') {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return true;

      const body = await readBody(req);
      const limit = typeof body.limit === 'number' ? body.limit : 500;

      const progress = await processPendingFiles(limit);
      sendJson(res, 200, { ok: true, count: progress.successful, progress });
    } catch (e: any) {
      console.error('[file-index] Batch process error:', e);
      sendJson(res, 500, { ok: false, error: e?.message || 'Internal error' });
    }
    return true;
  }

  // POST /v1/file-index/batch/sync - No-op (batch jobs no longer needed)
  if (pathname === '/v1/file-index/batch/sync' && req.method === 'POST') {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return true;

      sendJson(res, 200, { ok: true, updated: 0, active: 0 });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: e?.message || 'Internal error' });
    }
    return true;
  }

  // POST /v1/file-index/process - Process pending files immediately
  if (pathname === '/v1/file-index/process' && req.method === 'POST') {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return true;

      const body = await readBody(req);
      const limit = typeof body.limit === 'number' ? body.limit : 50;

      const progress = await processPendingFiles(limit);
      sendJson(res, 200, { ok: true, progress });
    } catch (e: any) {
      console.error('[file-index] Process error:', e);
      sendJson(res, 500, { ok: false, error: e?.message || 'Internal error' });
    }
    return true;
  }

  return false;
}
