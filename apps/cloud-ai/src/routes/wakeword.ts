/**
 * Wakeword Routes
 *
 * Custom wakeword enrollment for paid users (STARTER+).
 *
 * Endpoints:
 *   POST   /v1/wakeword/enroll   - Upload audio samples, start fine-tuning
 *   GET    /v1/wakeword/status   - Check enrollment status
 *   GET    /v1/wakeword/weights  - Get signed download URL for custom weights
 *   DELETE /v1/wakeword/weights  - Delete custom weights (reset to default)
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, getProfile, logUsageEvent } from '../supabase';
import { WAKEWORD_ALLOWED_PLANS, WAKEWORD_ENROLL_CREDIT_COST, creditsPerUsd } from '../pricing';
import {
  startEnrollment,
  getEnrollment,
  getWeightsDownloadUrl,
  deleteEnrollment,
} from '../services/wakeword-training';

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

async function requirePaidPlan(userId: string, res: ServerResponse): Promise<boolean> {
  const profile = await getProfile(userId);
  if (!profile) {
    json(res, 403, { ok: false, error: 'profile_not_found' });
    return false;
  }
  const planKey = String(profile.plan || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (!WAKEWORD_ALLOWED_PLANS.has(planKey)) {
    json(res, 403, {
      ok: false,
      error: 'plan_not_eligible',
      message: 'Custom wakeword enrollment requires a Starter plan or above.',
      currentPlan: profile.plan,
      requiredPlans: Array.from(WAKEWORD_ALLOWED_PLANS),
    });
    return false;
  }
  return true;
}

/**
 * Parse multipart/form-data body to extract WAV files.
 * Returns array of { filename, data } for each file part.
 */
async function parseMultipartAudio(
  req: IncomingMessage,
  maxBytes = 50 * 1024 * 1024, // 50 MB total limit
): Promise<{ files: Array<{ filename: string; data: Buffer }>; fields: Record<string, string> }> {
  const contentType = String(req.headers['content-type'] || '');
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
  if (!boundaryMatch) throw new Error('missing_boundary');
  const boundary = boundaryMatch[1] || boundaryMatch[2];

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks);
        const files: Array<{ filename: string; data: Buffer }> = [];
        const fields: Record<string, string> = {};

        const delimiter = Buffer.from(`--${boundary}`);
        const closeDelimiter = Buffer.from(`--${boundary}--`);

        let pos = 0;
        while (pos < body.length) {
          const start = body.indexOf(delimiter, pos);
          if (start === -1) break;
          const afterDelimiter = start + delimiter.length;

          // Check for close delimiter
          if (body.slice(start, start + closeDelimiter.length).equals(closeDelimiter)) break;

          // Find end of this part
          const nextBoundary = body.indexOf(delimiter, afterDelimiter + 2);
          if (nextBoundary === -1) break;

          // Extract part content (skip \r\n after delimiter)
          const partStart = afterDelimiter + 2; // skip \r\n
          const partEnd = nextBoundary - 2; // strip trailing \r\n
          const part = body.slice(partStart, partEnd);

          // Split headers from body
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) { pos = nextBoundary; continue; }

          const headerStr = part.slice(0, headerEnd).toString('utf-8');
          const partBody = part.slice(headerEnd + 4);

          const dispositionMatch = headerStr.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
          if (dispositionMatch) {
            const name = dispositionMatch[1];
            const filename = dispositionMatch[2];
            if (filename) {
              files.push({ filename, data: partBody });
            } else {
              fields[name] = partBody.toString('utf-8');
            }
          }

          pos = nextBoundary;
        }

        resolve({ files, fields });
      } catch (e: any) {
        reject(e);
      }
    });

    req.on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleWakewordRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  const p = parsedUrl.pathname;
  const method = req.method || '';

  if (!p.startsWith('/v1/wakeword')) return false;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return true;
  }

  // ── POST /v1/wakeword/enroll ─────────────────────────────────────────────
  if (p === '/v1/wakeword/enroll' && method === 'POST') {
    try {
      const user = await authenticate(req, res);
      if (!user) return true;

      if (!(await requirePaidPlan(user.userId, res))) return true;

      const contentType = String(req.headers['content-type'] || '');
      if (!contentType.includes('multipart/form-data')) {
        json(res, 400, { ok: false, error: 'content_type_must_be_multipart_form_data' });
        return true;
      }

      const { files, fields } = await parseMultipartAudio(req);
      const wavFiles = files.filter((f) =>
        f.filename.toLowerCase().endsWith('.wav') || f.filename.toLowerCase().endsWith('.webm'),
      );

      if (wavFiles.length < 2) {
        json(res, 400, {
          ok: false,
          error: 'at_least_2_audio_samples_required',
          message: 'Please upload at least 2 WAV recordings of yourself saying the wake phrase.',
          receivedFiles: files.length,
        });
        return true;
      }

      const wakePhrase = fields.wake_phrase || fields.wakePhrase || 'hey stuard';

      const result = await startEnrollment(user.userId, wavFiles, wakePhrase);

      if (!result.ok) {
        json(res, 400, { ok: false, error: result.error });
        return true;
      }

      // Log usage event for billing
      try {
        await logUsageEvent(user.userId, null, 'wakeword-finetune', {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          costUsd: WAKEWORD_ENROLL_CREDIT_COST / Math.max(creditsPerUsd(), 1),
          sourceType: 'wakeword_enroll',
          metadata: { jobId: result.jobId, wakePhrase, sampleCount: wavFiles.length },
        });
      } catch {}

      json(res, 202, {
        ok: true,
        jobId: result.jobId,
        status: 'processing',
        creditCost: WAKEWORD_ENROLL_CREDIT_COST,
        message: 'Wakeword enrollment started. Fine-tuning in progress.',
      });
      return true;
    } catch (e: any) {
      json(res, 500, { ok: false, error: 'internal_error', message: e?.message || 'failed' });
      return true;
    }
  }

  // ── GET /v1/wakeword/status ──────────────────────────────────────────────
  if (p === '/v1/wakeword/status' && method === 'GET') {
    try {
      const user = await authenticate(req, res);
      if (!user) return true;

      const enrollment = await getEnrollment(user.userId);
      if (!enrollment) {
        json(res, 200, {
          ok: true,
          enrolled: false,
          status: null,
          message: 'No custom wakeword enrollment found.',
        });
        return true;
      }

      json(res, 200, {
        ok: true,
        enrolled: enrollment.status === 'completed',
        status: enrollment.status,
        wakePhrase: enrollment.wake_phrase,
        hasCustomWeights: enrollment.status === 'completed' && !!enrollment.weights_object,
        errorMessage: enrollment.status === 'failed' ? enrollment.error_message : null,
        createdAt: enrollment.created_at,
        updatedAt: enrollment.updated_at,
      });
      return true;
    } catch (e: any) {
      json(res, 500, { ok: false, error: 'internal_error', message: e?.message || 'failed' });
      return true;
    }
  }

  // ── GET /v1/wakeword/weights ─────────────────────────────────────────────
  if (p === '/v1/wakeword/weights' && method === 'GET') {
    try {
      const user = await authenticate(req, res);
      if (!user) return true;

      const downloadUrl = await getWeightsDownloadUrl(user.userId);
      if (!downloadUrl) {
        json(res, 404, {
          ok: false,
          error: 'no_custom_weights',
          message: 'No custom wakeword weights found. Enroll first via POST /v1/wakeword/enroll.',
        });
        return true;
      }

      json(res, 200, {
        ok: true,
        downloadUrl,
        message: 'Signed URL valid for 1 hour.',
      });
      return true;
    } catch (e: any) {
      json(res, 500, { ok: false, error: 'internal_error', message: e?.message || 'failed' });
      return true;
    }
  }

  // ── DELETE /v1/wakeword/weights ──────────────────────────────────────────
  if (p === '/v1/wakeword/weights' && method === 'DELETE') {
    try {
      const user = await authenticate(req, res);
      if (!user) return true;

      const deleted = await deleteEnrollment(user.userId);
      json(res, 200, {
        ok: true,
        deleted,
        message: deleted
          ? 'Custom wakeword weights deleted. The default model will be used.'
          : 'No custom wakeword enrollment found to delete.',
      });
      return true;
    } catch (e: any) {
      json(res, 500, { ok: false, error: 'internal_error', message: e?.message || 'failed' });
      return true;
    }
  }

  return false;
}
