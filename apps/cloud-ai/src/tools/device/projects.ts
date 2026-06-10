/**
 * Project Mode tools — successor to Spaces.
 *
 * - enter_project_mode / exit_project_mode: stamp the current conversation
 *   with a project_id (or clear it). The conversation row IS the session state.
 * - list_projects: lightweight project picker for the AI.
 * - journal_add: append a timestamped entry to a project's timeline.
 * - memory_add: write a project-scoped (or global) memory with auto-embedding.
 * - add_project_context / project_search: attach files/folders and search both
 *   project notes and scoped file-index content. Embeddings are generated
 *   cloud-side; storage + search happens on the desktop SQLite.
 *
 * Conversation context: `conversation_id` is currently a required input
 * because Mastra doesn't expose it on the tool execute context. Phase 3
 * injects the current conversation_id into the system prompt so the AI knows
 * what to pass.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import path from 'node:path';
import { execLocalTool, hasClientBridge } from './shared';
import { generateEmbedding } from '../../memory/conversations';
import * as fileIndexingService from '../../services/file-indexing';

const ERR_NO_BRIDGE = 'No client bridge available';

function normalizeProjectPath(raw: string): string {
  return String(raw || '').trim().replace(/^file:\/+/, '');
}

function dirnameForLocalPath(raw: string): string | null {
  const p = normalizeProjectPath(raw);
  if (!p) return null;
  const parser = /^[a-zA-Z]:[\\/]/.test(p) || p.includes('\\') ? path.win32 : path;
  const dir = parser.dirname(p);
  return dir && dir !== '.' && dir !== p ? dir : null;
}

async function readPinnedFileAsMemory(projectId: string, filePath: string): Promise<any | null> {
  try {
    const readResult = await execLocalTool('read_file', {
      path: filePath,
      line_start: 1,
      line_end: 400,
    }, undefined, 60000, { silent: true });
    const content = String(readResult?.content || '').trim();
    if (!readResult?.ok || !content) return null;

    const normalizedForName = filePath.replace(/\\/g, '/');
    const title = `File context: ${path.basename(normalizedForName) || filePath}`;
    const body = `Path: ${filePath}\n\n${content.slice(0, 12000)}`;
    const embedding = await generateEmbedding(`${title}\n\n${body}`);

    return execLocalTool('memory_create', {
      type: 'file',
      title,
      content: body,
      project_ids: [projectId],
      metadata: { path: filePath, source: 'project_context_file' },
      source: 'tool',
      added_by: 'ai',
      embedding: embedding.length > 0 ? embedding : undefined,
    }, undefined, 60000, { silent: true });
  } catch {
    return null;
  }
}

async function attachProjectContextPath(
  projectId: string,
  rawPath: string,
  options: { processLimit?: number; scan?: boolean } = {},
): Promise<any> {
  const cleanPath = normalizeProjectPath(rawPath);
  if (!projectId) return { ok: false, error: 'missing project_id' };
  if (!cleanPath) return { ok: false, error: 'missing path' };

  const projectResult = await execLocalTool('project_get', { project_id: projectId });
  if (!projectResult?.ok || !projectResult.project) {
    return { ok: false, error: projectResult?.error || 'project_not_found' };
  }

  const current: string[] = Array.isArray(projectResult.project.pinned_paths)
    ? projectResult.project.pinned_paths
    : [];
  const alreadyPinned = current.includes(cleanPath);
  const next = alreadyPinned ? current : [...current, cleanPath];
  const updated = alreadyPinned
    ? projectResult
    : await execLocalTool('project_update', { project_id: projectId, pinned_paths: next });

  let contextKind: 'folder' | 'file' | 'path' = 'path';
  let root: any = null;
  let scan: any = null;
  let fileMemory: any = null;
  let embeddingProgress: any = null;

  const addRoot = await execLocalTool('file_index_add_root', {
    path: cleanPath,
    schedule: 'daily',
  }, undefined, 60000, { silent: true });

  if (addRoot?.ok && addRoot.root) {
    contextKind = 'folder';
    root = addRoot.root;
    if (options.scan !== false) {
      scan = await execLocalTool('file_index_scan', {
        root_id: root.id,
        compute_hashes: false,
      }, undefined, 300000, { silent: true });
      try {
        embeddingProgress = await fileIndexingService.processPendingFiles(options.processLimit ?? 75);
      } catch (error) {
        embeddingProgress = { ok: false, error: String(error) };
      }
    }
  } else {
    contextKind = 'file';
    fileMemory = await readPinnedFileAsMemory(projectId, cleanPath);

    const parent = dirnameForLocalPath(cleanPath);
    if (parent) {
      const parentRoot = await execLocalTool('file_index_add_root', {
        path: parent,
        schedule: 'daily',
      }, undefined, 60000, { silent: true });
      if (parentRoot?.ok && parentRoot.root) {
        root = parentRoot.root;
        if (options.scan !== false) {
          scan = await execLocalTool('file_index_scan', {
            root_id: root.id,
            compute_hashes: false,
          }, undefined, 300000, { silent: true });
          try {
            embeddingProgress = await fileIndexingService.processPendingFiles(options.processLimit ?? 25);
          } catch (error) {
            embeddingProgress = { ok: false, error: String(error) };
          }
        }
      }
    }
  }

  return {
    ok: !!updated?.ok || alreadyPinned,
    project: updated?.project || projectResult.project,
    pinned_paths: next,
    already_pinned: alreadyPinned,
    indexed: !!root,
    context_kind: contextKind,
    root,
    scan,
    file_memory: fileMemory?.memory || null,
    embedding_progress: embeddingProgress,
  };
}

export const list_projects = createTool({
  id: 'list_projects',
  description:
    'List the user\'s projects. Use this when you need to know what projects exist before entering project mode or to help the user pick one.',
  inputSchema: z.object({
    include_archived: z.boolean().optional().default(false),
    status: z.enum(['active', 'paused', 'archived']).optional(),
    limit: z.number().int().min(1).max(500).optional().default(100),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    projects: z.array(z.any()).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: ERR_NO_BRIDGE, projects: [] };
    return execLocalTool('project_list', {
      include_archived: c.include_archived ?? false,
      status: c.status,
      limit: c.limit ?? 100,
    });
  },
});

export const create_project = createTool({
  id: 'create_project',
  description:
    'Create a new project. Call this when the user says "start/create/make a project called X" or otherwise signals they want a fresh project. After creating, follow up with enter_project_mode using the returned project.id so the new project becomes active for this conversation. Pick a relevant emoji for `icon`; leave `color` unset to use the default focus-mode neutral.',
  inputSchema: z.object({
    name: z.string().describe('Display name for the project. Required.'),
    description: z.string().optional().describe('One-line description of what the project is.'),
    goals: z.string().optional().describe('What success looks like for this project.'),
    instructions: z
      .string()
      .optional()
      .describe('Standing project instructions applied to every chat in this project, similar to Claude Project instructions or Perplexity Space answer instructions.'),
    status: z.enum(['active', 'paused', 'archived']).optional().default('active'),
    icon: z.string().optional().describe('Emoji icon. Default 📁.'),
    color: z
      .string()
      .optional()
      .describe('Hex color like "#71717a". Omit to use the default neutral; only set if the user requested a specific color or one strongly matches the project.'),
    tags: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    project: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: ERR_NO_BRIDGE };
    if (!c.name || !String(c.name).trim()) {
      return { ok: false, error: 'missing name' };
    }

    // Embed name + description so list_projects later participates in semantic
    // recall. Best-effort: project creation must not fail because embedding did.
    const embedText = [c.name, c.description, c.goals, c.instructions].filter(Boolean).join('\n\n');
    let embedding: number[] = [];
    try {
      embedding = embedText ? await generateEmbedding(embedText) : [];
    } catch {
      embedding = [];
    }

    return execLocalTool('project_create', {
      name: String(c.name).trim(),
      description: c.description,
      goals: c.goals,
      instructions: c.instructions,
      status: c.status || 'active',
      icon: c.icon,
      color: c.color,
      tags: c.tags,
      embedding: embedding.length > 0 ? embedding : undefined,
    });
  },
});

export const update_project = createTool({
  id: 'update_project',
  description:
    'Update an existing project — name, description, goals, status, icon, color, tags, or the full pinned_paths list. Use this when the user asks to rename, pause, archive, or otherwise tweak project metadata. Only include the fields you intend to change. To add/remove a single file from the Files tab, prefer `pin_file` / `unpin_file` over rewriting the whole `pinned_paths` array here.',
  inputSchema: z.object({
    project_id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    goals: z.string().optional(),
    instructions: z.string().optional(),
    status: z.enum(['active', 'paused', 'archived']).optional(),
    icon: z.string().optional(),
    color: z.string().optional(),
    tags: z.array(z.string()).optional(),
    pinned_paths: z
      .array(z.string())
      .optional()
      .describe('Full replacement list of pinned file paths shown in the project\'s Files tab. Pass an empty array to clear. For single-file edits prefer pin_file/unpin_file.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    project: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: ERR_NO_BRIDGE };
    if (!c.project_id) return { ok: false, error: 'missing project_id' };
    return execLocalTool('project_update', c);
  },
});

export const pin_file = createTool({
  id: 'pin_file',
  description:
    'Pin a file to the project\'s **Files tab**. Use when the user says "pin this file", "add X to the project files", or when a file is recurring source material for the project. Idempotent — pinning an already-pinned path is a no-op. Path should be absolute (e.g. "C:/Users/me/notes/spec.md") so it resolves later.',
  inputSchema: z.object({
    project_id: z.string(),
    path: z.string().describe('Absolute file or folder path to attach as project context.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    project: z.any().optional(),
    pinned_paths: z.array(z.string()).optional(),
    already_pinned: z.boolean().optional(),
    indexed: z.boolean().optional(),
    context_kind: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: ERR_NO_BRIDGE };
    if (!c.project_id) return { ok: false, error: 'missing project_id' };
    if (!c.path || !String(c.path).trim()) return { ok: false, error: 'missing path' };

    const attached = await attachProjectContextPath(c.project_id, c.path, { processLimit: 25 });
    return {
      ok: true,
      project: attached.project,
      pinned_paths: attached.pinned_paths,
      already_pinned: !!attached.already_pinned,
      indexed: attached.indexed,
      context_kind: attached.context_kind,
    };
  },
});

export const add_project_context = createTool({
  id: 'add_project_context',
  description:
    'Attach files or folders as searchable project context, similar to Claude Projects or Perplexity Spaces. This updates the project Files tab, scans folders into the local file index, embeds pending files best-effort, and stores individual file content as project-scoped memory.',
  inputSchema: z.object({
    project_id: z.string(),
    paths: z.array(z.string()).min(1).describe('Absolute file/folder paths to add as project context.'),
    process_limit: z.number().int().min(0).max(1000).optional().default(150),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    results: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: ERR_NO_BRIDGE, results: [] };
    const paths: string[] = Array.isArray(c.paths) ? c.paths : [];
    const perPathLimit = Math.max(0, Math.floor((c.process_limit ?? 150) / Math.max(paths.length, 1)));
    const results = [];
    for (const p of paths) {
      results.push(await attachProjectContextPath(c.project_id, p, { processLimit: perPathLimit }));
    }
    return { ok: results.every((r) => r.ok), results };
  },
});

export const unpin_file = createTool({
  id: 'unpin_file',
  description:
    'Remove a file from the project\'s **Files tab**. Use when the user says "unpin X" or "remove X from the project files". Idempotent — unpinning a path that wasn\'t pinned is a no-op.',
  inputSchema: z.object({
    project_id: z.string(),
    path: z.string().describe('Absolute file path to unpin. Must match the pinned path exactly.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    project: z.any().optional(),
    pinned_paths: z.array(z.string()).optional(),
    was_pinned: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: ERR_NO_BRIDGE };
    if (!c.project_id) return { ok: false, error: 'missing project_id' };
    if (!c.path || !String(c.path).trim()) return { ok: false, error: 'missing path' };

    const projectResult = await execLocalTool('project_get', { project_id: c.project_id });
    if (!projectResult?.ok || !projectResult.project) {
      return { ok: false, error: projectResult?.error || 'project_not_found' };
    }
    const current: string[] = Array.isArray(projectResult.project.pinned_paths)
      ? projectResult.project.pinned_paths
      : [];
    const path = String(c.path).trim();
    if (!current.includes(path)) {
      return { ok: true, project: projectResult.project, pinned_paths: current, was_pinned: false };
    }
    const next = current.filter((p) => p !== path);
    const updated = await execLocalTool('project_update', { project_id: c.project_id, pinned_paths: next });
    return { ...updated, pinned_paths: next, was_pinned: true };
  },
});

export const delete_project = createTool({
  id: 'delete_project',
  description:
    'Delete a project. Destructive — only call after explicit user confirmation ("yes, delete X"). Prefer status="archived" via update_project for soft removal.',
  inputSchema: z.object({
    project_id: z.string(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    deleted: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: ERR_NO_BRIDGE };
    if (!c.project_id) return { ok: false, error: 'missing project_id' };
    return execLocalTool('project_delete', { project_id: c.project_id });
  },
});

export const enter_project_mode = createTool({
  id: 'enter_project_mode',
  description:
    'Enter Project Mode for the current conversation. This stamps the conversation with a project_id, scopes future memory writes to the project, and enables the project context block in your system prompt. Call this when the user signals they want to work on a specific project, or when you detect strong project context from their message. Always surface the entry to the user with a brief acknowledgement ("Entered project: X. Last session…").',
  inputSchema: z.object({
    conversation_id: z
      .string()
      .describe('The current conversation ID (provided in your system prompt under <conversation>).'),
    project_id: z.string().describe('The project to enter (from list_projects).'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    project: z.any().optional(),
    recent_journal: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: ERR_NO_BRIDGE };

    const setResult = await execLocalTool('conversation_set_project', {
      conversation_id: c.conversation_id,
      project_id: c.project_id,
    });
    if (!setResult?.ok) return { ok: false, error: setResult?.error || 'failed_to_set_project' };

    // Fetch project + recent journal so the AI's next turn can warm-welcome.
    const projectResult = await execLocalTool('project_get', { project_id: c.project_id });
    const journalResult = await execLocalTool('journal_list', { project_id: c.project_id, limit: 5 });

    return {
      ok: true,
      project: projectResult?.project,
      recent_journal: journalResult?.entries || [],
    };
  },
});

export const exit_project_mode = createTool({
  id: 'exit_project_mode',
  description:
    'Exit Project Mode for the current conversation. Clears the project scope and returns to general chat. Call this when the user wants to discuss something unrelated, or explicitly says they\'re done with the project.',
  inputSchema: z.object({
    conversation_id: z.string().describe('The current conversation ID.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: ERR_NO_BRIDGE };

    const setResult = await execLocalTool('conversation_set_project', {
      conversation_id: c.conversation_id,
      project_id: null,
    });
    if (!setResult?.ok) return { ok: false, error: setResult?.error || 'failed_to_clear_project' };

    return { ok: true };
  },
});

export const journal_add = createTool({
  id: 'journal_add',
  description:
    'Append a high-signal entry to the project\'s **Timeline tab**. Chat sessions are journaled automatically by the system — never log routine progress or recaps. Use this only for moments that deserve their own mark: `decision` (a meaningful choice), `finding` (a non-obvious discovery), `question` (open thread to investigate), `hypothesis` (a testable claim), `blocker` (something stuck + what unblocks it), `edit` (a significant code/file change — include source_ref.file_paths), `milestone` (rare; shipped work only). Durable facts/snippets/links belong in `memory_add` (Notes tab), not here. Title ≤80 chars, scannable. Body carries the why. Include source_ref (commit_sha, file_paths, task_id, url) when relevant.',
  inputSchema: z.object({
    project_id: z.string(),
    type: z
      .enum(['decision', 'finding', 'blocker', 'edit', 'milestone', 'question', 'hypothesis'])
      .default('finding')
      .describe('Pick the most specific type. Avoid `milestone` unless work actually shipped.'),
    title: z.string().describe('Short, scannable headline (≤80 chars ideal).'),
    body: z.string().optional().describe('Optional supporting detail.'),
    source_ref: z
      .record(z.string(), z.any())
      .optional()
      .describe('Optional links: { conversation_id?, commit_sha?, file_paths?, task_id? }'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    entry: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: ERR_NO_BRIDGE };

    // Embed title+body so the journal participates in semantic recall.
    const embedText = [c.title, c.body].filter(Boolean).join('\n\n');
    const embedding = embedText ? await generateEmbedding(embedText) : [];

    return execLocalTool('journal_add', {
      project_id: c.project_id,
      type: c.type || 'note',
      title: c.title,
      body: c.body,
      source: 'ai-tool',
      source_ref: c.source_ref,
      embedding: embedding.length > 0 ? embedding : undefined,
    });
  },
});

export const memory_add = createTool({
  id: 'memory_add',
  description:
    'Save to the project\'s **Notes tab** — a durable note, fact, snippet, or link the user (or future-you) will want to recall via project_search. This is the DEFAULT for capturing facts/snippets/preferences/URLs/observations. Use this *instead of* `journal_add` for anything that isn\'t a time-ordered event. When Project Mode is active and you omit `project_ids`, the note auto-scopes to the active project. Pass `project_ids: []` explicitly to save globally (cross-project). Set `pinned: true` to highlight the note inside the Notes tab (this does NOT add it to the Files tab — use `pin_file` for that).',
  inputSchema: z.object({
    content: z.string().describe('The memory body — the fact, note, or snippet itself.'),
    title: z.string().optional().describe('Short headline. Optional but improves recall.'),
    type: z
      .enum(['note', 'fact', 'snippet', 'link', 'file', 'image'])
      .optional()
      .default('note')
      .describe('Memory kind. Most things are "note" or "fact"; use "snippet" for code, "link" for URLs.'),
    project_ids: z
      .array(z.string())
      .optional()
      .describe('Project IDs to scope this memory to. Omit while in project mode to default to the active project. Pass `[]` explicitly to save globally.'),
    conversation_id: z
      .string()
      .optional()
      .describe('Pass when in project mode (from <conversation> in your system prompt) so the active project can be resolved automatically.'),
    url: z.string().optional(),
    pinned: z.boolean().optional().default(false),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    memory: z.any().optional(),
    scoped_to: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: ERR_NO_BRIDGE };

    let projectIds: string[] | undefined = Array.isArray(c.project_ids) ? c.project_ids : undefined;

    // When the AI omits project_ids entirely (i.e. didn't explicitly pass []),
    // default to the active project so memories written during project mode
    // are recallable via project_search. If `[]` was passed explicitly, respect
    // it as "save globally".
    if (projectIds === undefined && c.conversation_id) {
      try {
        const convoResult = await execLocalTool('conversation_get', {
          conversation_id: c.conversation_id,
        });
        const activeId = convoResult?.conversation?.project_id;
        if (activeId) projectIds = [String(activeId)];
      } catch {
        /* best-effort — fall through to global write */
      }
    }
    if (projectIds === undefined) projectIds = [];

    const embedText = [c.title, c.content].filter(Boolean).join('\n\n');
    const embedding = embedText ? await generateEmbedding(embedText) : [];

    const result = await execLocalTool('memory_create', {
      type: c.type || 'note',
      content: c.content,
      title: c.title,
      project_ids: projectIds,
      url: c.url,
      pinned: !!c.pinned,
      // NOTE: memories.source CHECK allows ('chat','manual','tool','journal','sync','notion').
      // 'ai-tool' is a *journal* source value — do not use it here.
      source: 'tool',
      added_by: 'ai',
      embedding: embedding.length > 0 ? embedding : undefined,
    });

    return { ...result, scoped_to: projectIds };
  },
});

export const project_search = createTool({
  id: 'project_search',
  description:
    'Semantic search over the project\'s **Notes tab** (everything saved via `memory_add` — notes, facts, snippets, links). Returns the most relevant entries for the query. Call this *before* guessing whenever prior project context would help. For time-ordered events use journal_list (Timeline) instead; for prior chat use search_project_conversations.',
  inputSchema: z.object({
    project_id: z.string(),
    query: z.string().describe('Natural-language search query.'),
    limit: z.number().int().min(1).max(50).optional().default(10),
    include_files: z.boolean().optional().default(true),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    results: z.array(z.any()).optional(),
    memory_results: z.array(z.any()).optional(),
    file_results: z.array(z.any()).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: ERR_NO_BRIDGE, results: [] };

    const embedding = await generateEmbedding(c.query);
    if (!embedding || embedding.length === 0) {
      return { ok: false, error: 'failed_to_embed_query', results: [] };
    }

    const memoryResult = await execLocalTool('memory_search', {
      project_id: c.project_id,
      query_embedding: embedding,
      limit: c.limit ?? 10,
    });

    let fileResult: any = { ok: true, results: [] };
    if (c.include_files !== false) {
      const projectResult = await execLocalTool(
        'project_get',
        { project_id: c.project_id },
        undefined,
        30000,
        { silent: true },
      );
      const pathScopes = Array.isArray(projectResult?.project?.pinned_paths)
        ? projectResult.project.pinned_paths
        : [];

      if (pathScopes.length > 0) {
        try {
          fileResult = await fileIndexingService.searchFiles(c.query, {
            mode: 'hybrid',
            limit: c.limit ?? 10,
            pathScopes,
          });
        } catch (error: any) {
          fileResult = { ok: false, error: String(error?.message || error), results: [] };
        }
      }
    }

    const memoryResults = Array.isArray(memoryResult?.results)
      ? memoryResult.results.map((result: any) => ({ ...result, source_type: 'memory' }))
      : [];
    const fileResults = Array.isArray(fileResult?.results)
      ? fileResult.results.map((result: any) => ({
          file: result,
          score: Number(result?.score || 0),
          source_type: 'file',
        }))
      : [];
    const results = [...memoryResults, ...fileResults]
      .sort((a: any, b: any) => Number(b?.score || 0) - Number(a?.score || 0))
      .slice(0, c.limit ?? 10);

    return {
      ok: memoryResult?.ok !== false && fileResult?.ok !== false,
      results,
      memory_results: memoryResults,
      file_results: fileResults,
      count: results.length,
      error: memoryResult?.error || fileResult?.error,
    };
  },
});

/**
 * Project-scoped semantic search over past conversation segments. Unlike
 * `search_past_conversations` (global), this returns only segments from
 * conversations stamped with the active project_id — so Project Mode has
 * its own efficient conversation memory.
 *
 * Resolves the active project from `conversation_id` (set by enter_project_mode).
 * If the caller passes `project_id` explicitly, that wins.
 */
export const search_project_conversations = createTool({
  id: 'search_project_conversations',
  description:
    'Semantic search over past conversations **scoped to the active project** — your project-specific conversation memory. Use this in Project Mode when the user references "what we discussed last time" or you need the texture of prior chat on this project. Pass `conversation_id` (from <conversation> in your system prompt); the active project is resolved automatically. Falls back to error if the conversation has no project attached.',
  inputSchema: z.object({
    conversation_id: z
      .string()
      .optional()
      .describe('Current conversation ID. Used to resolve the active project. Required unless project_id is passed.'),
    project_id: z
      .string()
      .optional()
      .describe('Explicit project to scope to. If omitted, resolved from conversation_id.'),
    query: z.string().describe('Natural-language search query.'),
    limit: z.number().int().min(1).max(20).optional().default(5),
    threshold: z.number().min(0).max(1).optional().default(0.2),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    project_id: z.string().optional(),
    results: z.array(z.any()).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: ERR_NO_BRIDGE, results: [] };

    let projectId: string | null = c.project_id ? String(c.project_id) : null;
    if (!projectId && c.conversation_id) {
      try {
        const convoResult = await execLocalTool('conversation_get', {
          conversation_id: c.conversation_id,
        });
        const pid = convoResult?.conversation?.project_id;
        if (pid) projectId = String(pid);
      } catch {
        /* best-effort */
      }
    }

    if (!projectId) {
      return {
        ok: false,
        error: 'no_active_project — pass project_id explicitly, or enter Project Mode first.',
        results: [],
      };
    }

    const query = String(c.query || '').trim();
    if (!query) return { ok: false, error: 'missing_query', results: [] };

    const embedding = await generateEmbedding(query);
    if (!embedding || embedding.length === 0) {
      return { ok: false, error: 'failed_to_embed_query', results: [] };
    }

    const result = await execLocalTool('segment_search', {
      embedding,
      limit: c.limit ?? 5,
      threshold: c.threshold ?? 0.2,
      project_id: projectId,
    });

    return { ...(result || {}), project_id: projectId };
  },
});
