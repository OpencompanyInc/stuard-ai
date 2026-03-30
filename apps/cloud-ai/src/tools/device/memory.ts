import { createTool } from '@mastra/core/tools';
import { generateText } from 'ai';
import { z } from 'zod';
import { hasClientBridge } from './shared';
import { execLocalTool } from '../bridge';
import { buildProviderModel } from '../../utils/models';
import { getDefaultModelForCategory } from '../../pricing';
import * as memoryService from '../../memory/conversations';

function normalizePath(rawPath: unknown): string[] {
  const path = String(rawPath ?? '').trim();
  if (!path) return [];
  return path
    .split(/[\\/]+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function resolveSpaceId(
  rawSpaceRef: unknown
): Promise<{ ok: true; space_id: string } | { ok: false; error: string }> {
  const spaceRef = String(rawSpaceRef ?? '').trim();
  if (!spaceRef) return { ok: false, error: 'missing_space_id' };

  const direct = await memoryService.getSpace(spaceRef);
  if (direct?.id) {
    return { ok: true, space_id: String(direct.id) };
  }

  const spaces = await memoryService.listSpaces({ include_archived: true, limit: 500 });
  const match = spaces.find((space) => String(space?.name || '').trim().toLowerCase() === spaceRef.toLowerCase());
  if (match?.id) {
    return { ok: true, space_id: String(match.id) };
  }

  return { ok: false, error: `space not found: ${spaceRef}` };
}

async function resolveFolderPath(
  spaceId: string,
  rawPath: unknown,
  options?: { create?: boolean }
): Promise<{ ok: true; space_id: string; folder_id: string | null; created: boolean } | { ok: false; error: string }> {
  const create = options?.create ?? false;
  const parts = normalizePath(rawPath);
  const resolvedSpace = await resolveSpaceId(spaceId);
  if (!resolvedSpace.ok) return resolvedSpace;
  const resolvedSpaceId = resolvedSpace.space_id;

  let parentId: string | null | undefined = undefined;
  let createdAny = false;

  for (const name of parts) {
    const folders = await memoryService.getSpaceItems(resolvedSpaceId, {
      type: 'folder',
      parent_id: parentId || undefined,
      include_all: false,
      limit: 500,
    });

    const existing = folders.find((f: any) => String(f?.title || '').toLowerCase() === name.toLowerCase());
    if (existing?.id) {
      parentId = String(existing.id);
      continue;
    }

    if (!create) {
      return { ok: false, error: 'path_not_found' };
    }

    const folder = await memoryService.createSpaceFolder(resolvedSpaceId, name, {
      parent_id: parentId || undefined,
    });

    if (!folder?.id) return { ok: false, error: 'failed_to_create_folder' };
    createdAny = true;
    parentId = String(folder.id);
  }

  return { ok: true, space_id: resolvedSpaceId, folder_id: parentId ?? null, created: createdAny };
}

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
  execute: async (inputData, context) => {
    const c = inputData as any;
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

      const queryEmbedding = await memoryService.generateEmbedding(query);
      if (!queryEmbedding.length) {
        return {
          ok: false,
          error: 'Embeddings are unavailable (embedding provider failing).',
          results: [],
          debug: { stats: stats0 },
        };
      }

      const segmentResults = await memoryService.searchSegmentsByEmbedding(queryEmbedding, {
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
        } catch { }
      }

      const segmentResults2 =
        segmentResults.length === 0
          ? await memoryService.searchSegmentsByEmbedding(queryEmbedding, { limit, threshold: 0.0 })
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

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION TOOLS — Give the agent access to topic drawers / collections
// ═══════════════════════════════════════════════════════════════════════════════

export const browse_topic_collections = createTool({
  id: 'browse_topic_collections',
  description:
    'Browse conversation topic collections — returns a table of contents of all discussion topics with counts and dates. Use this when the user asks what topics you have discussed, or when you need an overview of conversation history organized by topic.',
  inputSchema: z.object({
    query: z.string().optional().default('').describe('Optional text filter for topic names'),
    limit: z.number().int().min(1).max(50).default(20).optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    topics: z
      .array(
        z.object({
          topic: z.string(),
          count: z.number(),
          cluster_count: z.number(),
          latest_at: z.string().nullable(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };
    try {
      const c = inputData as any;
      const result = await execLocalTool('segment_build_topic_drawers', {
        query: c.query || undefined,
        limit_topics: c.limit || 20,
        limit_segments_per_topic: 1, // minimal — just need metadata
        segments_scan_limit: 2000,
      });
      if (!result?.ok) return { ok: false, error: result?.error || 'Failed', topics: [] };
      const topics = (result.drawers || []).map((d: any) => ({
        topic: d.topic,
        count: d.count || 0,
        cluster_count: Array.isArray(d.clusters) ? d.clusters.length : 0,
        latest_at: d.latest_at || null,
      }));
      return { ok: true, topics };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const get_collection_detail = createTool({
  id: 'get_collection_detail',
  description:
    'Get detailed view of a single topic collection — its clusters and segment summaries. Use after browse_topic_collections to drill into a specific topic.',
  inputSchema: z.object({
    topic: z.string().describe('The topic name to get details for'),
    max_clusters: z.number().int().min(1).max(20).default(8).optional(),
    max_segments_per_cluster: z.number().int().min(1).max(10).default(5).optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    topic: z.string().optional(),
    clusters: z
      .array(
        z.object({
          title: z.string(),
          count: z.number(),
          segments: z.array(
            z.object({
              id: z.string(),
              conversation_id: z.string(),
              summary: z.string().optional(),
              topics: z.array(z.string()).optional(),
              created_at: z.string(),
            }),
          ),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };
    try {
      const c = inputData as any;
      const topicQuery = String(c.topic || '').trim();
      if (!topicQuery) return { ok: false, error: 'topic is required' };

      const result = await execLocalTool('segment_build_topic_drawers', {
        query: topicQuery,
        limit_topics: 5,
        limit_segments_per_topic: (c.max_clusters || 8) * (c.max_segments_per_cluster || 5),
        segments_scan_limit: 2000,
      });
      if (!result?.ok) return { ok: false, error: result?.error || 'Failed' };

      // Find the best matching drawer
      const drawers: any[] = result.drawers || [];
      const match = drawers.find(
        (d: any) => String(d.topic || '').toLowerCase() === topicQuery.toLowerCase(),
      ) || drawers[0];

      if (!match) return { ok: true, topic: topicQuery, clusters: [] };

      const maxClusters = c.max_clusters || 8;
      const maxSegs = c.max_segments_per_cluster || 5;
      const clusters = (match.clusters || []).slice(0, maxClusters).map((cl: any) => ({
        title: cl.title || 'Cluster',
        count: cl.count || 0,
        segments: (cl.segments || []).slice(0, maxSegs).map((s: any) => ({
          id: s.id,
          conversation_id: s.conversation_id,
          summary: s.summary,
          topics: s.topics,
          created_at: s.created_at,
        })),
      }));

      return { ok: true, topic: match.topic, clusters };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const synthesize_collection = createTool({
  id: 'synthesize_collection',
  description:
    'Synthesize a narrative summary across all conversations in a topic collection. Use when the user asks "what do you know about X" or "summarize everything about X".',
  inputSchema: z.object({
    topic: z.string().describe('The topic to synthesize'),
    focus: z.string().optional().describe('Optional focus area within the topic'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    synthesis: z.string().optional(),
    segment_count: z.number().optional(),
    date_range: z
      .object({
        earliest: z.string(),
        latest: z.string(),
      })
      .optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };
    try {
      const c = inputData as any;
      const topicQuery = String(c.topic || '').trim();
      if (!topicQuery) return { ok: false, error: 'topic is required' };

      // Fetch segments for this topic
      const result = await execLocalTool('segment_build_topic_drawers', {
        query: topicQuery,
        limit_topics: 3,
        limit_segments_per_topic: 20,
        segments_scan_limit: 2000,
      });

      const drawers: any[] = result?.drawers || [];
      const match = drawers.find(
        (d: any) => String(d.topic || '').toLowerCase() === topicQuery.toLowerCase(),
      ) || drawers[0];

      if (!match || !match.clusters?.length) {
        return { ok: true, synthesis: `No conversations found about "${topicQuery}".`, segment_count: 0 };
      }

      // Collect all segment summaries
      const allSegments: any[] = [];
      for (const cluster of match.clusters) {
        for (const seg of cluster.segments || []) {
          allSegments.push(seg);
        }
      }

      if (allSegments.length === 0) {
        return { ok: true, synthesis: `Topic "${topicQuery}" exists but has no segment summaries.`, segment_count: 0 };
      }

      // Sort by date and take up to 20
      allSegments.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const top = allSegments.slice(0, 20);

      const summaryBlock = top
        .map((s, i) => `[${i + 1}] (${s.created_at?.slice(0, 10) || '?'}): ${s.summary || 'No summary'}`)
        .join('\n');

      const dates = top.map((s) => s.created_at || '').filter(Boolean).sort();
      const dateRange = { earliest: dates[0] || '', latest: dates[dates.length - 1] || '' };

      // Use fast LLM to produce a synthesized narrative
      const modelId = getDefaultModelForCategory('fast');
      const model = buildProviderModel(modelId);

      const focusInstruction = c.focus
        ? `\nFocus specifically on: ${c.focus}`
        : '';

      const { text: synthesis } = await generateText({
        model: model as any,
        system: `You synthesize conversation segment summaries into a coherent narrative about a topic. Be concise (2-4 paragraphs). Include key facts, decisions, and outcomes. Mention approximate dates when relevant.${focusInstruction}`,
        prompt: `Topic: "${topicQuery}"\n\nConversation segments (${top.length} most recent):\n${summaryBlock}`,
        temperature: 0.3,
      });

      return {
        ok: true,
        synthesis: synthesis.trim(),
        segment_count: allSegments.length,
        date_range: dateRange,
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// SPACE TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

export const ensure_space_path = createTool({
  id: 'ensure_space_path',
  description:
    'Ensure a folder path exists inside a space (creates nested folders as needed). Paths use "/" separators like "Project/Specs/Backend".',
  inputSchema: z.object({
    space_id: z.string().describe('The space ID or exact space name to operate in'),
    path: z.string().optional().default('').describe('Folder path within the space (e.g. "A/B/C"). Empty means root.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    folder_id: z.string().nullable().optional(),
    created: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const res = await resolveFolderPath(c.space_id, c.path, { create: true });
      if (!res.ok) return res;
      return { ok: true, folder_id: res.folder_id, created: res.created };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const list_space_path = createTool({
  id: 'list_space_path',
  description:
    'List items inside a folder path within a space. Use this to browse subfolders and notes like a filesystem.',
  inputSchema: z.object({
    space_id: z.string().describe('The space ID or exact space name to list from'),
    path: z.string().optional().default('').describe('Folder path within the space. Empty means root.'),
    type: z.enum(['note', 'source', 'link', 'file', 'fact', 'snippet', 'folder']).optional().describe('Optional filter by item type'),
    limit: z.number().int().min(1).max(500).optional().default(200).describe('Max items to return (<= 500)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    folder_id: z.string().nullable().optional(),
    items: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const resolved = await resolveFolderPath(c.space_id, c.path, { create: false });
      if (!resolved.ok) return resolved;

      const items = await memoryService.getSpaceItems(resolved.space_id, {
        type: c.type,
        parent_id: resolved.folder_id || undefined,
        include_all: false,
        limit: c.limit || 200,
      });

      return { ok: true, folder_id: resolved.folder_id ?? null, items };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const add_to_space_path = createTool({
  id: 'add_to_space_path',
  description:
    'Add an item to a space under a folder path (creates folders as needed). This supports a simple path-based organization system.',
  inputSchema: z.object({
    space_id: z.string().describe('The space ID or exact space name to add to'),
    path: z.string().optional().default('').describe('Folder path within the space. Empty means root.'),
    type: z.enum(['note', 'source', 'link', 'file', 'fact', 'snippet']).describe('Type of item to add'),
    title: z.string().describe('The title/name for the item'),
    content: z.string().describe('The content to add'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    item: z.any().optional(),
    folder_id: z.string().nullable().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const resolved = await resolveFolderPath(c.space_id, c.path, { create: true });
      if (!resolved.ok) return resolved;

      const item = await memoryService.addSpaceItem(resolved.space_id, c.type, c.content, {
        title: c.title,
        added_by: 'ai',
        parent_id: resolved.folder_id || undefined,
      });

      if (!item) return { ok: false, error: 'Failed to add item' };
      return { ok: true, item, folder_id: resolved.folder_id ?? null };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});

export const get_space_tree = createTool({
  id: 'get_space_tree',
  description: 'Get the full folder tree for a space as a nested structure.',
  inputSchema: z.object({
    space_id: z.string().describe('The space ID or exact space name to retrieve the tree for'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    tree: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const resolvedSpace = await resolveSpaceId(c.space_id);
      if (!resolvedSpace.ok) return resolvedSpace;

      const tree = await memoryService.getSpaceTree(resolvedSpace.space_id);
      if (!tree) return { ok: false, error: 'Failed to get tree' };
      return { ok: true, tree };
    } catch (error) {
      return { ok: false, error: String(error) };
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
  execute: async (inputData, context) => {
    const c = inputData as any;
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
  execute: async (inputData, context) => {
    const c = inputData as any;
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
  execute: async (inputData, context) => {
    const c = inputData as any;
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
    title: z.string().describe('The title/name for the item'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    item: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const c = inputData as any;
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
  execute: async (inputData, context) => {
    const c = inputData as any;
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
  execute: async (inputData, context) => {
    const c = inputData as any;
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
  execute: async (inputData, context) => {
    const c = inputData as any;
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
  execute: async (inputData, context) => {
    const c = inputData as any;
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
  execute: async (inputData, context) => {
    const c = inputData as any;
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
  execute: async (inputData, context) => {
    const c = inputData as any;
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
  execute: async (inputData, context) => {
    const c = inputData as any;
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
  execute: async (inputData, context) => {
    const c = inputData as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    try {
      const deleted = await memoryService.deleteSpaceItem(c.item_id);
      return { ok: deleted };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
});
