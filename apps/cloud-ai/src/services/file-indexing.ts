/**
 * File Indexing Service
 *
 * Processes pending files from the local agent:
 * 1. Reads file content via agent bridge
 * 2. Chunks text content for large files (token-aware splitting)
 * 3. Embeds chunks in parallel using Gemini Embedding 2 (multimodal)
 * 4. Averages chunk embeddings into a single file vector
 * 5. For images: embeds directly via multimodal embedding (no LLM summary needed)
 * 6. Updates the local file index via agent
 */

import { embed, embedMany } from 'ai';
import { google } from '../utils/models';
import { execLocalTool, hasClientBridge, getBridgeSecrets } from '../tools/bridge';
import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseService } from '../supabase';

function getSupabase(): SupabaseClient {
  const client = getSupabaseService();
  if (!client) {
    throw new Error('Supabase client not initialized. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }
  return client;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const EMBEDDING_DIMENSIONS = 3072;

const MAX_CONTENT_CHARS = 100_000;   // Read up to 100k chars (chunking handles the rest)
const CHUNK_SIZE_CHARS = 6000;       // ~2048 tokens — stays within gemini-embedding-2 input limit
const CHUNK_OVERLAP_CHARS = 400;     // Overlap between chunks for context continuity
const BATCH_SIZE = 10;               // Files per processing batch
const EMBED_PARALLEL_LIMIT = 20;     // Max concurrent embedding calls

// File types
const EMBEDDABLE_TEXT_KINDS = new Set(['document', 'code']);
const IMAGE_KINDS = new Set(['image']);
const METADATA_ONLY_KINDS = new Set(['binary', 'archive', 'video']);

// Image extensions supported by Gemini multimodal embedding
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface PendingFile {
  id: string;
  path: string;
  filename: string;
  extension: string;
  kind: string;
  size: number;
}

interface IndexedResult {
  fileId: string;
  success: boolean;
  summary?: string;
  keywords?: string;
  vector?: number[];
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTENT EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

async function readFileContent(path: string, maxChars: number = MAX_CONTENT_CHARS): Promise<string | null> {
  try {
    const result = await execLocalTool('read_file', { path, line_start: 1, line_end: 3000 });
    if (!result?.ok || !result?.content) {
      return null;
    }
    let content = String(result.content);
    if (content.length > maxChars) {
      content = content.slice(0, maxChars);
    }
    return content;
  } catch (error) {
    console.error(`[file-indexing] Failed to read ${path}:`, error);
    return null;
  }
}

async function readFileBinary(path: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const result = await execLocalTool('read_file_binary', { path });
    if (!result?.ok || !result?.base64) {
      return null;
    }
    return {
      base64: result.base64,
      mimeType: result.mime_type || 'application/octet-stream',
    };
  } catch (error) {
    console.error(`[file-indexing] Failed to read binary ${path}:`, error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHUNKING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Split text into overlapping chunks that fit within the embedding model's
 * input token limit. Splits on paragraph/line boundaries when possible.
 */
function chunkText(text: string, chunkSize: number = CHUNK_SIZE_CHARS, overlap: number = CHUNK_OVERLAP_CHARS): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // Try to break on a paragraph or line boundary
    if (end < text.length) {
      // Look for paragraph break (double newline)
      const paraBreak = text.lastIndexOf('\n\n', end);
      if (paraBreak > start + chunkSize * 0.5) {
        end = paraBreak + 2;
      } else {
        // Fall back to single newline
        const lineBreak = text.lastIndexOf('\n', end);
        if (lineBreak > start + chunkSize * 0.5) {
          end = lineBreak + 1;
        }
      }
    }

    chunks.push(text.slice(start, end));
    start = end - overlap;

    // Avoid infinite loop on tiny overlap
    if (start >= end) start = end;
  }

  return chunks;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMBEDDING
// ═══════════════════════════════════════════════════════════════════════════════

const embeddingModel = google.textEmbeddingModel(EMBEDDING_MODEL);

async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const result = await embed({
      model: embeddingModel,
      value: text,
    });
    return result.embedding;
  } catch (error) {
    console.error('[file-indexing] Embedding generation failed:', error);
    return null;
  }
}

async function generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  try {
    const result = await embedMany({
      model: embeddingModel,
      values: texts,
    });
    return result.embeddings;
  } catch (error) {
    console.error('[file-indexing] Batch embedding generation failed:', error);
    return texts.map(() => null);
  }
}

/**
 * Average multiple chunk embeddings into a single representative vector.
 * L2-normalizes the result since non-3072 Gemini embeddings aren't pre-normalized.
 */
function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  if (embeddings.length === 1) return embeddings[0];

  const dim = embeddings[0].length;
  const avg = new Float64Array(dim);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      avg[i] += emb[i];
    }
  }

  // Normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    avg[i] /= embeddings.length;
    norm += avg[i] * avg[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      avg[i] /= norm;
    }
  }

  return Array.from(avg);
}

/**
 * Embed a file's text content using chunking + parallel embedding.
 * Returns the averaged embedding vector and a plain-text summary (first chunk).
 */
async function embedTextContent(
  filename: string,
  content: string
): Promise<{ vector: number[]; summary: string; keywords: string } | null> {
  // Prepend filename for context
  const fullText = `${filename}\n\n${content}`;
  const chunks = chunkText(fullText);

  // Embed all chunks in parallel batches
  const allEmbeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_PARALLEL_LIMIT) {
    const batch = chunks.slice(i, i + EMBED_PARALLEL_LIMIT);
    const results = await generateEmbeddings(batch);
    for (const emb of results) {
      if (emb) allEmbeddings.push(emb);
    }
  }

  if (allEmbeddings.length === 0) return null;

  const vector = averageEmbeddings(allEmbeddings);

  // Use first ~500 chars as summary (no LLM needed)
  const summary = content.slice(0, 500).trim();
  // Extract basic keywords from filename
  const keywords = filename.replace(/[._\-/\\]/g, ' ').trim();

  return { vector, summary, keywords };
}

/**
 * Embed an image file directly using Gemini Embedding 2's multimodal support.
 */
async function embedImageContent(
  filename: string,
  base64: string,
  mimeType: string
): Promise<{ vector: number[]; summary: string; keywords: string } | null> {
  try {
    // Use the Gemini API directly for multimodal embedding since AI SDK embed()
    // only accepts text values. We call the REST endpoint.
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[file-indexing] No Google API key for multimodal embedding');
      return null;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: {
            parts: [
              { text: filename },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[file-indexing] Multimodal embedding failed (${response.status}):`, errText);
      return null;
    }

    const data: any = await response.json();
    const vector: number[] = data?.embedding?.values;
    if (!vector || vector.length === 0) return null;

    const summary = `Image: ${filename}`;
    const keywords = `image, ${filename.replace(/[._\-/\\]/g, ' ')}`;

    return { vector, summary, keywords };
  } catch (error) {
    console.error(`[file-indexing] Image embedding failed for ${filename}:`, error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INDEX UPDATE
// ═══════════════════════════════════════════════════════════════════════════════

async function updateFileIndex(
  fileId: string,
  summary: string,
  keywords: string,
  vector: number[]
): Promise<boolean> {
  try {
    const result = await execLocalTool('file_index_update', {
      file_id: fileId,
      summary,
      keywords,
      vector,
      summary_model: 'none',
      embedding_model: EMBEDDING_MODEL,
    });
    return result?.ok === true;
  } catch (error) {
    console.error(`[file-indexing] Failed to update index for ${fileId}:`, error);
    return false;
  }
}

async function markFileError(fileId: string, errorMessage: string): Promise<void> {
  try {
    await execLocalTool('file_index_mark_error', {
      file_id: fileId,
      error_message: errorMessage,
    });
  } catch (error) {
    console.error(`[file-indexing] Failed to mark error for ${fileId}:`, error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILE PROCESSING
// ═══════════════════════════════════════════════════════════════════════════════

async function processFile(file: PendingFile): Promise<{ summary: string; keywords: string; vector: number[] } | null> {
  // Image files — use multimodal embedding directly
  if (IMAGE_KINDS.has(file.kind) && IMAGE_EXTENSIONS.has(file.extension.toLowerCase()) && file.size <= MAX_IMAGE_SIZE) {
    const binaryData = await readFileBinary(file.path);
    if (binaryData) {
      return embedImageContent(file.filename, binaryData.base64, binaryData.mimeType);
    }
  }

  // Text/code files — chunk and embed
  if (EMBEDDABLE_TEXT_KINDS.has(file.kind)) {
    const content = await readFileContent(file.path);
    if (content) {
      return embedTextContent(file.filename, content);
    }
  }

  // Metadata-only fallback (binary, archive, video, etc.)
  const ext = file.extension?.replace('.', '') || 'unknown';
  const sizeKB = Math.round(file.size / 1024);
  const metaText = `${file.filename} ${ext} ${file.kind} ${sizeKB}KB`;
  const vector = await generateEmbedding(metaText);
  if (!vector) return null;

  return {
    summary: `${file.kind} file: ${file.filename} (${sizeKB}KB)`,
    keywords: `${file.filename.replace(/[._-]/g, ' ')} ${ext} ${file.kind}`,
    vector,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export interface IndexingProgress {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  currentFile?: string;
}

export type ProgressCallback = (progress: IndexingProgress) => void;

/**
 * Process pending files from the local index.
 * Chunks large files and embeds all chunks in parallel using Gemini Embedding 2.
 */
export async function processPendingFiles(
  limit: number = 50,
  onProgress?: ProgressCallback
): Promise<IndexingProgress> {
  if (!hasClientBridge()) {
    throw new Error('No client bridge available');
  }

  const pendingResult = await execLocalTool('file_index_get_pending', { limit });
  if (!pendingResult?.ok || !pendingResult?.files) {
    throw new Error('Failed to get pending files');
  }

  const files: PendingFile[] = pendingResult.files;

  const progress: IndexingProgress = {
    total: files.length,
    processed: 0,
    successful: 0,
    failed: 0,
  };

  if (files.length === 0) {
    return progress;
  }

  // Process in batches
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);

    // Process files in parallel within each batch
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        progress.currentFile = file.filename;
        onProgress?.(progress);
        return { file, result: await processFile(file) };
      })
    );

    for (const settled of results) {
      if (settled.status === 'rejected' || !settled.value.result) {
        const file = settled.status === 'fulfilled' ? settled.value.file : batch[0];
        const err = settled.status === 'rejected' ? String(settled.reason) : 'Embedding generation failed';
        await markFileError(file.id, err);
        progress.processed++;
        progress.failed++;
        onProgress?.(progress);
        continue;
      }

      const { file, result } = settled.value;
      const updated = await updateFileIndex(file.id, result.summary, result.keywords, result.vector);
      progress.processed++;
      if (updated) {
        progress.successful++;
      } else {
        progress.failed++;
        await markFileError(file.id, 'Failed to update index');
      }
      onProgress?.(progress);
    }
  }

  progress.currentFile = undefined;
  return progress;
}

/**
 * Get the current index statistics.
 */
export async function getIndexStats(): Promise<any> {
  if (!hasClientBridge()) {
    return null;
  }

  const result = await execLocalTool('file_index_stats', {});
  return result?.ok ? result : null;
}

/**
 * Trigger a scan of an indexed root folder.
 */
export async function triggerScan(rootIdOrPath: string): Promise<any> {
  if (!hasClientBridge()) {
    throw new Error('No client bridge available');
  }

  const args = rootIdOrPath.includes('/') || rootIdOrPath.includes('\\')
    ? { path: rootIdOrPath }
    : { root_id: rootIdOrPath };

  const result = await execLocalTool('file_index_scan', args);
  return result;
}

/**
 * Search indexed files.
 */
export async function searchFiles(
  query: string,
  options: {
    mode?: 'quick' | 'semantic' | 'hybrid';
    kind?: string;
    limit?: number;
  } = {}
): Promise<any> {
  if (!hasClientBridge()) {
    throw new Error('No client bridge available');
  }

  const { mode = 'hybrid', kind, limit = 20 } = options;

  let vector: number[] | undefined;
  if (mode === 'semantic' || mode === 'hybrid') {
    const embedding = await generateEmbedding(query);
    if (embedding) {
      vector = embedding;
    }
  }

  const result = await execLocalTool('file_search', {
    query,
    vector,
    mode,
    kind,
    limit,
  }, undefined, 300000, { silent: true });

  return result;
}
