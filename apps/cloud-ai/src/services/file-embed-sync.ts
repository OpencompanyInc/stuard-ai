/**
 * Synchronous file-index embedding.
 *
 * Replaces the async Gemini Batch pipeline for interactive "make this folder
 * searchable" UX: embeds at request time and returns the vectors directly, so
 * results are usable in seconds with no job table, polling, or restart-resume.
 * Same credit cap + estimate + billing as the batch path (we set the rate; the
 * Google cost difference is pennies, not worth the batch latency/complexity).
 *
 * Text/name-only chunks go through `batchEmbedContents` (up to 100/call). Image
 * chunks go through `embedContent` (multimodal) in a small concurrency pool.
 */

import { logUsageEvent, getCreditSummary } from '../supabase';
import { estimateEmbeddingCredits } from '../pricing';
import {
  selectFilesWithinCap,
  fileTokens,
  EMBEDDING_MODEL_ID,
  EMBEDDING_DIM,
  type SubmitBody,
} from './file-embed-batch';

const GOOGLE_API_KEY =
  process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const GENAI = 'https://generativelanguage.googleapis.com/v1beta';
const TEXT_BATCH = 100;
const IMAGE_CONCURRENCY = 8;

interface ChunkReq {
  key: string; // `<fileId>::<chunkIdx>`
  text?: string;
  image?: { mimeType: string; data: string };
}

async function embedTextBatch(reqs: ChunkReq[], out: Map<string, number[]>): Promise<void> {
  for (let i = 0; i < reqs.length; i += TEXT_BATCH) {
    const group = reqs.slice(i, i + TEXT_BATCH);
    const body = {
      requests: group.map((r) => ({
        model: `models/${EMBEDDING_MODEL_ID}`,
        content: { parts: [{ text: r.text || '' }] },
        outputDimensionality: EMBEDDING_DIM,
      })),
    };
    const resp = await fetch(`${GENAI}/models/${EMBEDDING_MODEL_ID}:batchEmbedContents?key=${GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      throw new Error(`batchEmbedContents ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    }
    const json = (await resp.json()) as any;
    const embs: any[] = json?.embeddings || [];
    group.forEach((r, idx) => {
      const v = embs[idx]?.values;
      if (Array.isArray(v) && v.length) out.set(r.key, v);
    });
  }
}

async function embedOneImage(r: ChunkReq): Promise<[string, number[] | null]> {
  try {
    const resp = await fetch(`${GENAI}/models/${EMBEDDING_MODEL_ID}:embedContent?key=${GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ inline_data: { mime_type: r.image!.mimeType, data: r.image!.data } }] },
        outputDimensionality: EMBEDDING_DIM,
      }),
    });
    if (!resp.ok) return [r.key, null];
    const json = (await resp.json()) as any;
    const v = json?.embedding?.values;
    return [r.key, Array.isArray(v) && v.length ? v : null];
  } catch {
    return [r.key, null];
  }
}

async function embedImages(reqs: ChunkReq[], out: Map<string, number[]>): Promise<void> {
  for (let i = 0; i < reqs.length; i += IMAGE_CONCURRENCY) {
    const group = reqs.slice(i, i + IMAGE_CONCURRENCY);
    const results = await Promise.all(group.map(embedOneImage));
    for (const [key, vec] of results) {
      if (vec) out.set(key, vec);
    }
  }
}

function averageNormalize(vecs: number[][]): number[] {
  const dim = vecs[0].length;
  const avg = new Array(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) avg[i] += v[i] || 0;
  for (let i = 0; i < dim; i++) avg[i] /= vecs.length;
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += avg[i] * avg[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) avg[i] /= norm;
  return avg;
}

/**
 * Cap-selection pass over file METADATA only (no content), so the desktop can
 * decide which files fit the credit cap before streaming up megabytes of image
 * data. Pair with embedSync (which embeds exactly what it's handed).
 */
export async function planEmbedding(
  userId: string,
  body: SubmitBody,
): Promise<{
  ok: boolean;
  includedFileIds?: string[];
  queuedFileIds?: string[];
  estimatedCredits?: number;
  error?: string;
}> {
  const files = Array.isArray(body.files) ? body.files.filter((f) => f?.id && Array.isArray(f.chunks)) : [];
  if (files.length === 0) return { ok: false, error: 'no_files' };

  const { included, queuedFileIds, cumulativeCredits, insufficient } = await selectFilesWithinCap(
    userId,
    files,
    body.creditCap,
  );
  if (insufficient) return { ok: false, error: 'insufficient_credits' };
  if (included.length === 0) return { ok: false, error: 'cap_too_low' };

  return {
    ok: true,
    includedFileIds: included.map((f) => f.id),
    queuedFileIds,
    estimatedCredits: cumulativeCredits,
  };
}

/**
 * Embed exactly the files provided (the desktop sends them in byte-bounded
 * batches that already passed the cap via planEmbedding) and bill actual usage.
 * Does NOT re-cap — that would double-count across batches.
 */
export async function embedSync(
  userId: string,
  body: SubmitBody,
): Promise<{
  ok: boolean;
  vectors?: Array<{ fileId: string; vector: number[] }>;
  credits?: number;
  error?: string;
}> {
  if (!GOOGLE_API_KEY) return { ok: false, error: 'missing_api_key' };

  const included = Array.isArray(body.files) ? body.files.filter((f) => f?.id && Array.isArray(f.chunks)) : [];
  if (included.length === 0) return { ok: false, error: 'no_files' };

  // Balance safety only (no per-file trimming — planEmbedding already capped).
  const summary = await getCreditSummary(userId).catch(() => null);
  if (summary && !summary.unlimited && Number(summary.remaining ?? 0) <= 0) {
    return { ok: false, error: 'insufficient_credits' };
  }

  // Split chunks into text vs image requests.
  const textReqs: ChunkReq[] = [];
  const imageReqs: ChunkReq[] = [];
  for (const file of included) {
    file.chunks.forEach((c, i) => {
      const key = `${file.id}::${i}`;
      if (c.image) imageReqs.push({ key, image: { mimeType: c.image.mimeType, data: c.image.base64 } });
      else textReqs.push({ key, text: c.text || file.filename });
    });
  }

  const vectorsByKey = new Map<string, number[]>();
  try {
    await Promise.all([embedTextBatch(textReqs, vectorsByKey), embedImages(imageReqs, vectorsByKey)]);
  } catch (e: any) {
    return { ok: false, error: e?.message || 'embed_failed' };
  }
  if (vectorsByKey.size === 0) return { ok: false, error: 'no_vectors' };

  // Average chunk vectors per file.
  const byFile = new Map<string, number[][]>();
  for (const [key, vec] of vectorsByKey) {
    const fileId = key.includes('::') ? key.slice(0, key.lastIndexOf('::')) : key;
    if (!byFile.has(fileId)) byFile.set(fileId, []);
    byFile.get(fileId)!.push(vec);
  }
  const vectors = Array.from(byFile.entries()).map(([fileId, vecs]) => ({
    fileId,
    vector: averageNormalize(vecs),
  }));

  // Bill the files we actually embedded (same rate as the estimate).
  const billedTokens = included
    .filter((f) => byFile.has(f.id))
    .reduce((sum, f) => sum + fileTokens(f), 0);
  const credits = estimateEmbeddingCredits(billedTokens, { batch: true });
  if (credits > 0) {
    await logUsageEvent(userId, null, EMBEDDING_MODEL_ID, {
      promptTokens: billedTokens,
      totalTokens: billedTokens,
      creditCost: credits,
      billable: true,
      sourceType: 'file_index_embedding',
      sourceLabel: 'file-index embedding (sync)',
    }).catch(() => {});
  }

  return { ok: true, vectors, credits };
}
