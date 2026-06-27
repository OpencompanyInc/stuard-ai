/**
 * File-Index Embedding Batch Orchestration (cloud-ai side)
 *
 * The desktop drives the heavy work (it has direct filesystem + Rust-index
 * access): it gathers pending files, chunks text / reads images / falls back to
 * name-only for binaries, then hands the chunk payloads here. cloud-ai is the
 * broker that owns the Google API key + billing:
 *   - estimate  → credits for a token count + the user's balance
 *   - start     → enforce the credit cap (trim), submit a Gemini embeddings
 *                 batch, persist a job row
 *   - status    → advance the Gemini job state, report progress
 *   - results   → download vectors, bill actual credits once, hand vectors back
 *                 to the desktop to write into its local index
 *   - complete  → desktop reports write-back counts
 *
 * The bridge (execLocalTool) is request-scoped and unavailable to background
 * pollers, which is why write-back is desktop-initiated rather than pushed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseService, getCreditSummary, logUsageEvent } from '../supabase';
import { estimateEmbeddingCredits } from '../pricing';
import {
  createEmbeddingBatchJob,
  getGeminiBatchState,
  downloadEmbeddingResults,
  type EmbeddingBatchRequest,
} from './gemini-batch';

// Must match the query-side embedder so stored vectors are comparable — BOTH the
// model AND the output dimensionality. We pin 3072 (gemini-embedding-2's native,
// highest-quality dimension; the 768 default just trades quality for size). The
// launcher's query embed passes the same value to /inference/ai/embed. A mismatch
// makes cosine search silently return nothing. Override both via env if you change it.
const EMBEDDING_MODEL = process.env.EMBEDDING_BATCH_MODEL || 'gemini-embedding-2-preview';
const EMBEDDING_DIMENSIONS = Number(process.env.FILE_EMBED_DIM || 3072);
const IMAGE_TOKEN_COST = 258; // rough fixed cost for a multimodal image embedding
const MAX_CHUNKS_PER_JOB = 50_000;

function getSupabase(): SupabaseClient {
  const client = getSupabaseService();
  if (!client) {
    throw new Error('Supabase client not initialized (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required).');
  }
  return client;
}

// ── Payload shapes (from desktop) ────────────────────────────────────────────

export interface IncomingChunk {
  text?: string;
  image?: { base64: string; mimeType: string };
  approxTokens?: number;
}

export interface IncomingFile {
  id: string;
  filename: string;
  kind: string;
  chunks: IncomingChunk[];
}

export interface SubmitBody {
  rootId?: string;
  rootPath?: string;
  creditCap?: number;
  files: IncomingFile[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function chunkTokens(c: IncomingChunk): number {
  if (typeof c.approxTokens === 'number' && c.approxTokens > 0) return Math.ceil(c.approxTokens);
  if (c.image) return IMAGE_TOKEN_COST;
  return Math.max(1, Math.ceil((c.text?.length || 0) / 4));
}

export function fileTokens(f: IncomingFile): number {
  return (f.chunks || []).reduce((sum, c) => sum + chunkTokens(c), 0);
}

type CreditSummary = Awaited<ReturnType<typeof getCreditSummary>>;

/** Resolve the hard cap: the smaller of the requested cap and the live balance. */
function effectiveCapCredits(requestedCap: number | undefined, summary: CreditSummary | null): number | null {
  const balance = summary?.unlimited ? Infinity : Math.max(0, Number(summary?.remaining ?? 0));
  const reqCap = typeof requestedCap === 'number' && requestedCap > 0 ? requestedCap : Infinity;
  const cap = Math.min(reqCap, balance);
  return Number.isFinite(cap) ? cap : null;
}

/**
 * Greedily include whole files (caller sends smallest-first) until the credit
 * cap or chunk ceiling is hit. Shared by the batch and synchronous pipelines so
 * cap enforcement is identical. Files are atomic — never half-embedded.
 */
export async function selectFilesWithinCap(
  userId: string,
  files: IncomingFile[],
  requestedCap: number | undefined,
): Promise<{
  included: IncomingFile[];
  queuedFileIds: string[];
  cumulativeTokens: number;
  cumulativeCredits: number;
  insufficient: boolean;
}> {
  const summary = await getCreditSummary(userId).catch(() => null);
  if (summary && !summary.unlimited && Number(summary.remaining ?? 0) <= 0) {
    return { included: [], queuedFileIds: files.map((f) => f.id), cumulativeTokens: 0, cumulativeCredits: 0, insufficient: true };
  }
  const cap = effectiveCapCredits(requestedCap, summary);

  const included: IncomingFile[] = [];
  const queuedFileIds: string[] = [];
  let cumulativeTokens = 0;
  let cumulativeCredits = 0;
  let chunkCount = 0;

  for (const file of files) {
    const tks = fileTokens(file);
    const credits = estimateEmbeddingCredits(tks, { batch: true });
    const overCap = cap !== null && cumulativeCredits + credits > cap && included.length > 0;
    const overChunks = chunkCount + file.chunks.length > MAX_CHUNKS_PER_JOB && included.length > 0;
    if (overCap || overChunks) {
      queuedFileIds.push(file.id);
      continue;
    }
    included.push(file);
    cumulativeTokens += tks;
    cumulativeCredits += credits;
    chunkCount += file.chunks.length;
  }

  return { included, queuedFileIds, cumulativeTokens, cumulativeCredits, insufficient: false };
}

export const EMBEDDING_MODEL_ID = EMBEDDING_MODEL;
export const EMBEDDING_DIM = EMBEDDING_DIMENSIONS;

// ── Public API (called by routes) ────────────────────────────────────────────

export async function estimateEmbedding(
  userId: string,
  tokens: number,
): Promise<{ estimatedCredits: number; balance: number; unlimited: boolean }> {
  const summary = await getCreditSummary(userId).catch(() => null);
  return {
    estimatedCredits: estimateEmbeddingCredits(Math.max(0, tokens), { batch: true }),
    balance: summary?.unlimited ? -1 : Math.max(0, Number(summary?.remaining ?? 0)),
    unlimited: !!summary?.unlimited,
  };
}

export async function submitEmbeddingBatch(
  userId: string,
  body: SubmitBody,
): Promise<{
  ok: boolean;
  jobId?: string;
  includedFileIds?: string[];
  queuedFileIds?: string[];
  estimatedCredits?: number;
  estimatedTokens?: number;
  error?: string;
}> {
  const files = Array.isArray(body.files) ? body.files.filter((f) => f?.id && Array.isArray(f.chunks)) : [];
  if (files.length === 0) return { ok: false, error: 'no_files' };

  const { included, queuedFileIds, cumulativeTokens, cumulativeCredits, insufficient } =
    await selectFilesWithinCap(userId, files, body.creditCap);
  if (insufficient) return { ok: false, error: 'insufficient_credits' };
  if (included.length === 0) return { ok: false, error: 'cap_too_low' };

  // Build embedding-shaped JSONL requests, keyed `<fileId>::<chunkIdx>`.
  const requests: EmbeddingBatchRequest[] = [];
  for (const file of included) {
    file.chunks.forEach((c, i) => {
      const parts = c.image
        ? [{ inline_data: { mime_type: c.image.mimeType, data: c.image.base64 } }]
        : [{ text: c.text || file.filename }];
      const key = `${file.id}::${i}`;
      requests.push({
        key,
        metadata: { key },
        request: {
          model: `models/${EMBEDDING_MODEL}`,
          outputDimensionality: EMBEDDING_DIMENSIONS,
          content: { parts },
        },
      });
    });
  }

  let geminiJobId: string;
  try {
    const res = await createEmbeddingBatchJob(requests, EMBEDDING_MODEL, `stuard-file-index-${Date.now()}`);
    geminiJobId = res.geminiJobId;
  } catch (e: any) {
    return { ok: false, error: e?.message || 'batch_submit_failed' };
  }

  const { data, error } = await getSupabase()
    .from('file_index_embed_jobs')
    .insert({
      user_id: userId,
      root_id: body.rootId ?? null,
      root_path: body.rootPath ?? null,
      gemini_job_id: geminiJobId,
      status: 'running',
      model: EMBEDDING_MODEL,
      total_files: included.length,
      total_chunks: requests.length,
      embedded_files: 0,
      queued_files: queuedFileIds.length,
      estimated_tokens: cumulativeTokens,
      estimated_credits: cumulativeCredits,
      credit_cap: typeof body.creditCap === 'number' ? body.creditCap : null,
      files: included.map((f) => ({ id: f.id, filename: f.filename, kind: f.kind })),
    })
    .select()
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message || 'job_persist_failed' };
  }

  return {
    ok: true,
    jobId: data.id,
    includedFileIds: included.map((f) => f.id),
    queuedFileIds,
    estimatedCredits: cumulativeCredits,
    estimatedTokens: cumulativeTokens,
  };
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

function mapGeminiState(state: string): 'running' | 'succeeded' | 'failed' {
  const s = String(state || '').toUpperCase();
  if (s.includes('SUCCEEDED')) return 'succeeded';
  if (s.includes('FAILED') || s.includes('CANCELLED') || s.includes('EXPIRED')) return 'failed';
  return 'running';
}

async function loadJob(userId: string, jobId: string): Promise<any | null> {
  const { data } = await getSupabase()
    .from('file_index_embed_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', userId)
    .single();
  return data || null;
}

export async function getEmbeddingJobStatus(userId: string, jobId: string): Promise<any> {
  const job = await loadJob(userId, jobId);
  if (!job) return { ok: false, error: 'not_found' };

  // Already finished: report as-is.
  if (TERMINAL.has(job.status)) {
    return { ok: true, ...publicJob(job) };
  }

  try {
    const state = await getGeminiBatchState(job.gemini_job_id);
    const mapped = mapGeminiState(state.state);
    if (mapped !== job.status) {
      await getSupabase()
        .from('file_index_embed_jobs')
        .update({ status: mapped, updated_at: new Date().toISOString() })
        .eq('id', job.id);
      job.status = mapped;
    }
    // Surface in-flight Gemini batch counts so the UI bar moves while running.
    // Google's field is `successfulRequestCount` (string); also handle variants.
    const st = state.stats || {};
    const succeeded = Number(
      st.successfulRequestCount ?? st.succeededRequestCount ?? st.succeeded_request_count ?? 0,
    );
    const totalReq = Number(st.requestCount ?? st.request_count ?? job.total_chunks ?? 0);
    return {
      ok: true,
      ...publicJob(job),
      inflightSucceededChunks: Number.isFinite(succeeded) ? succeeded : 0,
      inflightTotalChunks: Number.isFinite(totalReq) ? totalReq : 0,
    };
  } catch (e: any) {
    return { ok: true, ...publicJob(job), pollError: e?.message };
  }
}

/**
 * Download vectors for a succeeded job, bill actual credits once, and return
 * the per-key embeddings for the desktop to write into its local index.
 */
export async function getEmbeddingJobResults(
  userId: string,
  jobId: string,
): Promise<{ ok: boolean; results?: Array<{ key: string; embedding: number[] }>; error?: string }> {
  const job = await loadJob(userId, jobId);
  if (!job) return { ok: false, error: 'not_found' };

  let state;
  try {
    state = await getGeminiBatchState(job.gemini_job_id);
  } catch (e: any) {
    return { ok: false, error: e?.message || 'poll_failed' };
  }
  if (mapGeminiState(state.state) === 'running') return { ok: false, error: 'not_ready' };

  // Results come back either inline (small batches) or via a downloadable file.
  let lines: Array<{ key: string; embedding: number[] | null; tokens: number }>;
  if (Array.isArray(state.inlined) && state.inlined.length > 0) {
    lines = state.inlined.map((r) => ({ key: r.key || '', embedding: r.embedding, tokens: r.tokens }));
  } else if (state.outputFileId) {
    try {
      lines = await downloadEmbeddingResults(state.outputFileId);
    } catch (e: any) {
      return { ok: false, error: e?.message || 'download_failed' };
    }
  } else {
    return { ok: false, error: 'no_output' };
  }

  const results = lines
    .filter((l) => l.key && Array.isArray(l.embedding) && l.embedding.length > 0)
    .map((l) => ({ key: l.key, embedding: l.embedding as number[] }));

  // Bill actual usage once. Guard with a conditional update so concurrent
  // polls can't double-charge.
  const actualTokens = lines.reduce((s, l) => s + (l.tokens || 0), 0) || Number(job.estimated_tokens || 0);
  const credits = estimateEmbeddingCredits(actualTokens, { batch: true });
  const { data: claimed } = await getSupabase()
    .from('file_index_embed_jobs')
    .update({ actual_credits: credits, status: 'succeeded', updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('actual_credits', 0)
    .select('id')
    .maybeSingle();

  if (claimed && credits > 0) {
    await logUsageEvent(userId, null, EMBEDDING_MODEL, {
      promptTokens: actualTokens,
      totalTokens: actualTokens,
      creditCost: credits,
      billable: true,
      sourceType: 'file_index_embedding',
      sourceLabel: 'file-index embedding batch',
    }).catch(() => {});
  }

  return { ok: true, results };
}

export async function completeEmbeddingJob(
  userId: string,
  jobId: string,
  embeddedFiles: number,
  failedFiles: number,
): Promise<{ ok: boolean }> {
  await getSupabase()
    .from('file_index_embed_jobs')
    .update({
      embedded_files: Math.max(0, embeddedFiles | 0),
      failed_files: Math.max(0, failedFiles | 0),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('user_id', userId);
  return { ok: true };
}

export async function listActiveEmbeddingJobs(userId: string): Promise<any[]> {
  const { data } = await getSupabase()
    .from('file_index_embed_jobs')
    .select('*')
    .eq('user_id', userId)
    // Only jobs that still need polling/write-back. 'succeeded' is excluded
    // because its vectors were already written; resuming it would re-download.
    .in('status', ['pending', 'running', 'writing'])
    .order('created_at', { ascending: false })
    .limit(20);
  // Include `files` so a restarted desktop can rebuild the fileId→metadata map
  // needed for write-back.
  return (data || []).map((job: any) => ({ ...publicJob(job), files: job.files || [] }));
}

function publicJob(job: any) {
  return {
    jobId: job.id,
    rootId: job.root_id,
    rootPath: job.root_path,
    status: job.status,
    totalFiles: job.total_files,
    totalChunks: job.total_chunks,
    embeddedFiles: job.embedded_files,
    failedFiles: job.failed_files,
    queuedFiles: job.queued_files,
    estimatedCredits: Number(job.estimated_credits || 0),
    actualCredits: Number(job.actual_credits || 0),
    error: job.error || null,
  };
}
