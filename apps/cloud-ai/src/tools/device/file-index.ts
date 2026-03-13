import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { hasClientBridge, makeLocalTool } from './shared';
import * as fileIndexingService from '../../services/file-indexing';

export const file_index_add_root = makeLocalTool(
  'file_index_add_root',
  'Add a folder to the file search index. Users can select folders like Downloads, Documents, Desktop to be indexed for semantic search.',
  z.object({
    path: z.string().describe('Full path to the folder to index'),
    schedule: z
      .enum(['off', 'hourly', 'daily', 'weekly', 'custom'])
      .default('daily')
      .describe('How often to re-scan this folder'),
    interval_hours: z.number().optional().describe('Custom interval in hours (only for schedule=custom)'),
  }),
  z.object({
    ok: z.boolean(),
    root: z.any().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
);

export const file_index_remove_root = makeLocalTool(
  'file_index_remove_root',
  'Remove a folder from the file search index.',
  z.object({
    root_id: z.string().optional().describe('ID of the root to remove'),
    path: z.string().optional().describe('Path of the root to remove'),
  }),
  z.object({ ok: z.boolean() }),
);

export const file_index_list_roots = makeLocalTool(
  'file_index_list_roots',
  'List all indexed root folders.',
  z.object({
    enabled_only: z.boolean().optional().default(false),
  }),
  z.object({
    ok: z.boolean(),
    roots: z.array(z.any()),
  }),
);

export const file_index_scan = makeLocalTool(
  'file_index_scan',
  'Scan an indexed root folder for new/changed files. This is an async operation that can take a while for large folders.',
  z.object({
    root_id: z.string().optional().describe('ID of the root to scan'),
    path: z.string().optional().describe('Path of the root to scan'),
    compute_hashes: z.boolean().optional().default(true).describe('Compute content hashes for change detection'),
    max_files: z.number().optional().describe('Max files to process (for incremental scans)'),
  }),
  z.object({
    ok: z.boolean(),
    progress: z.any().optional(),
    error: z.string().optional(),
  }),
  120000,
);

export const file_index_get_pending = makeLocalTool(
  'file_index_get_pending',
  'Get files that are pending indexing (need summarization/embedding).',
  z.object({
    limit: z.number().optional().default(100),
  }),
  z.object({
    ok: z.boolean(),
    files: z.array(z.any()),
    count: z.number(),
  }),
);

export const file_index_stats = makeLocalTool(
  'file_index_stats',
  'Get statistics about the file index (total files, indexed count, pending count, etc.).',
  z.object({}),
  z.object({
    ok: z.boolean(),
    roots: z.number().optional(),
    total_files: z.number().optional(),
    indexed_files: z.number().optional(),
    pending_files: z.number().optional(),
    folders: z.number().optional(),
    files_by_kind: z.any().optional(),
  }),
);

export const file_index_update = makeLocalTool(
  'file_index_update',
  'Update a file with its summary, keywords, and vector embedding after cloud processing.',
  z.object({
    file_id: z.string().describe('ID of the file to update'),
    summary: z.string().describe('AI-generated summary of the file content'),
    keywords: z.string().describe('Comma-separated keywords'),
    vector: z.array(z.number()).describe('Embedding vector (3072 dimensions)'),
    summary_model: z.string().optional().default('none'),
    embedding_model: z.string().optional().default('gemini-embedding-2-preview'),
  }),
  z.object({ ok: z.boolean() }),
);

export const file_index_mark_error = makeLocalTool(
  'file_index_mark_error',
  'Mark a file as having an error during indexing.',
  z.object({
    file_id: z.string().describe('ID of the file to mark as errored'),
    error_message: z.string().describe('Error message to store'),
  }),
  z.object({ ok: z.boolean() }),
);

export const file_search = makeLocalTool(
  'file_search',
  'Search indexed files using hybrid FTS + vector search. Supports quick filename search (instant) and semantic concept search (requires embeddings).',
  z.object({
    query: z.string().optional().describe('Search query text'),
    vector: z.array(z.number()).optional().describe('Query embedding vector for semantic search'),
    mode: z
      .enum(['quick', 'semantic', 'hybrid'])
      .optional()
      .default('hybrid')
      .describe('Search mode: quick=FTS only, semantic=vector only, hybrid=both'),
    kind: z
      .enum(['document', 'image', 'video', 'audio', 'code', 'binary', 'archive', 'other'])
      .optional()
      .describe('Filter by file type'),
    root_id: z.string().optional().describe('Filter by indexed root'),
    limit: z.number().optional().default(20),
  }),
  z.object({
    ok: z.boolean(),
    results: z.array(z.any()),
    count: z.number(),
    mode: z.string().optional(),
    error: z.string().optional(),
  }),
);

export const file_search_by_filename = makeLocalTool(
  'file_search_by_filename',
  'Quick filename search. Works instantly without waiting for AI indexing.',
  z.object({
    query: z.string().describe('Filename to search for'),
    kind: z.enum(['document', 'image', 'video', 'audio', 'code', 'binary', 'archive', 'other']).optional(),
    root_id: z.string().optional(),
    limit: z.number().optional().default(50),
  }),
  z.object({
    ok: z.boolean(),
    results: z.array(z.any()),
    count: z.number(),
  }),
);

export const file_search_by_kind = makeLocalTool(
  'file_search_by_kind',
  'Search files by type (documents, images, videos, etc.).',
  z.object({
    kind: z
      .enum(['document', 'image', 'video', 'audio', 'code', 'binary', 'archive', 'other'])
      .describe('File type to search for'),
    root_id: z.string().optional(),
    limit: z.number().optional().default(100),
  }),
  z.object({
    ok: z.boolean(),
    results: z.array(z.any()),
    count: z.number(),
  }),
);

export const file_search_recent = makeLocalTool(
  'file_search_recent',
  'Get recently modified files.',
  z.object({
    kind: z.enum(['document', 'image', 'video', 'audio', 'code', 'binary', 'archive', 'other']).optional(),
    root_id: z.string().optional(),
    limit: z.number().optional().default(50),
  }),
  z.object({
    ok: z.boolean(),
    results: z.array(z.any()),
    count: z.number(),
  }),
);

export const file_search_details = makeLocalTool(
  'file_search_details',
  'Get detailed information about a specific indexed file.',
  z.object({
    file_id: z.string().optional().describe('ID of the file'),
    path: z.string().optional().describe('Path of the file'),
  }),
  z.object({
    ok: z.boolean(),
    file: z.any().optional(),
    error: z.string().optional(),
  }),
);

export const file_search_similar = makeLocalTool(
  'file_search_similar',
  'Find files similar to a given file using vector similarity.',
  z.object({
    file_id: z.string().optional().describe('ID of the reference file'),
    path: z.string().optional().describe('Path of the reference file'),
    limit: z.number().optional().default(10),
  }),
  z.object({
    ok: z.boolean(),
    reference: z.any().optional(),
    similar: z.array(z.any()).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
);

export const process_pending_file_index = createTool({
  id: 'process_pending_file_index',
  description:
    'Process pending files in the index by chunking content and generating embeddings using Gemini Embedding 2. Images are embedded directly via multimodal embedding. For large volumes (>100 files), use process_pending_file_index_batch instead.',
  inputSchema: z.object({
    limit: z.number().optional().default(20).describe('Max files to process in this batch'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    total: z.number().optional(),
    processed: z.number().optional(),
    successful: z.number().optional(),
    failed: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, { writer }) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const limit = c.limit || 20;

      await (writer as any)?.write?.({
        type: 'tool_event',
        tool: 'process_pending_file_index',
        status: 'starting',
        limit,
      });

      const result = await fileIndexingService.processPendingFiles(limit, (progress) => {
        // Stream progress updates
        (writer as any)?.write?.({
          type: 'tool_event',
          tool: 'process_pending_file_index',
          status: 'processing',
          ...progress,
        });
      });

      return {
        ok: true,
        total: result.total,
        processed: result.processed,
        successful: result.successful,
        failed: result.failed,
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const process_pending_file_index_batch = createTool({
  id: 'process_pending_file_index_batch',
  description:
    'Process a large number of pending files using parallel chunking and Gemini Embedding 2. Handles higher limits than process_pending_file_index. Images are embedded directly via multimodal embedding.',
  inputSchema: z.object({
    limit: z.number().optional().default(500).describe('Max files to process'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    count: z.number().optional(),
    total: z.number().optional(),
    successful: z.number().optional(),
    failed: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, { writer }) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      await (writer as any)?.write?.({
        type: 'tool_event',
        tool: 'process_pending_file_index_batch',
        status: 'processing',
        limit: c.limit || 500,
      });

      const result = await fileIndexingService.processPendingFiles(c.limit || 500);

      return {
        ok: true,
        count: result.successful,
        total: result.total,
        successful: result.successful,
        failed: result.failed,
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const semantic_file_search = createTool({
  id: 'semantic_file_search',
  description:
    "Search indexed files using semantic search. This embeds the query and finds files by concept similarity, not just keyword matching. Use this to find files related to a topic even if they don't contain the exact search terms.",
  inputSchema: z.object({
    query: z
      .string()
      .describe('Natural language search query (e.g., "python scripts for data processing", "photos from vacation")'),
    kind: z
      .enum(['document', 'image', 'video', 'audio', 'code', 'binary', 'archive', 'other'])
      .optional()
      .describe('Filter by file type'),
    limit: z.number().optional().default(10),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    results: z.array(z.any()).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, { writer }) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      await (writer as any)?.write?.({ type: 'tool_event', tool: 'semantic_file_search', status: 'embedding_query' });

      const result = await fileIndexingService.searchFiles(c.query, {
        mode: 'hybrid',
        kind: c.kind,
        limit: c.limit || 10,
      });

      if (!result?.ok) {
        return { ok: false, error: result?.error || 'Search failed' };
      }

      return {
        ok: true,
        results: result.results,
        count: result.count,
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});
