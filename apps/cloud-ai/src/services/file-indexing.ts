/**
 * File Indexing Service
 * 
 * Processes pending files from the local agent:
 * 1. Reads file content via agent bridge
 * 2. Generates summaries using Gemini
 * 3. Creates embeddings using text-embedding-3-large
 * 4. Updates the local file index via agent
 * 
 * Uses batch processing for efficiency and cost savings.
 */

import { embed, embedMany, generateText } from 'ai';
import { google } from '../utils/models';
import { openai } from '@ai-sdk/openai';
import { buildProviderModel } from '../utils/models';
import { getDefaultModelForCategory } from '../pricing';
import { execLocalTool, hasClientBridge, getBridgeSecrets } from '../tools/bridge';
import * as geminiBatch from './gemini-batch';
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

const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_DIMENSIONS = 3072;
const SUMMARY_MODEL_ID = getDefaultModelForCategory('fast');

const MAX_CONTENT_CHARS = 15000; // Max chars to send for summarization
const BATCH_SIZE = 10; // Files per batch
const MAX_RETRIES = 2;

// File types that should be summarized vs metadata-only
const SUMMARIZABLE_KINDS = new Set(['document', 'code']);
const VISION_KINDS = new Set(['image', 'video']);
const METADATA_ONLY_KINDS = new Set(['binary', 'archive']);

// Image extensions supported by Gemini vision
const VISION_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB max for vision API

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
    const result = await execLocalTool('read_file', { path, line_start: 1, line_end: 500 });
    if (!result?.ok || !result?.content) {
      return null;
    }
    let content = String(result.content);
    if (content.length > maxChars) {
      content = content.slice(0, maxChars) + '\n...[truncated]';
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
// SUMMARIZATION
// ═══════════════════════════════════════════════════════════════════════════════

const SUMMARY_PROMPT = `You are a file summarizer. Given a file's content, generate:
1. A concise summary (2-4 sentences) describing what this file contains/does
2. A comma-separated list of relevant keywords (5-15 keywords)

Format your response EXACTLY as:
SUMMARY: [your summary here]
KEYWORDS: [keyword1, keyword2, keyword3, ...]

Focus on the main purpose, key concepts, and searchable terms. For code files, mention the language, main functionality, and key dependencies.`;

const IMAGE_SUMMARY_PROMPT = `You are an image analyzer. Describe this image concisely for a file search index.

Generate:
1. A brief description (2-3 sentences) of what's in the image
2. Keywords for searching (objects, colors, people, activities, locations, mood, style)

Format your response EXACTLY as:
SUMMARY: [your description here]
KEYWORDS: [keyword1, keyword2, keyword3, ...]

Be specific about visible objects, people, text, colors, and the setting. Include searchable terms a user might use to find this image.`;

async function generateFileSummary(
  filename: string,
  content: string,
  kind: string
): Promise<{ summary: string; keywords: string } | null> {
  try {
    const prompt = `${SUMMARY_PROMPT}

File: ${filename}
Type: ${kind}
Content:
${content}`;

    const summaryModel = buildProviderModel(SUMMARY_MODEL_ID);
    const result = await generateText({
      model: summaryModel as any,
      prompt,
      temperature: 0.3,
      maxOutputTokens: 300,
    });

    const text = result.text || '';
    
    // Parse the response
    const summaryMatch = text.match(/SUMMARY:\s*(.+?)(?=KEYWORDS:|$)/is);
    const keywordsMatch = text.match(/KEYWORDS:\s*(.+?)$/is);
    
    const summary = summaryMatch?.[1]?.trim() || `File: ${filename}`;
    const keywords = keywordsMatch?.[1]?.trim() || filename.replace(/[._-]/g, ', ');
    
    return { summary, keywords };
  } catch (error) {
    console.error(`[file-indexing] Summary generation failed for ${filename}:`, error);
    return null;
  }
}

async function generateImageSummary(
  filename: string,
  base64: string,
  mimeType: string
): Promise<{ summary: string; keywords: string } | null> {
  try {
    // Convert base64 to data URL format expected by AI SDK
    const dataUrl = `data:${mimeType};base64,${base64}`;
    
    const summaryModel = buildProviderModel(SUMMARY_MODEL_ID);
    const result = await generateText({
      model: summaryModel as any,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `${IMAGE_SUMMARY_PROMPT}\n\nFilename: ${filename}` },
            { type: 'image', image: dataUrl },
          ],
        },
      ],
      temperature: 0.3,
      maxOutputTokens: 300,
    });

    const text = result.text || '';
    
    // Parse the response
    const summaryMatch = text.match(/SUMMARY:\s*(.+?)(?=KEYWORDS:|$)/is);
    const keywordsMatch = text.match(/KEYWORDS:\s*(.+?)$/is);
    
    const summary = summaryMatch?.[1]?.trim() || `Image: ${filename}`;
    const keywords = keywordsMatch?.[1]?.trim() || `image, ${filename.replace(/[._-]/g, ', ')}`;
    
    return { summary, keywords };
  } catch (error) {
    console.error(`[file-indexing] Image summary generation failed for ${filename}:`, error);
    return null;
  }
}

function generateMetadataSummary(file: PendingFile): { summary: string; keywords: string } {
  // For non-summarizable files, create a simple metadata-based summary
  const ext = file.extension?.replace('.', '') || 'unknown';
  const sizeKB = Math.round(file.size / 1024);
  
  const summary = `${file.kind} file: ${file.filename} (${sizeKB}KB)`;
  const keywords = [
    file.filename.replace(/[._-]/g, ' '),
    ext,
    file.kind,
  ].filter(Boolean).join(', ');
  
  return { summary, keywords };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMBEDDING
// ═══════════════════════════════════════════════════════════════════════════════

async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const result = await embed({
      model: openai.embedding(EMBEDDING_MODEL),
      value: text,
    });
    return result.embedding;
  } catch (error) {
    console.error('[file-indexing] Embedding generation failed:', error);
    return null;
  }
}

async function generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
  try {
    const result = await embedMany({
      model: openai.embedding(EMBEDDING_MODEL),
      values: texts,
    });
    return result.embeddings;
  } catch (error) {
    console.error('[file-indexing] Batch embedding generation failed:', error);
    return texts.map(() => null);
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
      summary_model: SUMMARY_MODEL_ID,
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
// BATCH PROCESSING
// ═══════════════════════════════════════════════════════════════════════════════

async function prepareFileForIndexing(file: PendingFile): Promise<{ summary: string; keywords: string; embeddingText: string }> {
  let summary: string;
  let keywords: string;

  // Determine processing strategy based on file kind
  if (VISION_KINDS.has(file.kind) && VISION_EXTENSIONS.has(file.extension.toLowerCase()) && file.size <= MAX_IMAGE_SIZE) {
    // Use Gemini Vision for images
    const binaryData = await readFileBinary(file.path);

    if (binaryData) {
      const summaryResult = await generateImageSummary(file.filename, binaryData.base64, binaryData.mimeType);
      if (summaryResult) {
        summary = summaryResult.summary;
        keywords = summaryResult.keywords;
      } else {
        const meta = generateMetadataSummary(file);
        summary = meta.summary;
        keywords = meta.keywords;
      }
    } else {
      const meta = generateMetadataSummary(file);
      summary = meta.summary;
      keywords = meta.keywords;
    }
  } else if (SUMMARIZABLE_KINDS.has(file.kind) && !METADATA_ONLY_KINDS.has(file.kind)) {
    const content = await readFileContent(file.path);

    if (content) {
      const summaryResult = await generateFileSummary(file.filename, content, file.kind);
      if (summaryResult) {
        summary = summaryResult.summary;
        keywords = summaryResult.keywords;
      } else {
        const meta = generateMetadataSummary(file);
        summary = meta.summary;
        keywords = meta.keywords;
      }
    } else {
      const meta = generateMetadataSummary(file);
      summary = meta.summary;
      keywords = meta.keywords;
    }
  } else {
    const meta = generateMetadataSummary(file);
    summary = meta.summary;
    keywords = meta.keywords;
  }

  const embeddingText = `${file.filename}\n${summary}\n${keywords}`;
  return { summary, keywords, embeddingText };
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
 * This should be called periodically or triggered after a scan completes.
 */
export async function processPendingFiles(
  limit: number = 50,
  onProgress?: ProgressCallback
): Promise<IndexingProgress> {
  if (!hasClientBridge()) {
    throw new Error('No client bridge available');
  }
  
  // Get pending files from agent
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

  // Process in batches; summaries are per-file, embeddings use embedMany for efficiency.
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);

    const prepared: Array<{ file: PendingFile; summary: string; keywords: string; embeddingText: string } | null> = [];
    for (const file of batch) {
      try {
        progress.currentFile = file.filename;
        onProgress?.(progress);
        const p = await prepareFileForIndexing(file);
        prepared.push({ file, ...p });
      } catch (error) {
        prepared.push(null);
        await markFileError(file.id, String(error));
        progress.processed++;
        progress.failed++;
        onProgress?.(progress);
      }
    }

    const embeddingTexts = prepared.filter(Boolean).map((p) => (p as any).embeddingText as string);
    const embeddings = embeddingTexts.length > 0 ? await generateEmbeddings(embeddingTexts) : [];

    let embIdx = 0;
    for (const p of prepared) {
      if (!p) continue;

      const vectorFromBatch = embeddings[embIdx] || null;
      embIdx++;

      let vector = vectorFromBatch;
      if (!vector) {
        // Fallback to single embedding for this one file
        vector = await generateEmbedding(p.embeddingText);
      }

      if (!vector) {
        await markFileError(p.file.id, 'Embedding generation failed');
        progress.processed++;
        progress.failed++;
        onProgress?.(progress);
        continue;
      }

      const updated = await updateFileIndex(p.file.id, p.summary, p.keywords, vector);
      progress.processed++;
      if (updated) {
        progress.successful++;
      } else {
        progress.failed++;
        await markFileError(p.file.id, 'Failed to update index');
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
 * Starts a batch indexing job for pending files.
 */
export async function startBatchIndexing(limit: number = 500): Promise<{ ok: boolean; jobId?: string; count?: number }> {
  if (!hasClientBridge()) throw new Error('No client bridge available');

  // 1. Get pending files
  const pendingResult = await execLocalTool('file_index_get_pending', { limit });
  if (!pendingResult?.ok || !pendingResult?.files) {
    throw new Error('Failed to get pending files');
  }

  const files: PendingFile[] = pendingResult.files;
  if (files.length === 0) return { ok: true, count: 0 };

  // 2. Prepare batch requests
  const requests: geminiBatch.BatchRequest[] = [];
  const fileMap: Record<string, PendingFile> = {};

  for (const file of files) {
    fileMap[file.id] = file;
    
    let prompt = '';
    let inlineData: any = undefined;

    if (VISION_KINDS.has(file.kind) && VISION_EXTENSIONS.has(file.extension.toLowerCase()) && file.size <= MAX_IMAGE_SIZE) {
      const binaryData = await readFileBinary(file.path);
      if (binaryData) {
        prompt = `${IMAGE_SUMMARY_PROMPT}\n\nFilename: ${file.filename}`;
        inlineData = { mime_type: binaryData.mimeType, data: binaryData.base64 };
      }
    } else if (SUMMARIZABLE_KINDS.has(file.kind) && !METADATA_ONLY_KINDS.has(file.kind)) {
      const content = await readFileContent(file.path);
      if (content) {
        prompt = `${SUMMARY_PROMPT}\n\nFile: ${file.filename}\nType: ${file.kind}\nContent:\n${content}`;
      }
    }

    if (prompt) {
      const parts: any[] = [{ text: prompt }];
      if (inlineData) parts.push({ inline_data: inlineData });

      requests.push({
        key: file.id,
        request: {
          contents: [{ role: 'user', parts }]
        }
      });
    } else {
      // Fallback for non-summarizable files (should we even put them in batch? probably not, just process metadata locally)
      // For simplicity, we'll only batch files that need AI summary
    }
  }

  if (requests.length === 0) {
    // If nothing to batch, maybe they are all metadata-only?
    // We could process them synchronously here or just skip.
    return { ok: true, count: 0 };
  }

  // 3. Create Batch Job
  const fileMetadata = files.reduce((acc, f) => {
    acc[f.id] = { filename: f.filename };
    return acc;
  }, {} as Record<string, { filename: string }>);

  // Get user ID from bridge context for multi-tenancy
  const secrets = getBridgeSecrets();
  const userId = secrets?.userId as string | undefined;

  const job = await geminiBatch.createBatchJob(
    requests, 
    SUMMARY_MODEL_ID.replace('google/', ''), 
    `Indexing-${new Date().toISOString()}`,
    { fileMetadata },
    userId
  );
  
  return { ok: true, jobId: job.id, count: requests.length };
}

/**
 * Polls all pending batch jobs and applies results if finished.
 */
export async function syncBatchJobs(): Promise<{ updated: number; active: number }> {
  const { data: jobs, error } = await getSupabase()
    .from('gemini_batch_jobs')
    .select('id, status')
    .in('status', ['JOB_STATE_PENDING', 'JOB_STATE_RUNNING']);

  if (error || !jobs) return { updated: 0, active: 0 };

  let updatedCount = 0;
  for (const job of jobs) {
    const updatedJob = await geminiBatch.pollBatchJob(job.id);
    if (updatedJob.status === 'JOB_STATE_SUCCEEDED') {
      await applyBatchResults(updatedJob.id);
      updatedCount++;
    }
  }

  return { updated: updatedCount, active: jobs.length };
}

/**
 * Downloads results for a job and updates the local file index.
 */
async function applyBatchResults(id: string): Promise<void> {
  const { data: job } = await getSupabase().from('gemini_batch_jobs').select('metadata').eq('id', id).single();
  const fileMetadata = job?.metadata?.fileMetadata || {};

  const results = await geminiBatch.getBatchResults(id);
  
  for (const item of results) {
    const fileId = item.responseId || item.key; // Use key we provided
    if (!fileId) continue;

    try {
      const text = item.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) continue;

      // Parse summary and keywords
      const summaryMatch = text.match(/SUMMARY:\s*(.+?)(?=KEYWORDS:|$)/is);
      const keywordsMatch = text.match(/KEYWORDS:\s*(.+?)$/is);
      
      const summary = summaryMatch?.[1]?.trim();
      const keywords = keywordsMatch?.[1]?.trim();

      if (summary && keywords) {
        // We still need to generate embeddings. 
        const filename = fileMetadata[fileId]?.filename || '';
        const embeddingText = `${filename}\n${summary}\n${keywords}`;
        const vector = await generateEmbedding(embeddingText);
        
        if (vector) {
          await updateFileIndex(fileId, summary, keywords, vector);
        }
      }
    } catch (error) {
      console.error(`[file-indexing] Failed to apply batch result for ${fileId}:`, error);
      await markFileError(fileId, String(error));
    }
  }
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
  
  // For semantic/hybrid search, we need to embed the query
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
  });
  
  return result;
}
