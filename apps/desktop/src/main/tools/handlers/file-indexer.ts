/**
 * Local tool handlers that route file-index / file-search tool calls directly
 * to the Rust `stuard-file-indexer` binary instead of bouncing through the
 * Python agent. Keeps the launcher and renderer fast and agent-independent.
 */

import {
  listRoots,
  addRoot,
  removeRoot,
  getStats,
  scanRoot,
  searchFiles,
  listFolderContents,
  getPendingFiles,
  updateFileEmbedding,
  markFileEmbeddingError,
  type SearchMode,
} from "../../services/file-indexing";
import logger from "../../utils/logger";

export const RUST_FILE_TOOLS = new Set<string>([
  "file_index_add_root",
  "file_index_remove_root",
  "file_index_list_roots",
  "file_index_scan",
  "file_index_stats",
  "file_index_get_pending",
  "file_index_update",
  "file_index_mark_error",
  "file_search",
  "file_search_by_filename",
  "file_search_by_extension",
  "file_search_by_kind",
  "file_search_recent",
  "file_search_folder",
]);

export function isRustFileTool(toolName: string): boolean {
  return RUST_FILE_TOOLS.has(toolName);
}

export async function execRustFileTool(toolName: string, args: any): Promise<any> {
  try {
    switch (toolName) {
      case "file_index_add_root": {
        const pathArg = String(args?.path || "").trim();
        if (!pathArg) return { ok: false, error: "missing path" };
        const schedule = (args?.schedule as any) || "daily";
        const intervalHours = typeof args?.interval_hours === "number" ? args.interval_hours : undefined;
        const root = await addRoot(pathArg, schedule, intervalHours);
        return root ? { ok: true, root } : { ok: false, error: "add_root_failed" };
      }

      case "file_index_remove_root": {
        const rootId = String(args?.root_id || args?.rootId || "").trim();
        if (!rootId) return { ok: false, error: "missing root_id" };
        const ok = await removeRoot(rootId);
        return { ok };
      }

      case "file_index_list_roots": {
        const roots = await listRoots();
        return { ok: true, roots };
      }

      case "file_index_scan": {
        const rootId = String(args?.root_id || args?.rootId || "").trim();
        if (!rootId) return { ok: false, error: "missing root_id" };
        const progress = await scanRoot(rootId);
        return progress ? { ok: true, progress } : { ok: false, error: "scan_failed" };
      }

      case "file_index_stats": {
        const stats = await getStats();
        return stats || { ok: false, error: "stats_unavailable" };
      }

      case "file_search":
      case "file_search_by_filename":
      case "file_search_by_kind": {
        const query = String(args?.query || "").trim();
        const kind = args?.kind ? String(args.kind) : undefined;
        const rootId = args?.root_id ? String(args.root_id) : undefined;
        const limit = Number(args?.limit) || 50;
        // Semantic/hybrid: caller (launcher / cloud) supplies a precomputed
        // query embedding. Only `file_search` carries a vector; the
        // by_filename / by_kind aliases stay keyword-only.
        const vector =
          toolName === "file_search" && Array.isArray(args?.vector) && args.vector.length > 0
            ? (args.vector as number[])
            : undefined;
        const mode: SearchMode | undefined =
          toolName === "file_search" && typeof args?.mode === "string"
            ? (args.mode as SearchMode)
            : undefined;
        const results = await searchFiles(query, { kind, rootId, limit, vector, mode });
        return { ok: true, results, count: results.length, mode: mode || "quick" };
      }

      case "file_index_get_pending": {
        const rootId = args?.root_id ? String(args.root_id) : undefined;
        const limit = Number(args?.limit) || 500;
        const files = await getPendingFiles(rootId, limit);
        return { ok: true, files, count: files.length };
      }

      case "file_index_update": {
        const fileId = String(args?.file_id || "").trim();
        if (!fileId) return { ok: false, error: "missing file_id" };
        const vector = Array.isArray(args?.vector) ? (args.vector as number[]) : [];
        if (vector.length === 0) return { ok: false, error: "missing vector" };
        const ok = await updateFileEmbedding({
          fileId,
          vector,
          summary: args?.summary ? String(args.summary) : undefined,
          keywords: args?.keywords ? String(args.keywords) : undefined,
          embeddingModel: args?.embedding_model ? String(args.embedding_model) : undefined,
        });
        return { ok };
      }

      case "file_index_mark_error": {
        const fileId = String(args?.file_id || "").trim();
        if (!fileId) return { ok: false, error: "missing file_id" };
        const ok = await markFileEmbeddingError(fileId, String(args?.error_message || "indexing error"));
        return { ok };
      }

      case "file_search_by_extension": {
        const extRaw = String(args?.extension || args?.ext || "").trim().toLowerCase();
        if (!extRaw) return { ok: false, error: "missing extension" };
        const ext = extRaw.startsWith(".") ? extRaw : `.${extRaw}`;
        const rootId = args?.root_id ? String(args.root_id) : undefined;
        const limit = Number(args?.limit) || 100;
        // Rust search uses tokenized matching — searching for the bare extension string finds files by path/filename.
        const results = await searchFiles(ext, { rootId, limit });
        const filtered = results.filter((r) => (r.extension || "").toLowerCase() === ext);
        return { ok: true, results: filtered, count: filtered.length };
      }

      case "file_search_recent": {
        // No direct subcommand — fall back to empty list for now; the launcher does not rely on this.
        return { ok: true, results: [], count: 0 };
      }

      case "file_search_folder": {
        const folderPath = String(args?.path || "").trim();
        if (!folderPath) return { ok: false, error: "missing path" };
        const recursive = !!args?.recursive;
        const limit = Number(args?.limit) || 200;
        const files = await listFolderContents(folderPath, { recursive, limit });
        return { ok: true, path: folderPath, files, count: files.length };
      }

      default:
        return { ok: false, error: `unknown_rust_file_tool: ${toolName}` };
    }
  } catch (err: any) {
    logger.warn(`[rust-file-tool] ${toolName} failed:`, err);
    return { ok: false, error: String(err?.message || err || "rust_file_tool_failed") };
  }
}
