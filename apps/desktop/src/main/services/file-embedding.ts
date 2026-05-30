/**
 * File-Index Semantic Embedding Orchestrator (desktop main)
 *
 * The desktop owns the heavy lifting because it has direct filesystem + Rust
 * index access; cloud-ai is only the broker (Google key + billing). Flow:
 *   1. gather pending files from the Rust index, read + chunk locally
 *      (text → token-aware chunks, images → base64, everything else →
 *      name-only so binaries/exe cost almost nothing)
 *   2. POST the chunk payload to cloud-ai /embed/start (it enforces the credit
 *      cap, submits a Gemini Batch job, returns which files were included)
 *   3. poll /embed/status; when the batch succeeds, fetch /embed/results,
 *      average per-file chunk vectors, and write them back into the Rust index
 *   4. report write-back counts via /embed/complete
 *
 * Progress is pushed to all windows on the `file-index:embed-progress` channel.
 */

import { BrowserWindow } from "electron";
import * as fsp from "fs/promises";
import * as path from "path";
import logger from "../utils/logger";
import { getPendingFiles, updateFileEmbedding, markFileEmbeddingError, type PendingFile } from "./file-indexing";

// ── Tuning (kept in step with the cloud chunker) ─────────────────────────────
const MAX_CONTENT_CHARS = 100_000;
const CHUNK_SIZE_CHARS = 6000;
const CHUNK_OVERLAP_CHARS = 400;
const IMAGE_TOKEN_COST = 258;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const MAX_FILES_PER_JOB = Number(process.env.STUARD_EMBED_MAX_FILES || 4000);
const MAX_PAYLOAD_TOKENS = Number(process.env.STUARD_EMBED_MAX_PAYLOAD_TOKENS || 4_000_000);
// Per HTTP request to /embed/sync. Image base64 dominates; keep each body well
// under typical server limits (~12MB of payload chars).
const MAX_SYNC_BATCH_BYTES = Number(process.env.STUARD_EMBED_MAX_BATCH_BYTES || 12_000_000);
const EMBEDDING_MODEL = "gemini-embedding-2-preview";
const POLL_MS = 15_000;

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);
const TEXT_KINDS = new Set(["document", "code"]);
const IMAGE_KINDS = new Set(["image"]);

// ── Types ────────────────────────────────────────────────────────────────────

interface OutChunk {
  text?: string;
  image?: { base64: string; mimeType: string };
  approxTokens: number;
}
interface OutFile {
  id: string;
  filename: string;
  kind: string;
  chunks: OutChunk[];
}
interface LocalFileMeta {
  filename: string;
  kind: string;
  summary: string;
  keywords: string;
}

export interface EmbedJobProgress {
  jobId: string;
  rootId?: string;
  status: "gathering" | "submitting" | "running" | "writing" | "succeeded" | "failed";
  totalFiles: number;
  embeddedFiles: number;
  queuedFiles: number;
  estimatedCredits: number;
  error?: string;
}

interface ActiveJob {
  jobId: string;
  rootId?: string;
  baseUrl: string;
  token: string;
  files: Map<string, LocalFileMeta>; // fileId -> meta (included files only)
  progress: EmbedJobProgress;
  writingBack: boolean;
}

const activeJobs = new Map<string, ActiveJob>();
let pollTimer: NodeJS.Timeout | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function emit(progress: EmbedJobProgress) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send("file-index:embed-progress", progress);
    } catch {
      /* ignore */
    }
  }
}

function approxTokensForSize(file: PendingFile): number {
  if (IMAGE_KINDS.has(file.kind)) return IMAGE_TOKEN_COST;
  if (TEXT_KINDS.has(file.kind)) {
    return Math.max(1, Math.ceil(Math.min(file.size, MAX_CONTENT_CHARS) / 4));
  }
  return Math.max(4, Math.ceil((file.filename.length + 12) / 4)); // name-only
}

function keywordsFor(filename: string): string {
  return filename.replace(/[._\-/\\]/g, " ").trim();
}

function chunkText(text: string, size = CHUNK_SIZE_CHARS, overlap = CHUNK_OVERLAP_CHARS): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const para = text.lastIndexOf("\n\n", end);
      if (para > start + size * 0.5) end = para + 2;
      else {
        const line = text.lastIndexOf("\n", end);
        if (line > start + size * 0.5) end = line + 1;
      }
    }
    chunks.push(text.slice(start, end));
    start = end - overlap;
    if (start >= end) start = end;
  }
  return chunks;
}

/** Read at most `maxBytes` from the front of a file (bounds memory on huge files). */
async function readPrefix(filePath: string, maxBytes: number): Promise<string | null> {
  let handle: fsp.FileHandle | null = null;
  try {
    handle = await fsp.open(filePath, "r");
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } catch (e) {
    logger.warn(`[file-embedding] readPrefix failed for ${filePath}:`, (e as any)?.message);
    return null;
  } finally {
    try { await handle?.close(); } catch { /* ignore */ }
  }
}

function imageMime(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".bmp": return "image/bmp";
    default: return "application/octet-stream";
  }
}

/** Build the embedding chunks for one file + the local metadata for write-back. */
async function buildFile(file: PendingFile): Promise<{ out: OutFile; meta: LocalFileMeta } | null> {
  const ext = (file.extension || "").toLowerCase();
  const keywords = keywordsFor(file.filename);

  // Images → multimodal embedding (size-capped)
  if (IMAGE_KINDS.has(file.kind) && IMAGE_EXTENSIONS.has(ext) && file.size <= MAX_IMAGE_SIZE) {
    try {
      const data = await fsp.readFile(file.path);
      const base64 = data.toString("base64");
      return {
        out: { id: file.id, filename: file.filename, kind: file.kind, chunks: [{ image: { base64, mimeType: imageMime(ext) }, approxTokens: IMAGE_TOKEN_COST }] },
        meta: { filename: file.filename, kind: file.kind, summary: `Image: ${file.filename}`, keywords: `image, ${keywords}` },
      };
    } catch {
      /* fall through to name-only */
    }
  }

  // Text / code → chunk content
  if (TEXT_KINDS.has(file.kind)) {
    const content = await readPrefix(file.path, MAX_CONTENT_CHARS);
    if (content && content.trim()) {
      const fullText = `${file.filename}\n\n${content}`;
      const chunks = chunkText(fullText).map((t) => ({ text: t, approxTokens: Math.max(1, Math.ceil(t.length / 4)) }));
      return {
        out: { id: file.id, filename: file.filename, kind: file.kind, chunks },
        meta: { filename: file.filename, kind: file.kind, summary: content.slice(0, 500).trim(), keywords },
      };
    }
  }

  // Everything else (video, audio, binary, archive, exe, unknown) has no
  // embeddable content. We deliberately do NOT "name-only" embed it: a filename
  // embedded as text adds nothing the filename FTS doesn't already cover, and
  // same-modal text↔text cosine buries real image/document embeds for text
  // queries. These stay findable by name via quick search.
  return null;
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const avg = new Float64Array(dim);
  for (const v of vectors) for (let i = 0; i < dim && i < v.length; i++) avg[i] += v[i];
  let norm = 0;
  for (let i = 0; i < dim; i++) { avg[i] /= vectors.length; norm += avg[i] * avg[i]; }
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) avg[i] /= norm;
  return Array.from(avg);
}

async function cloudFetch(baseUrl: string, token: string, pathname: string, init?: RequestInit): Promise<any> {
  const url = `${baseUrl.replace(/\/$/, "")}${pathname}`;
  const resp = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  });
  return resp.json().catch(() => ({ ok: false, error: `bad_response_${resp.status}` }));
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function estimateEmbedJob(
  rootId: string | undefined,
  baseUrl: string,
  token: string,
): Promise<{ ok: boolean; files: number; estimatedTokens: number; estimatedCredits: number; balance: number; unlimited: boolean; error?: string }> {
  try {
    const pending = await getPendingFiles(rootId, MAX_FILES_PER_JOB);
    const tokens = pending.reduce((s, f) => s + approxTokensForSize(f), 0);
    const est = await cloudFetch(baseUrl, token, "/v1/file-index/embed/estimate", {
      method: "POST",
      body: JSON.stringify({ tokens }),
    });
    return {
      ok: true,
      files: pending.length,
      estimatedTokens: tokens,
      estimatedCredits: Number(est?.estimatedCredits || 0),
      balance: Number(est?.balance ?? 0),
      unlimited: !!est?.unlimited,
    };
  } catch (e: any) {
    return { ok: false, files: 0, estimatedTokens: 0, estimatedCredits: 0, balance: 0, unlimited: false, error: e?.message };
  }
}

export async function startEmbedJob(
  rootId: string | undefined,
  creditCap: number | undefined,
  baseUrl: string,
  token: string,
): Promise<{ ok: boolean; jobId?: string; includedFiles?: number; queuedFiles?: number; estimatedCredits?: number; error?: string }> {
  const pending = await getPendingFiles(rootId, MAX_FILES_PER_JOB);
  if (pending.length === 0) return { ok: false, error: "no_pending_files" };

  // Gather + chunk locally, capping the payload by token budget (cloud applies
  // the authoritative credit cap on top of this).
  const outFiles: OutFile[] = [];
  const metaById = new Map<string, LocalFileMeta>();
  let payloadTokens = 0;
  for (const file of pending) {
    if (payloadTokens >= MAX_PAYLOAD_TOKENS && outFiles.length > 0) break;
    const built = await buildFile(file).catch(() => null);
    if (!built || built.out.chunks.length === 0) continue;
    outFiles.push(built.out);
    metaById.set(file.id, built.meta);
    payloadTokens += built.out.chunks.reduce((s, c) => s + c.approxTokens, 0);
  }
  if (outFiles.length === 0) return { ok: false, error: "nothing_to_embed" };

  const progress: EmbedJobProgress = {
    jobId: rootId || "sync",
    rootId,
    status: "running",
    totalFiles: outFiles.length,
    embeddedFiles: 0,
    queuedFiles: 0,
    estimatedCredits: 0,
  };
  emit(progress);

  // 1) Cap selection over metadata only (tiny payload) — decides which files
  // fit the credit budget before we stream any image bytes.
  const plan = await cloudFetch(baseUrl, token, "/v1/file-index/embed/plan", {
    method: "POST",
    body: JSON.stringify({
      rootId,
      creditCap,
      files: outFiles.map((f) => ({
        id: f.id,
        filename: f.filename,
        kind: f.kind,
        chunks: f.chunks.map((c) => ({ approxTokens: c.approxTokens })),
      })),
    }),
  });
  if (!plan?.ok || !Array.isArray(plan.includedFileIds)) {
    progress.status = "failed";
    progress.error = plan?.error || "plan_failed";
    emit(progress);
    return { ok: false, error: plan?.error || "plan_failed" };
  }

  const includedSet = new Set<string>(plan.includedFileIds);
  const included = outFiles.filter((f) => includedSet.has(f.id));
  progress.totalFiles = included.length;
  progress.queuedFiles = Array.isArray(plan.queuedFileIds) ? plan.queuedFileIds.length : 0;
  progress.estimatedCredits = Number(plan.estimatedCredits || 0);
  emit(progress);

  // 2) Embed in byte-bounded batches so image-heavy folders don't blow the HTTP
  // body limit. The cap is already enforced (step 1), so the cloud embeds
  // exactly what we send.
  let written = 0;
  for (const batch of byteBatches(included)) {
    const resp = await cloudFetch(baseUrl, token, "/v1/file-index/embed/sync", {
      method: "POST",
      body: JSON.stringify({ files: batch }),
    });
    if (!resp?.ok || !Array.isArray(resp.vectors)) {
      // Batch failed — mark its files errored and keep going with the rest.
      for (const f of batch) await markFileEmbeddingError(f.id, resp?.error || "embed_failed").catch(() => {});
      continue;
    }
    progress.status = "writing";
    emit(progress);
    for (const v of resp.vectors as Array<{ fileId: string; vector: number[] }>) {
      if (!v?.fileId || !Array.isArray(v.vector) || v.vector.length === 0) continue;
      const meta = metaById.get(v.fileId);
      const ok = await updateFileEmbedding({
        fileId: v.fileId,
        vector: v.vector,
        summary: meta?.summary,
        keywords: meta?.keywords,
        embeddingModel: EMBEDDING_MODEL,
      }).catch(() => false);
      if (ok) written++;
      else await markFileEmbeddingError(v.fileId, "embedding write failed").catch(() => {});
      progress.embeddedFiles = written;
      emit(progress);
    }
  }

  progress.status = written > 0 ? "succeeded" : "failed";
  if (written === 0) progress.error = progress.error || "no_files_embedded";
  progress.embeddedFiles = written;
  emit(progress);

  return {
    ok: written > 0,
    jobId: progress.jobId,
    includedFiles: written,
    queuedFiles: progress.queuedFiles,
    estimatedCredits: progress.estimatedCredits,
    error: written > 0 ? undefined : progress.error,
  };
}

/** Approx serialized byte size of one file's chunks (base64 dominates images). */
function fileBytes(f: OutFile): number {
  let n = 0;
  for (const c of f.chunks) n += c.image ? c.image.base64.length : (c.text?.length || 0);
  return n;
}

/** Split files into batches whose combined payload stays under the byte budget. */
function byteBatches(files: OutFile[]): OutFile[][] {
  const batches: OutFile[][] = [];
  let cur: OutFile[] = [];
  let curBytes = 0;
  for (const f of files) {
    const b = fileBytes(f);
    if (cur.length > 0 && curBytes + b > MAX_SYNC_BATCH_BYTES) {
      batches.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(f);
    curBytes += b;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

export function getActiveEmbedJobs(): EmbedJobProgress[] {
  return Array.from(activeJobs.values()).map((j) => j.progress);
}

/**
 * Re-attach to jobs that are still in flight server-side (e.g. after an app
 * restart, which clears the in-memory poller). Pulls them from Supabase via the
 * cloud and resumes polling + write-back. Idempotent — skips jobs already
 * tracked. Returns the resumed jobs' progress for the UI.
 */
export async function resumeEmbedJobs(baseUrl: string, token: string): Promise<EmbedJobProgress[]> {
  let active: any;
  try {
    active = await cloudFetch(baseUrl, token, '/v1/file-index/embed/active', { method: 'GET' });
  } catch {
    return getActiveEmbedJobs();
  }
  if (!active?.ok || !Array.isArray(active.jobs)) return getActiveEmbedJobs();

  for (const j of active.jobs) {
    if (!j?.jobId || activeJobs.has(j.jobId)) continue;

    // Rebuild the fileId→metadata map from the stored compact file list. We no
    // longer have the original chunk text, so summary/keywords are derived from
    // the filename — good enough; the vectors are what power search.
    const files = new Map<string, LocalFileMeta>();
    for (const f of Array.isArray(j.files) ? j.files : []) {
      if (!f?.id) continue;
      const filename = String(f.filename || '');
      const kind = String(f.kind || 'other');
      files.set(f.id, {
        filename,
        kind,
        summary: kind === 'image' ? `Image: ${filename}` : filename,
        keywords: keywordsFor(filename),
      });
    }

    const progress: EmbedJobProgress = {
      jobId: j.jobId,
      rootId: j.rootId || undefined,
      status: 'running',
      totalFiles: Number(j.totalFiles) || files.size,
      embeddedFiles: Number(j.embeddedFiles) || 0,
      queuedFiles: Number(j.queuedFiles) || 0,
      estimatedCredits: Number(j.estimatedCredits) || 0,
    };
    activeJobs.set(j.jobId, { jobId: j.jobId, rootId: progress.rootId, baseUrl, token, files, progress, writingBack: false });
    emit(progress);
  }

  if (activeJobs.size > 0) {
    ensurePolling();
    // Kick an immediate poll so a job that finished while we were down writes
    // back right away instead of waiting a full interval.
    pollOnce().catch(() => {});
  }
  return getActiveEmbedJobs();
}

function ensurePolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    pollOnce().catch((e) => logger.warn("[file-embedding] poll error:", e?.message));
  }, POLL_MS);
  // Kick an immediate first poll shortly after start.
  setTimeout(() => pollOnce().catch(() => {}), 3000);
}

function stopPollingIfIdle() {
  if (activeJobs.size === 0 && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollOnce() {
  for (const job of Array.from(activeJobs.values())) {
    if (job.writingBack) continue;
    let status: any;
    try {
      status = await cloudFetch(job.baseUrl, job.token, `/v1/file-index/embed/status?jobId=${encodeURIComponent(job.jobId)}`, { method: "GET" });
    } catch (e: any) {
      continue; // transient; retry next tick
    }
    if (!status?.ok) continue;

    if (status.status === "failed") {
      job.progress.status = "failed";
      job.progress.error = status.error || "batch_failed";
      emit(job.progress);
      activeJobs.delete(job.jobId);
      continue;
    }

    if (status.status === "succeeded") {
      job.writingBack = true;
      job.progress.status = "writing";
      emit(job.progress);
      try {
        await writeBack(job);
      } catch (e: any) {
        logger.warn(`[file-embedding] write-back failed for ${job.jobId}:`, e?.message);
        job.progress.status = "failed";
        job.progress.error = e?.message || "writeback_failed";
        emit(job.progress);
      }
      activeJobs.delete(job.jobId);
      continue;
    }

    // Still running — surface Gemini's in-flight count so the bar moves instead
    // of sitting at 0% for the whole (often multi-minute) batch.
    const inflight = Number(status.inflightSucceededChunks || 0);
    if (inflight > job.progress.embeddedFiles) {
      job.progress.embeddedFiles = Math.min(inflight, job.progress.totalFiles || inflight);
      emit(job.progress);
    }
  }
  stopPollingIfIdle();
}

async function writeBack(job: ActiveJob) {
  const res = await cloudFetch(job.baseUrl, job.token, `/v1/file-index/embed/results?jobId=${encodeURIComponent(job.jobId)}`, { method: "GET" });
  if (!res?.ok || !Array.isArray(res.results)) {
    throw new Error(res?.error || "no_results");
  }

  // Group chunk vectors by fileId (key = `<fileId>::<chunkIdx>`).
  const byFile = new Map<string, number[][]>();
  for (const r of res.results as Array<{ key: string; embedding: number[] }>) {
    const sep = r.key.lastIndexOf("::");
    const fileId = sep > 0 ? r.key.slice(0, sep) : r.key;
    if (!byFile.has(fileId)) byFile.set(fileId, []);
    if (Array.isArray(r.embedding) && r.embedding.length) byFile.get(fileId)!.push(r.embedding);
  }

  let embedded = 0;
  let failed = 0;
  for (const [fileId, vectors] of byFile) {
    const meta = job.files.get(fileId);
    if (vectors.length === 0) { failed++; continue; }
    const vector = averageVectors(vectors);
    const ok = await updateFileEmbedding({
      fileId,
      vector,
      summary: meta?.summary,
      keywords: meta?.keywords,
      embeddingModel: EMBEDDING_MODEL,
    }).catch(() => false);
    if (ok) {
      embedded++;
    } else {
      failed++;
      await markFileEmbeddingError(fileId, "embedding write failed").catch(() => {});
    }
    job.progress.embeddedFiles = embedded;
    emit(job.progress);
  }

  job.progress.status = "succeeded";
  job.progress.embeddedFiles = embedded;
  emit(job.progress);

  await cloudFetch(job.baseUrl, job.token, "/v1/file-index/embed/complete", {
    method: "POST",
    body: JSON.stringify({ jobId: job.jobId, embeddedFiles: embedded, failedFiles: failed }),
  }).catch(() => {});
}
