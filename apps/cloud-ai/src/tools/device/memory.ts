import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { hasClientBridge } from './shared';
import * as memoryService from '../../memory/conversations';

export const search_past_conversations = createTool({
  id: 'search_past_conversations',
  description:
    'Search through past conversations with the user to find relevant context. Use this when the user asks about something you discussed before or when you need historical context.',
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .default('')
      .describe(
        'What to search for (e.g., "calendar debugging", "project setup", "what we discussed about X"). Optional when using filter mode.',
      ),
    limit: z.number().int().min(1).max(20).default(5).optional(),
    filter: z
      .object({
        mode: z
          .enum(['auto', 'semantic', 'recent'])
          .optional()
          .default('auto')
          .describe('auto: semantic when query exists else recent; semantic: embedding search; recent: return recent segments by date'),
        since: z.string().optional().describe('ISO datetime (inclusive). Example: 2025-12-18T00:00:00-06:00'),
        before: z.string().optional().describe('ISO datetime (inclusive). Example: 2025-12-18T23:59:59-06:00'),
      })
      .optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    results: z
      .array(
        z.object({
          conversation_id: z.string(),
          title: z.string().nullable(),
          summary: z.string().optional(),
          topics: z.array(z.string()).optional(),
          score: z.number(),
          date: z.string(),
        }),
      )
      .optional(),
    debug: z
      .object({
        stats: z.any().optional(),
      })
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available', results: [] };

    try {
      const limit = c.limit || 5;
      const query = String(c.query || '').trim();
      const filter = c.filter && typeof c.filter === 'object' ? c.filter : null;
      const mode = String(filter?.mode || 'auto');
      const since = filter?.since ? String(filter.since) : undefined;
      const before = filter?.before ? String(filter.before) : undefined;

      const stats0 = await memoryService.getMemoryStats().catch(() => null);

      const recencyIntent = (() => {
        try {
          const q = query.toLowerCase();
          return (
            q.includes('last conversation') ||
            q.includes('previous conversation') ||
            q.includes('our last conversation') ||
            q.includes('our last chat') ||
            q.includes('last time we talked') ||
            q.includes('most recent conversation') ||
            q.includes('most recent chat')
          );
        } catch {
          return false;
        }
      })();

      const useRecent = mode === 'recent' || (mode === 'auto' && (!query || recencyIntent));
      if (useRecent) {
        const segs = await memoryService.listRecentSegments({ limit, since, before });
        const results = segs.map((segment, i) => ({
          conversation_id: segment.conversation_id,
          title: null as string | null,
          summary: segment.summary,
          topics: segment.topics,
          score: Math.max(0, 1.0 - i * 0.01),
          date: segment.created_at,
        }));

        if (results.length === 0) {
          const stats = await memoryService.getMemoryStats().catch(() => null);
          return { ok: true, results: [], debug: { stats } };
        }

        return { ok: true, results };
      }

      if (!query) {
        return { ok: false, error: 'missing_query', results: [], debug: { stats: stats0 } };
      }

      const probe = await memoryService.generateEmbedding(String(query || ''));
      if (!probe.length) {
        return {
          ok: false,
          error: 'Embeddings are unavailable (OPENAI_API_KEY not configured or embedding provider failing).',
          results: [],
          debug: { stats: stats0 },
        };
      }

      const segmentResults = await memoryService.searchSegments(query, {
        limit,
        threshold: 0.2,
      });

      if (segmentResults.length === 0 && stats0 && stats0.messages > 0 && stats0.segments === 0) {
        try {
          const convs = await memoryService.listConversations({ status: 'active', limit: 1, offset: 0 });
          const latest = convs?.[0];
          if (latest?.id) {
            const msgs = await memoryService.getMessages(latest.id, { limit: 50 });
            await memoryService.processConversationTurn(
              latest.id,
              msgs.map((m) => ({ role: m.role, content: m.content })),
            );
          }
        } catch {}
      }

      const segmentResults2 =
        segmentResults.length === 0
          ? await memoryService.searchSegments(query, { limit, threshold: 0.0 })
          : segmentResults;

      const segmentResults3 =
        since || before
          ? segmentResults2.filter(({ segment }) => {
              const t = Date.parse(String(segment.created_at || ''));
              if (!Number.isFinite(t)) return true;
              if (since) {
                const s = Date.parse(String(since));
                if (Number.isFinite(s) && t < s) return false;
              }
              if (before) {
                const b = Date.parse(String(before));
                if (Number.isFinite(b) && t > b) return false;
              }
              return true;
            })
          : segmentResults2;

      const results = segmentResults3.map(({ segment, score }) => ({
        conversation_id: segment.conversation_id,
        title: null as string | null,
        summary: segment.summary,
        topics: segment.topics,
        score,
        date: segment.created_at,
      }));

      if (results.length === 0) {
        const stats = await memoryService.getMemoryStats().catch(() => null);
        return {
          ok: true,
          results: [],
          debug: {
            stats,
          },
        };
      }

      return { ok: true, results };
    } catch (error) {
      const stats = await memoryService.getMemoryStats().catch(() => null);
      return { ok: false, error: String(error), results: [], debug: { stats } };
    }
  },
});

export const get_conversation_context = createTool({
  id: 'get_conversation_context',
  description:
    'Retrieve the full message history from a specific past conversation. Use after search_past_conversations to get detailed context.',
  inputSchema: z.object({
    conversation_id: z.string().describe('The conversation ID to retrieve'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .optional()
      .describe('Max messages to retrieve'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    messages: z
      .array(
        z.object({
          role: z.string(),
          content: z.string(),
          created_at: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const messages = await memoryService.getMessages(c.conversation_id, {
        limit: c.limit || 20,
      });

      return {
        ok: true,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          created_at: m.created_at,
        })),
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const list_user_spaces = createTool({
  id: 'list_user_spaces',
  description:
    "List all of the user's spaces (collaborative folders for projects, topics, research). Use this to see what organized knowledge exists.",
  inputSchema: z.object({
    type: z
      .enum(['project', 'topic', 'research', 'reference', 'custom'])
      .optional()
      .describe('Filter by space type'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    spaces: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          type: z.string(),
          item_count: z.number().optional(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const spaces = await memoryService.listSpaces({ type: c.type, limit: 50 });
      return {
        ok: true,
        spaces: spaces.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          type: s.type,
        })),
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const get_space_contents = createTool({
  id: 'get_space_contents',
  description:
    "Get the contents of a specific space (notes, sources, links, facts). Use after list_user_spaces to see what's inside.",
  inputSchema: z.object({
    space_id: z.string().describe('The space ID to retrieve contents from'),
    type: z
      .enum(['note', 'source', 'link', 'file', 'fact', 'snippet'])
      .optional()
      .describe('Filter by item type'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    space: z
      .object({
        name: z.string(),
        description: z.string().nullable(),
      })
      .optional(),
    items: z
      .array(
        z.object({
          id: z.string(),
          type: z.string(),
          title: z.string().nullable(),
          content: z.string(),
          added_by: z.string(),
          pinned: z.boolean(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const space = await memoryService.getSpace(c.space_id);
      if (!space) return { ok: false, error: 'Space not found' };

      const items = await memoryService.getSpaceItems(c.space_id, { type: c.type, limit: 100 });

      return {
        ok: true,
        space: { name: space.name, description: space.description },
        items: items.map((i) => ({
          id: i.id,
          type: i.type,
          title: i.title,
          content: i.content,
          added_by: i.added_by,
          pinned: i.pinned,
        })),
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const add_to_space = createTool({
  id: 'add_to_space',
  description:
    "Add a note, source, link, or fact to a user's space. Use this to help organize information for the user.",
  inputSchema: z.object({
    space_id: z.string().describe('The space ID to add to'),
    type: z.enum(['note', 'source', 'link', 'fact', 'snippet']).describe('Type of item'),
    content: z.string().describe('The content to add'),
    title: z.string().optional().describe('Optional title for the item'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    item: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const item = await memoryService.addSpaceItem(c.space_id, c.type, c.content, {
        title: c.title,
        added_by: 'ai',
      });

      if (!item) return { ok: false, error: 'Failed to add item' };
      return { ok: true, item };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const create_space = createTool({
  id: 'create_space',
  description: 'Create a new space to organize information about a project, topic, or research area.',
  inputSchema: z.object({
    name: z.string().describe('Name of the space'),
    type: z.enum(['project', 'topic', 'research', 'reference', 'custom']).default('topic'),
    description: z.string().optional().describe('Description of what this space is for'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    space: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const space = await memoryService.createSpace(c.name, c.type, {
        description: c.description,
      });

      if (!space) return { ok: false, error: 'Failed to create space' };
      return { ok: true, space };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const get_memory_stats = createTool({
  id: 'get_memory_stats',
  description: "Get statistics about the user's memory system (conversation count, space count, etc.).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    stats: z
      .object({
        conversations: z.number(),
        messages: z.number(),
        spaces: z.number(),
        space_items: z.number(),
        segments: z.number(),
      })
      .optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const stats = await memoryService.getMemoryStats();
      if (!stats) return { ok: false, error: 'Failed to get stats' };
      return { ok: true, stats };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const add_source_to_space = createTool({
  id: 'add_source_to_space',
  description:
    'Add a source/reference to a space (URL, article, documentation, etc.). Use this when the user shares a useful link or reference.',
  inputSchema: z.object({
    space_id: z.string().describe('The space ID to add the source to'),
    url: z.string().describe('The URL of the source'),
    title: z.string().describe('Title/name of the source'),
    summary: z.string().optional().describe('Brief summary of what this source is about'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    item: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const content = c.summary ? `${c.url}\n\n${c.summary}` : c.url;
      const item = await memoryService.addSpaceItem(c.space_id, 'source', content, {
        title: c.title,
        added_by: 'ai',
        metadata: { url: c.url },
      });

      if (!item) return { ok: false, error: 'Failed to add source' };
      return { ok: true, item };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const add_note_to_space = createTool({
  id: 'add_note_to_space',
  description:
    'Add a note to a space. Use this to save important information, summaries, or key points for a project/topic.',
  inputSchema: z.object({
    space_id: z.string().describe('The space ID to add the note to'),
    title: z.string().describe('Title of the note'),
    content: z.string().describe('The note content (supports markdown)'),
    pinned: z.boolean().optional().describe('Pin this note to the top'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    item: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const item = await memoryService.addSpaceItem(c.space_id, 'note', c.content, {
        title: c.title,
        added_by: 'ai',
        pinned: c.pinned,
      });

      if (!item) return { ok: false, error: 'Failed to add note' };
      return { ok: true, item };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const add_code_snippet_to_space = createTool({
  id: 'add_code_snippet_to_space',
  description: 'Save a code snippet to a space. Use this to preserve useful code examples, solutions, or templates.',
  inputSchema: z.object({
    space_id: z.string().describe('The space ID to add the snippet to'),
    title: z.string().describe('Title/description of the snippet'),
    code: z.string().describe('The code snippet'),
    language: z.string().optional().describe('Programming language (python, typescript, etc.)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    item: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const lang = c.language || 'text';
      const content = `\`\`\`${lang}\n${c.code}\n\`\`\``;
      const item = await memoryService.addSpaceItem(c.space_id, 'snippet', content, {
        title: c.title,
        added_by: 'ai',
        metadata: { language: lang },
      });

      if (!item) return { ok: false, error: 'Failed to add snippet' };
      return { ok: true, item };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const link_conversation_to_space = createTool({
  id: 'link_conversation_to_space',
  description: 'Link the current conversation to a space. This helps organize conversations by project/topic.',
  inputSchema: z.object({
    space_id: z.string().describe('The space ID to link to'),
    conversation_id: z.string().describe('The conversation ID to link'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const linked = await memoryService.linkConversationToSpace(c.space_id, c.conversation_id, {
        auto_linked: false,
      });
      return { ok: linked };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const find_or_create_space = createTool({
  id: 'find_or_create_space',
  description:
    "Find an existing space by name or create a new one if it doesn't exist. Useful when you need to organize info but aren't sure if a space already exists.",
  inputSchema: z.object({
    name: z.string().describe('Name of the space to find or create'),
    type: z.enum(['project', 'topic', 'research', 'reference', 'custom']).default('topic'),
    description: z.string().optional().describe('Description if creating new'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    space: z.any().optional(),
    created: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      // Search for existing space with similar name
      const spaces = await memoryService.listSpaces({ limit: 100 });
      const existing = spaces.find(
        (s) => s.name.toLowerCase() === c.name.toLowerCase() || s.name.toLowerCase().includes(c.name.toLowerCase()),
      );

      if (existing) {
        return { ok: true, space: existing, created: false };
      }

      // Create new space
      const space = await memoryService.createSpace(c.name, c.type, {
        description: c.description,
      });

      if (!space) return { ok: false, error: 'Failed to create space' };
      return { ok: true, space, created: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const update_space_item = createTool({
  id: 'update_space_item',
  description: 'Update an existing item in a space (change title, content, or pin status).',
  inputSchema: z.object({
    item_id: z.string().describe('The item ID to update'),
    title: z.string().optional().describe('New title'),
    content: z.string().optional().describe('New content'),
    pinned: z.boolean().optional().describe('Pin/unpin the item'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    item: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const item = await memoryService.updateSpaceItem(c.item_id, {
        title: c.title,
        content: c.content,
        pinned: c.pinned,
      });

      if (!item) return { ok: false, error: 'Item not found' };
      return { ok: true, item };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const delete_space_item = createTool({
  id: 'delete_space_item',
  description: 'Delete an item from a space.',
  inputSchema: z.object({
    item_id: z.string().describe('The item ID to delete'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const deleted = await memoryService.deleteSpaceItem(c.item_id);
      return { ok: deleted };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});
