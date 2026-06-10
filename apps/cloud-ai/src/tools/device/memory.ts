import { createTool } from '@mastra/core/tools';
import { generateText } from 'ai';
import { z } from 'zod';
import { hasClientBridge } from './shared';
import { execLocalTool } from '../bridge';
import { buildProviderModel } from '../../utils/models';
import { getDefaultModelForCategory } from '../../pricing';
import * as memoryService from '../../memory/conversations';

async function hydrateConversationTitles<T extends { conversation_id: string; title: string | null }>(
  results: T[],
): Promise<T[]> {
  const ids = Array.from(new Set(results.map((r) => r.conversation_id).filter(Boolean)));
  const titleById = new Map<string, string | null>();

  await Promise.all(ids.map(async (id) => {
    try {
      const conversation = await memoryService.getConversation(id);
      titleById.set(id, conversation?.title || null);
    } catch {
      titleById.set(id, null);
    }
  }));

  return results.map((result) => ({
    ...result,
    title: titleById.get(result.conversation_id) || result.title || null,
  }));
}

function ownerScopeFromToolInput(input: any): memoryService.MemoryOwnerScope | undefined {
  const botId = String(input?.__proactiveBotId || input?.proactiveBotId || '').trim();
  if (botId) return { owner_type: 'bot', owner_id: botId };
  const agentId = String(input?.__agentId || input?.agentId || input?.agent_id || '').trim();
  if (agentId) return { owner_type: 'agent', owner_id: agentId };
  return undefined;
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
      const owner = ownerScopeFromToolInput(c);

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
        const segs = await memoryService.listRecentSegments({ limit, since, before, owner });
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

        return { ok: true, results: await hydrateConversationTitles(results) };
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
        owner,
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
              { owner },
            );
          }
        } catch { }
      }

      const segmentResults2 =
        segmentResults.length === 0
          ? await memoryService.searchSegmentsByEmbedding(queryEmbedding, { limit, threshold: 0.0, owner })
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

      return { ok: true, results: await hydrateConversationTitles(results) };
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

export const get_memory_stats = createTool({
  id: 'get_memory_stats',
  description: "Get statistics about the user's memory system (conversation, project, memory, and journal counts).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    stats: z
      .object({
        conversations: z.number(),
        messages: z.number(),
        projects: z.number(),
        memories: z.number(),
        journal_entries: z.number(),
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

