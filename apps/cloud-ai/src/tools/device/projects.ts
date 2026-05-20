/**
 * Project Mode tools — successor to Spaces.
 *
 * - enter_project_mode / exit_project_mode: stamp the current conversation
 *   with a project_id (or clear it). The conversation row IS the session state.
 * - list_projects: lightweight project picker for the AI.
 * - journal_add: append a timestamped entry to a project's timeline.
 * - memory_add: write a project-scoped (or global) memory with auto-embedding.
 * - project_search: semantic search over a project's memories. Embedding is
 *   generated cloud-side; storage + search happens on the desktop SQLite.
 *
 * Conversation context: `conversation_id` is currently a required input
 * because Mastra doesn't expose it on the tool execute context. Phase 3
 * injects the current conversation_id into the system prompt so the AI knows
 * what to pass.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, hasClientBridge } from './shared';
import { generateEmbedding } from '../../memory/conversations';

const ERR_NO_BRIDGE = 'No client bridge available';

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
    const embedText = [c.name, c.description, c.goals].filter(Boolean).join('\n\n');
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
    'Update an existing project — name, description, goals, status, icon, color, or tags. Use this when the user asks to rename, pause, archive, or otherwise tweak project metadata. Only include the fields you intend to change.',
  inputSchema: z.object({
    project_id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    goals: z.string().optional(),
    status: z.enum(['active', 'paused', 'archived']).optional(),
    icon: z.string().optional(),
    color: z.string().optional(),
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
    if (!c.project_id) return { ok: false, error: 'missing project_id' };
    return execLocalTool('project_update', c);
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
    'Append an entry to a project\'s timeline — the project\'s long-term lab notebook. Use the full type palette: decision, finding, question, hypothesis, blocker, edit, note. Reserve "milestone" for rare shipped-work moments (entering a project or finishing a chat is NOT a milestone). Default to "note" or "finding" for normal observations. Keep titles ≤80 chars, scannable. Use body for the why. Include source_ref (commit_sha, file_paths, task_id, url) when relevant.',
  inputSchema: z.object({
    project_id: z.string(),
    type: z
      .enum(['decision', 'finding', 'blocker', 'edit', 'chat_summary', 'task', 'milestone', 'note', 'question', 'hypothesis'])
      .default('note'),
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
    'Save a memory — a durable note, fact, snippet, or URL — that future turns can recall via project_search. Use for things worth keeping (preferences, decisions captured as facts, useful snippets, references), NOT for chat history. When Project Mode is active and you omit project_ids, the memory is automatically scoped to the active project. Pass empty `project_ids: []` to save a global (cross-project) memory.',
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
      source: 'ai-tool',
      added_by: 'ai',
      embedding: embedding.length > 0 ? embedding : undefined,
    });

    return { ...result, scoped_to: projectIds };
  },
});

export const project_search = createTool({
  id: 'project_search',
  description:
    'Semantic search over a project\'s memories (notes, snippets, links, facts). Returns memories most relevant to the query. Use this when you need context about prior work in a project — instead of guessing, search.',
  inputSchema: z.object({
    project_id: z.string(),
    query: z.string().describe('Natural-language search query.'),
    limit: z.number().int().min(1).max(50).optional().default(10),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    results: z.array(z.any()).optional(),
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

    return execLocalTool('memory_search', {
      project_id: c.project_id,
      query_embedding: embedding,
      limit: c.limit ?? 10,
    });
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
