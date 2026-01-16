/**
 * File Index Routes
 *
 * Provides API endpoints for semantic file indexing operations.
 * The actual indexing is done by the Gemini Batch API for cost efficiency.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { requireAuth, sendJson } from '../auth/http';
import { startBatchIndexing, syncBatchJobs, processPendingFiles } from '../services/file-indexing';

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

  // POST /v1/file-index/batch - Start Gemini batch indexing job
  if (pathname === '/v1/file-index/batch' && req.method === 'POST') {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return true; // Response already sent

      const body = await readBody(req);
      const limit = typeof body.limit === 'number' ? body.limit : 500;

      const result = await startBatchIndexing(limit);
      sendJson(res, 200, result);
    } catch (e: any) {
      console.error('[file-index] Batch start error:', e);
      sendJson(res, 500, { ok: false, error: e?.message || 'Internal error' });
    }
    return true;
  }

  // POST /v1/file-index/batch/sync - Sync/poll batch job status
  if (pathname === '/v1/file-index/batch/sync' && req.method === 'POST') {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return true; // Response already sent

      const result = await syncBatchJobs();
      sendJson(res, 200, { ok: true, ...result });
    } catch (e: any) {
      console.error('[file-index] Batch sync error:', e);
      sendJson(res, 500, { ok: false, error: e?.message || 'Internal error' });
    }
    return true;
  }

  // POST /v1/file-index/process - Process pending files immediately (non-batch)
  if (pathname === '/v1/file-index/process' && req.method === 'POST') {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return true; // Response already sent

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
