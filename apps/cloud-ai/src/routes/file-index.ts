/**
 * File Index Routes
 *
 * Provides API endpoints for semantic file indexing operations.
 * Uses Gemini Embedding 2 for direct chunk + embed (no LLM summarization needed).
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { requireAuth, sendJson, getUserId } from '../auth/http';
import { processPendingFiles } from '../services/file-indexing';
import * as embedBatch from '../services/file-embed-batch';
import { embedSync, planEmbedding } from '../services/file-embed-sync';

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

  // ── Semantic embedding (Gemini Batch API) ──────────────────────────────────

  // POST /v1/file-index/embed/estimate { tokens } -> credit estimate + balance
  if (pathname === '/v1/file-index/embed/estimate' && req.method === 'POST') {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return true;
      const body = await readBody(req);
      const tokens = Number(body.tokens) || 0;
      sendJson(res, 200, { ok: true, ...(await embedBatch.estimateEmbedding(getUserId(auth), tokens)) });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: e?.message || 'Internal error' });
    }
    return true;
  }

  // POST /v1/file-index/embed/plan { rootId, creditCap, files:[{id, chunks:[{approxTokens}]}] }
  // Metadata-only cap selection — returns which files fit the credit cap.
  if (pathname === '/v1/file-index/embed/plan' && req.method === 'POST') {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return true;
      const body = await readBody(req);
      const result = await planEmbedding(getUserId(auth), body);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (e: any) {
      console.error('[file-index] Embed plan error:', e);
      sendJson(res, 500, { ok: false, error: e?.message || 'Internal error' });
    }
    return true;
  }

  // POST /v1/file-index/embed/sync { files:[...] }  (one byte-bounded batch)
  // Synchronous: embeds the provided files now and returns vectors directly.
  if (pathname === '/v1/file-index/embed/sync' && req.method === 'POST') {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return true;
      const body = await readBody(req);
      const result = await embedSync(getUserId(auth), body);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (e: any) {
      console.error('[file-index] Embed sync error:', e);
      sendJson(res, 500, { ok: false, error: e?.message || 'Internal error' });
    }
    return true;
  }

  // POST /v1/file-index/embed/start { rootId, rootPath, creditCap, files[] }
  if (pathname === '/v1/file-index/embed/start' && req.method === 'POST') {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return true;
      const body = await readBody(req);
      const result = await embedBatch.submitEmbeddingBatch(getUserId(auth), body);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (e: any) {
      console.error('[file-index] Embed start error:', e);
      sendJson(res, 500, { ok: false, error: e?.message || 'Internal error' });
    }
    return true;
  }

  // GET /v1/file-index/embed/status?jobId=...
  if (pathname === '/v1/file-index/embed/status' && req.method === 'GET') {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return true;
      const jobId = parsedUrl.searchParams.get('jobId') || '';
      if (!jobId) {
        sendJson(res, 400, { ok: false, error: 'missing_jobId' });
        return true;
      }
      sendJson(res, 200, await embedBatch.getEmbeddingJobStatus(getUserId(auth), jobId));
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: e?.message || 'Internal error' });
    }
    return true;
  }

  // GET /v1/file-index/embed/results?jobId=...  (downloads vectors, bills once)
  if (pathname === '/v1/file-index/embed/results' && req.method === 'GET') {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return true;
      const jobId = parsedUrl.searchParams.get('jobId') || '';
      if (!jobId) {
        sendJson(res, 400, { ok: false, error: 'missing_jobId' });
        return true;
      }
      const result = await embedBatch.getEmbeddingJobResults(getUserId(auth), jobId);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: e?.message || 'Internal error' });
    }
    return true;
  }

  // POST /v1/file-index/embed/complete { jobId, embeddedFiles, failedFiles }
  if (pathname === '/v1/file-index/embed/complete' && req.method === 'POST') {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return true;
      const body = await readBody(req);
      const jobId = String(body.jobId || '');
      if (!jobId) {
        sendJson(res, 400, { ok: false, error: 'missing_jobId' });
        return true;
      }
      sendJson(
        res,
        200,
        await embedBatch.completeEmbeddingJob(
          getUserId(auth),
          jobId,
          Number(body.embeddedFiles) || 0,
          Number(body.failedFiles) || 0,
        ),
      );
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: e?.message || 'Internal error' });
    }
    return true;
  }

  // GET /v1/file-index/embed/active -> resumeable jobs for the signed-in user
  if (pathname === '/v1/file-index/embed/active' && req.method === 'GET') {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return true;
      sendJson(res, 200, { ok: true, jobs: await embedBatch.listActiveEmbeddingJobs(getUserId(auth)) });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: e?.message || 'Internal error' });
    }
    return true;
  }

  return false;
}
