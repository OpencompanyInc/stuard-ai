/**
 * Conversation Memory Service
 * 
 * Handles:
 * - Conversation storage and retrieval via local agent
 * - Embedding generation for conversations and segments
 * - Topic segmentation and summarization
 * - Search across conversation history
 */

import { buildNativeProviderModel } from '../utils/models';
import { getDefaultModelForCategory } from '../pricing';
import { embed, generateObject, generateText } from 'ai';
import { google } from '../utils/models';
import { z } from 'zod';
import { execLocalTool } from '../tools/bridge';
import { writeLog } from '../utils/logger';
import { contentToText } from '../utils/messages';
import { normalizeThreadTitle, fallbackTitleFromMessage } from '../utils/thread-title';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface Conversation {
  id: string;
  title: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  status: 'active' | 'archived' | 'deleted';
  embedding?: number[] | null;
  sync_id?: string | null;
  synced_at?: string | null;
  needs_sync?: boolean;
  source?: 'stuard' | 'workflow' | 'skill' | 'proactive';
  owner_type?: MemoryOwnerType | null;
  owner_id?: string | null;
  /** Project Mode scope — set by enter_project_mode, null/absent = unscoped. */
  project_id?: string | null;
}

export type MemoryOwnerType = 'stuard' | 'bot' | 'agent' | 'workflow' | 'skill';

export interface MemoryOwnerScope {
  owner_type?: MemoryOwnerType;
  owner_id?: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  turn_index: number;
  created_at: string;
  tool_calls?: any[];
  tool_results?: any[];
  attachments?: any[];
  metadata?: Record<string, any>;
}

export interface ConversationSegment {
  id: string;
  conversation_id: string;
  start_turn: number;
  end_turn: number | null;
  summary: string;
  topics: string[];
  created_at: string;
  updated_at: string;
}

function serializeOwnerScope(owner?: MemoryOwnerScope): Record<string, string | null> {
  if (!owner?.owner_type) return {};
  const out: Record<string, string | null> = { owner_type: owner.owner_type };
  if (owner.owner_id !== undefined) out.owner_id = owner.owner_id ? String(owner.owner_id) : null;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMBEDDING
// ═══════════════════════════════════════════════════════════════════════════════

const EMBEDDING_MODEL = 'gemini-embedding-2-preview';

function normalizeConversationContent(content: unknown): string {
  const text = contentToText(content);
  if (text) return text;
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content ?? '');
  } catch {
    return String(content ?? '');
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const { embedding } = await embed({
      model: google.textEmbeddingModel(EMBEDDING_MODEL),
      value: text.slice(0, 8000),
    });
    return embedding;
  } catch (error) {
    writeLog('embedding_error', { error: String(error) });
    return [];
  }
}

export async function generateConversationEmbedding(
  messages: Array<{ role: string; content: any }>
): Promise<number[]> {
  // Create a condensed representation of the conversation
  const text = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role}: ${normalizeConversationContent(m.content)}`)
    .join('\n')
    .slice(0, 12000);
  
  return generateEmbedding(text);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEGMENTATION & SUMMARIZATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Analysis action types:
 * - 'new': First segment or completely unrelated topic - create new segment
 * - 'topic_change': Significant topic shift - create new segment, keep old
 * - 'correction': Typo fix or minor clarification - update previous segment
 * - 'same_topic': Same topic, no meaningful new info - do nothing
 * - 'skip': Conversation has no lasting recall value - don't create a memory
 * - 'update_prior': Topic reentry — extend a *prior* (not just last) segment.
 *   B6: handles oscillation like react → auth → react where the latter react
 *   turn should join the earlier react segment instead of creating a third.
 */
type AnalysisAction = 'new' | 'topic_change' | 'correction' | 'same_topic' | 'skip' | 'update_prior';

const SegmentSchema = z.object({
  action: z.enum(['new', 'topic_change', 'correction', 'same_topic', 'skip', 'update_prior']).describe(
    'What action to take. "new" for first/unrelated topic. "topic_change" for significant shift. "correction" for typo fixes that should update the immediately-prior segment. "update_prior" when the conversation has CIRCLED BACK to a topic from one of the older (non-last) segments — extend that older segment, do not create a new one. "same_topic" if nothing meaningful changed. "skip" if no lasting recall value.'
  ),
  summary: z.string().describe('The actual substance/content/answer — not a meta-description of what happened'),
  topics: z.array(z.string()).describe('2-5 topic tags for this segment'),
  reason: z.string().describe('Brief reason for the chosen action'),
  /** B6: when action is "update_prior", which segment to extend (1-based index
   *  into the priorSegments list, where 1 is the most-recent of the priors).
   *  Required for update_prior; ignored otherwise. */
  priorIndex: z.number().int().min(1).optional().describe('1-based index into priorSegments for update_prior'),
});

export interface PriorSegmentContext {
  summary: string;
  topics: string[];
}

export async function analyzeConversationSegment(
  messages: Array<{ role: string; content: any }>,
  previousSummary?: string,
  previousTopics?: string[],
  /** B6: optional additional prior segments (most recent first, excluding the
   *  immediately-prior one which is `previousSummary`). When provided the
   *  analyzer can choose `update_prior` to extend an older segment that the
   *  conversation has circled back to. */
  olderPriorSegments?: PriorSegmentContext[],
): Promise<{ action: AnalysisAction; summary: string; topics: string[]; reason: string; priorIndex?: number }> {
  try {
    const conversationText = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${normalizeConversationContent(m.content)}`)
      .join('\n\n');

    let previousContext: string;
    if (previousSummary) {
      const lines = [
        `Previous summary (most recent segment): "${previousSummary}"`,
        `Previous topics: ${previousTopics?.join(', ') || 'none'}`,
      ];
      if (olderPriorSegments && olderPriorSegments.length > 0) {
        lines.push('', 'Older prior segments (most recent first, 1-indexed for "update_prior"):');
        olderPriorSegments.forEach((seg, i) => {
          const idx = i + 1;
          const topics = seg.topics?.join(', ') || 'none';
          const summaryClip = (seg.summary || '').slice(0, 160);
          lines.push(`  ${idx}. [${topics}] ${summaryClip}`);
        });
      }
      previousContext = lines.join('\n');
    } else {
      previousContext = 'This is a new conversation with no previous segments.';
    }

    const modelId = getDefaultModelForCategory('fast');
    const model = buildNativeProviderModel(modelId);

    const { object } = await generateObject({
      model: model as any,
      schema: SegmentSchema,
      system: `You analyze conversations to extract their core value as a lasting memory.

${previousContext}

## ACTIONS
- "skip": The conversation is a one-off Q&A, generic help, or has NO lasting recall value for the user. Examples: homework help, simple factual lookups, troubleshooting a one-time error, casual chitchat.
- "new": First segment OR completely unrelated to previous — create a new memory.
- "topic_change": Significant topic shift — create a new segment, keep old.
- "correction": Typo fix or minor clarification — update IMMEDIATELY-PREVIOUS segment.
- "update_prior": Conversation has CIRCLED BACK to a topic from one of the *older* prior segments (not the immediately-previous one). Set priorIndex to that segment's 1-based index in "Older prior segments". Prefer this over "new" when the latest user turn clearly relates to an earlier (non-last) topic — keeps the topic timeline consolidated.
- "same_topic": Same topic, no meaningful new info — do nothing.

## CRITICAL: SUMMARY FORMAT
Your summary must capture the ACTUAL SUBSTANCE — the knowledge, decision, fact, or insight itself.

NEVER write meta-descriptions like:
- "The assistant explained how to..." ✗
- "User asked about X and got help with Y" ✗
- "Discussion about configuring..." ✗

INSTEAD write the actual content:
- "Work = F·d (constant force). Work-Energy Theorem: W_net = ΔKE = ½mv²_f - ½mv²_i. Combine by setting F·d equal to ΔKE to solve for unknowns." ✓
- "Decided to use PostgreSQL over MongoDB for the project because of relational data needs and ACID compliance." ✓
- "The API rate limit is 100 req/min. Use exponential backoff with jitter. Cache responses for 5 minutes." ✓

Ask yourself: "If the user sees this summary in 3 months, can they extract value from it without re-reading the conversation?" If no, either rewrite it or use "skip".

## WHEN TO SKIP
- Generic Q&A with no personal/project relevance (homework, trivia, "what is X")
- Troubleshooting a one-time error that won't recur
- Casual conversation with no facts worth remembering
- Simple lookups the user could re-search easily

## WHEN TO REMEMBER
- User made a decision or expressed a preference
- User shared personal info, project details, or workflow choices
- Conversation produced a reusable technique, config, or approach
- User explicitly asked to remember something
- Technical setup/config that would be painful to redo`,
      prompt: conversationText,
      temperature: 0.2,
    });

    return object;
  } catch (error) {
    writeLog('segment_analysis_error', { error: String(error) });
    return {
      action: 'new',
      summary: 'Conversation segment',
      topics: ['general'],
      reason: 'Error during analysis',
    };
  }
}

export async function generateConversationTitle(
  messages: Array<{ role: string; content: any }>
): Promise<string> {
  try {
    const firstMessages = messages.slice(0, 4);
    const text = firstMessages
      .filter(m => m.role === 'user')
      .map(m => normalizeConversationContent(m.content))
      .join(' ')
      .slice(0, 500);

    const modelId = getDefaultModelForCategory('fast');
    const model = buildNativeProviderModel(modelId);

    const { text: title } = await generateText({
      model: model as any,
      system:
        'Generate a short (3-6 word) title for this conversation. Output only the title words — no labels (never "Title:" or similar), no extra text, nothing else.',
      prompt: text,
      temperature: 0.3,
    });

    const normalized = normalizeThreadTitle(title);
    if (normalized) return normalized;
    const firstUser = messages.find((m) => m.role === 'user');
    return fallbackTitleFromMessage(firstUser ? normalizeConversationContent(firstUser.content) : '');
  } catch (error) {
    const firstUser = messages.find((m) => m.role === 'user');
    return fallbackTitleFromMessage(firstUser ? normalizeConversationContent(firstUser.content) : '') || 'New chat';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

export async function createConversation(
  title?: string,
  model?: string,
  conversationId?: string,
  source: 'stuard' | 'workflow' | 'skill' | 'proactive' = 'stuard',
  owner?: MemoryOwnerScope,
): Promise<Conversation | null> {
  try {
    const result = await execLocalTool('conversation_create', {
      title,
      model,
      conversation_id: conversationId,
      source,
      ...serializeOwnerScope(owner),
    });
    
    if (result?.ok && result.conversation) {
      return result.conversation as Conversation;
    }
    return null;
  } catch (error) {
    writeLog('conversation_create_error', { error: String(error) });
    return null;
  }
}

export async function getConversation(conversationId: string): Promise<Conversation | null> {
  try {
    const result = await execLocalTool('conversation_get', { conversation_id: conversationId });
    if (result?.ok && result.conversation) {
      return result.conversation as Conversation;
    }
    return null;
  } catch (error) {
    return null;
  }
}

export async function updateConversation(
  conversationId: string,
  updates: {
    title?: string;
    status?: 'active' | 'archived' | 'deleted';
    embedding?: number[];
    source?: 'stuard' | 'workflow' | 'skill' | 'proactive';
    owner_type?: MemoryOwnerType;
    owner_id?: string | null;
  }
): Promise<Conversation | null> {
  try {
    const result = await execLocalTool('conversation_update', {
      conversation_id: conversationId,
      ...updates,
    });
    if (result?.ok && result.conversation) {
      return result.conversation as Conversation;
    }
    return null;
  } catch (error) {
    return null;
  }
}

export async function listConversations(options?: {
  status?: 'active' | 'archived' | null;
  limit?: number;
  offset?: number;
  source?: 'stuard' | 'workflow' | 'skill' | 'proactive';
}): Promise<Conversation[]> {
  try {
    const result = await execLocalTool('conversation_list', options || {});
    if (result?.ok && result.conversations) {
      return result.conversations as Conversation[];
    }
    return [];
  } catch (error) {
    return [];
  }
}

export async function searchConversations(
  query: string,
  options?: { limit?: number; threshold?: number }
): Promise<Array<{ conversation: Conversation; score: number }>> {
  try {
    const embedding = await generateEmbedding(query);
    if (!embedding.length) return [];

    const result = await execLocalTool('conversation_search', {
      embedding,
      limit: options?.limit || 10,
      threshold: options?.threshold || 0.6,
    });

    if (result?.ok && result.results) {
      return result.results;
    }
    return [];
  } catch (error) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'system' | 'tool',
  content: string,
  options?: {
    tool_calls?: any[];
    tool_results?: any[];
    attachments?: any[];
    metadata?: Record<string, any>;
    embedding?: number[];
  }
): Promise<Message | null> {
  try {
    const result = await execLocalTool('message_add', {
      conversation_id: conversationId,
      role,
      content,
      ...options,
    });
    if (result?.ok && result.message) {
      return result.message as Message;
    }
    return null;
  } catch (error) {
    writeLog('message_add_error', { error: String(error) });
    return null;
  }
}

export async function getMessages(
  conversationId: string,
  options?: { start_turn?: number; end_turn?: number; limit?: number }
): Promise<Message[]> {
  try {
    const result = await execLocalTool('message_list', {
      conversation_id: conversationId,
      ...options,
    });
    if (result?.ok && result.messages) {
      return result.messages as Message[];
    }
    return [];
  } catch (error) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEGMENT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

export async function createSegment(
  conversationId: string,
  startTurn: number,
  summary: string,
  topics: string[],
  options?: { end_turn?: number; embedding?: number[] }
): Promise<ConversationSegment | null> {
  try {
    // Generate embedding if not provided
    let embedding = options?.embedding;
    if (!embedding) {
      const text = `${summary} Topics: ${topics.join(', ')}`;
      embedding = await generateEmbedding(text);
    }

    if (!embedding || embedding.length === 0) {
      writeLog('segment_embedding_missing', { conversationId });
      embedding = undefined;
    }

    const result = await execLocalTool('segment_create', {
      conversation_id: conversationId,
      start_turn: startTurn,
      summary,
      topics,
      embedding,
      end_turn: options?.end_turn,
    });

    if (result?.ok && result.segment) {
      return result.segment as ConversationSegment;
    }
    return null;
  } catch (error) {
    writeLog('segment_create_error', { error: String(error) });
    return null;
  }
}

export async function updateSegment(
  segmentId: string,
  updates: {
    summary?: string;
    topics?: string[];
    end_turn?: number;
    embedding?: number[];
  }
): Promise<ConversationSegment | null> {
  try {
    const result = await execLocalTool('segment_update', {
      segment_id: segmentId,
      ...updates,
    });
    if (result?.ok && result.segment) {
      return result.segment as ConversationSegment;
    }
    return null;
  } catch (error) {
    return null;
  }
}

export async function getSegments(conversationId: string): Promise<ConversationSegment[]> {
  try {
    const result = await execLocalTool('segment_list', { conversation_id: conversationId });
    if (result?.ok && result.segments) {
      return result.segments as ConversationSegment[];
    }
    return [];
  } catch (error) {
    return [];
  }
}

export async function listRecentSegments(options?: {
  limit?: number;
  since?: string;
  before?: string;
  owner?: MemoryOwnerScope;
}): Promise<ConversationSegment[]> {
  try {
    const { owner, ...rest } = options || {};
    const result = await execLocalTool('segment_list_recent', {
      ...rest,
      ...serializeOwnerScope(owner),
    });
    if (result?.ok && result.segments) {
      return result.segments as ConversationSegment[];
    }
    return [];
  } catch (error) {
    return [];
  }
}

export async function searchSegments(
  query: string,
  options?: { limit?: number; threshold?: number; owner?: MemoryOwnerScope }
): Promise<Array<{ segment: ConversationSegment; score: number }>> {
  const embedding = await generateEmbedding(query);
  if (!embedding.length) return [];

  return searchSegmentsByEmbedding(embedding, options);
}

/**
 * Search segments using a pre-computed embedding vector.
 * Use this when the embedding has already been generated (e.g. via shared-embedding)
 * to avoid duplicate OpenAI embedding calls.
 */
export async function searchSegmentsByEmbedding(
  embedding: number[],
  options?: { limit?: number; threshold?: number; owner?: MemoryOwnerScope }
): Promise<Array<{ segment: ConversationSegment; score: number }>> {
  if (!embedding.length) return [];

  const result = await execLocalTool('segment_search', {
    embedding,
    limit: options?.limit ?? 10,
    threshold: options?.threshold ?? 0.6,
    ...serializeOwnerScope(options?.owner),
  }, undefined, 300000, { silent: true });

  if (result?.ok && result.results) {
    return result.results;
  }

  if (result && result.ok === false) {
    writeLog('segment_search_failed', { error: String((result as any).error || 'unknown') });
    throw new Error(String((result as any).error || 'segment_search_failed'));
  }

  writeLog('segment_search_invalid_result', { ok: Boolean(result?.ok) });
  throw new Error('segment_search_invalid_result');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECURITY
// ═══════════════════════════════════════════════════════════════════════════════

export async function getSecuritySettings(): Promise<{
  memory_lock_enabled: boolean;
  lock_timeout_minutes: number;
  has_password: boolean;
  biometric_enabled: boolean;
  sync_enabled: boolean;
  last_sync_at: string | null;
} | null> {
  try {
    const result = await execLocalTool('security_get_settings', {});
    if (result?.ok && result.settings) {
      return result.settings;
    }
    return null;
  } catch (error) {
    return null;
  }
}

export async function verifyMemoryPassword(password: string): Promise<boolean> {
  try {
    const result = await execLocalTool('security_verify_password', { password });
    return result?.ok && result.valid;
  } catch (error) {
    return false;
  }
}

export async function setMemoryPassword(
  password: string,
  currentPassword?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await execLocalTool('security_set_password', {
      password,
      current_password: currentPassword,
    });
    return { ok: result?.ok || false, error: result?.error };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

export async function updateSecuritySettings(settings: {
  memory_lock_enabled?: boolean;
  lock_timeout_minutes?: number;
  biometric_enabled?: boolean;
  sync_enabled?: boolean;
}): Promise<boolean> {
  try {
    const result = await execLocalTool('security_update_settings', settings);
    return result?.ok || false;
  } catch (error) {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getMemoryStats(): Promise<{
  conversations: number;
  conversations_with_embedding?: number;
  messages: number;
  projects: number;
  memories: number;
  journal_entries: number;
  segments: number;
  segments_with_embedding?: number;
  pending_sync: number;
} | null> {
  try {
    const result = await execLocalTool('memory_stats', {});
    if (result?.ok && result.stats) {
      return result.stats;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATION PROCESSING PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ensure a conversation exists locally. Creates it if not found.
 * This is the primary entry point for local conversation storage.
 */
export async function ensureLocalConversation(
  conversationId: string,
  model?: string,
  source: 'stuard' | 'workflow' | 'skill' | 'proactive' = 'stuard',
  owner?: MemoryOwnerScope,
): Promise<Conversation | null> {
  try {
    // Check if conversation exists locally
    let conversation = await getConversation(conversationId);
    
    if (!conversation) {
      // Create it locally
      conversation = await createConversation(undefined, model, conversationId, source, owner);
      writeLog('local_conversation_created', { conversationId });
    } else if (owner?.owner_type && (
      conversation.owner_type !== owner.owner_type
      || (owner.owner_id !== undefined && (conversation.owner_id || null) !== (owner.owner_id || null))
      || conversation.source !== source
    )) {
      conversation = await updateConversation(conversationId, {
        source,
        owner_type: owner.owner_type,
        owner_id: owner.owner_id ?? null,
      }) || conversation;
    }
    
    return conversation;
  } catch (error) {
    writeLog('ensure_conversation_error', { conversationId, error: String(error) });
    return null;
  }
}

/**
 * Store a message locally in the encrypted database.
 */
export async function storeMessageLocally(
  conversationId: string,
  role: 'user' | 'assistant' | 'system' | 'tool',
  content: string,
  options?: {
    tool_calls?: any[];
    tool_results?: any[];
    attachments?: any[];
    metadata?: Record<string, any>;
    model?: string;
    source?: 'stuard' | 'workflow' | 'skill' | 'proactive';
    owner?: MemoryOwnerScope;
  }
): Promise<boolean> {
  try {
    // Ensure conversation exists first
    const conversation = await ensureLocalConversation(
      conversationId,
      options?.model,
      options?.source || 'stuard',
      options?.owner,
    );
    if (!conversation) {
      writeLog('store_message_no_conversation', { conversationId });
      return false;
    }
    
    // Add the message
    const message = await addMessage(conversationId, role, content, options);
    if (message) {
      writeLog('message_stored_locally', { conversationId, role, messageId: message.id });
      return true;
    }
    return false;
  } catch (error) {
    writeLog('store_message_error', { conversationId, error: String(error) });
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOPIC NORMALIZATION — prevent topic fragmentation
// ═══════════════════════════════════════════════════════════════════════════════

const _topicCache = new Map<string, { topics: string[]; expiresAt: number }>();
const TOPIC_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function ownerCacheKey(owner?: MemoryOwnerScope): string {
  return `${owner?.owner_type || 'stuard'}:${owner?.owner_id || ''}`;
}

async function getExistingTopics(owner?: MemoryOwnerScope): Promise<string[]> {
  const key = ownerCacheKey(owner);
  const cached = _topicCache.get(key);
  if (cached && Date.now() < cached.expiresAt && cached.topics.length > 0) {
    return cached.topics;
  }

  try {
    const result = await execLocalTool('segment_build_topic_drawers', {
      limit_topics: 200,
      limit_segments_per_topic: 0,
      segments_scan_limit: 2000,
      ...serializeOwnerScope(owner),
    }, undefined, 10000, { silent: true });

    const drawers: any[] = result?.drawers || [];
    const topics = drawers.map((d: any) => String(d.topic || '').trim()).filter(Boolean);
    _topicCache.set(key, { topics, expiresAt: Date.now() + TOPIC_CACHE_TTL_MS });
    return topics;
  } catch {
    return cached?.topics || []; // return stale cache on error
  }
}

/**
 * Normalize proposed topics against existing topic names.
 * Uses case-insensitive substring matching to merge near-duplicates.
 */
async function normalizeTopics(proposedTopics: string[], owner?: MemoryOwnerScope): Promise<string[]> {
  const existing = await getExistingTopics(owner);
  if (existing.length === 0) return proposedTopics;

  const existingLower = existing.map((t) => t.toLowerCase());

  return proposedTopics.map((proposed) => {
    const pLower = proposed.toLowerCase().trim();
    if (!pLower) return proposed;

    // Exact match (case-insensitive)
    const exactIdx = existingLower.indexOf(pLower);
    if (exactIdx >= 0) return existing[exactIdx];

    // Substring match: "React.js" matches existing "React", "ReactJS" matches "React"
    // Also: "React" matches existing "React Development"
    for (let i = 0; i < existing.length; i++) {
      const eLower = existingLower[i];
      // proposed is a substring of existing (e.g., "React" matches "React Development")
      if (eLower.includes(pLower) && pLower.length >= 3) return existing[i];
      // existing is a substring of proposed (e.g., existing "React" found in "React.js")
      if (pLower.includes(eLower) && eLower.length >= 3) return existing[i];
    }

    // Strip common suffixes and try again
    const stripped = pLower.replace(/\.(js|ts|py|go|rs)$/i, '').replace(/js$/i, '').trim();
    if (stripped !== pLower) {
      const stripIdx = existingLower.indexOf(stripped);
      if (stripIdx >= 0) return existing[stripIdx];
    }

    return proposed; // No match — keep as-is
  });
}

/**
 * Auto-journal: keep one live "session" timeline entry per conversation
 * segment when the conversation is in Project Mode. Runs inside the
 * fire-and-forget turn processor, so the project Timeline stays current
 * without the orchestrator ever calling a journal tool.
 *
 * The entry id is derived from the segment id (`jseg-<segmentId>`), so the
 * same segment always maps to the same entry: new segments create an entry,
 * topic continuations update it in place. Reuses the segment embedding so
 * journal entries participate in semantic recall for free.
 */
async function upsertProjectSessionJournal(args: {
  projectId: string;
  conversationId: string;
  segmentId: string;
  summary: string;
  topics: string[];
  embedding?: number[];
}): Promise<void> {
  const { projectId, conversationId, segmentId, summary, topics } = args;
  if (!projectId || !segmentId) return;

  const entryId = `jseg-${segmentId}`;
  const title = (topics || []).filter(Boolean).slice(0, 3).join(' · ')
    || String(summary || '').slice(0, 64)
    || 'Chat session';
  const body = String(summary || '').trim() || undefined;
  const embedding = args.embedding && args.embedding.length > 0 ? args.embedding : undefined;

  try {
    const updated = await execLocalTool('journal_update', {
      entry_id: entryId,
      title,
      body,
      source_ref: { conversation_id: conversationId, segment_id: segmentId },
      embedding,
    }, undefined, 10000, { silent: true });

    if (updated?.ok) {
      writeLog('auto_journal_updated', { projectId, conversationId, entryId });
      return;
    }

    const created = await execLocalTool('journal_add', {
      project_id: projectId,
      entry_id: entryId,
      type: 'chat_summary',
      title,
      body,
      source: 'auto-chat',
      source_ref: { conversation_id: conversationId, segment_id: segmentId },
      embedding,
    }, undefined, 10000, { silent: true });

    if (created?.ok) {
      writeLog('auto_journal_created', { projectId, conversationId, entryId });
    } else {
      writeLog('auto_journal_failed', {
        projectId, conversationId, entryId,
        error: String(created?.error || updated?.error || 'unknown'),
      });
    }
  } catch (error) {
    writeLog('auto_journal_error', { projectId, conversationId, error: String(error) });
  }
}

export async function processConversationTurn(
  conversationId: string,
  messages: Array<{ role: string; content: any }>,
  options?: { source?: 'stuard' | 'workflow' | 'skill' | 'proactive'; owner?: MemoryOwnerScope },
): Promise<void> {
  try {
    // Ensure conversation exists locally first
    const conversation = await ensureLocalConversation(
      conversationId,
      undefined,
      options?.source || 'stuard',
      options?.owner,
    );
    if (!conversation) {
      writeLog('process_turn_no_conversation', { conversationId });
      return;
    }

    // Use passed messages length as the turn count since local DB may not be updated yet
    const turnCount = Math.max(conversation.message_count, messages.length);

    // Generate title if this is early in the conversation
    if (turnCount <= 4 && !conversation.title) {
      const title = await generateConversationTitle(messages);
      await updateConversation(conversationId, { title });
    }

    // Skip processing if no messages
    if (messages.length === 0) {
      writeLog('process_turn_no_messages', { conversationId });
      return;
    }

    // Get existing segments
    const segments = await getSegments(conversationId);
    const lastSegment = segments[segments.length - 1];
    // B6: feed up to 3 older priors (most recent first, excluding the immediately-prior one)
    // so the analyzer can detect topic reentry and pick update_prior.
    const OLDER_PRIOR_LOOKBACK = 3;
    const olderPriors = segments.slice(0, -1).slice(-OLDER_PRIOR_LOOKBACK).reverse();
    const olderPriorPayload: PriorSegmentContext[] = olderPriors.map((s) => ({
      summary: s.summary || '',
      topics: Array.isArray(s.topics) ? s.topics : [],
    }));

    // AI analyzes the conversation to decide what action to take
    const analysis = await analyzeConversationSegment(
      messages.map(m => ({ role: m.role, content: m.content })),
      lastSegment?.summary,
      lastSegment?.topics,
      olderPriorPayload,
    );

    // Normalize topics to prevent fragmentation (React.js -> React, etc.)
    analysis.topics = await normalizeTopics(analysis.topics, options?.owner);

    writeLog('segment_analysis', {
      conversationId,
      action: analysis.action,
      reason: analysis.reason,
      topics: analysis.topics
    });

    // Auto-journal gate: only the user's main chat writes to a project's
    // Timeline — bot/agent/workflow conversations never do, even if they
    // somehow carry a project stamp.
    const ownerType = options?.owner?.owner_type;
    const autoJournalProjectId =
      (options?.source ?? 'stuard') === 'stuard' && (!ownerType || ownerType === 'stuard')
        ? (conversation.project_id ? String(conversation.project_id) : null)
        : null;

    // Handle based on AI's decision
    switch (analysis.action) {
      case 'new':
      case 'topic_change': {
        // Create new segment with embedding
        const segmentText = `${analysis.summary} Topics: ${analysis.topics.join(', ')}`;
        const segmentEmbedding = await generateEmbedding(segmentText);

        // Close previous segment if exists
        if (lastSegment) {
          await updateSegment(lastSegment.id, { end_turn: turnCount - 1 });
        }

        // Create new segment
        const newSegment = await createSegment(
          conversationId,
          lastSegment ? turnCount : 0,
          analysis.summary,
          analysis.topics,
          { embedding: segmentEmbedding }
        );

        // Update conversation embedding
        const embedding = await generateConversationEmbedding(messages.slice(-50));
        if (embedding.length > 0) {
          await updateConversation(conversationId, { embedding });
        }

        writeLog('segment_created', {
          conversationId,
          segmentId: newSegment?.id,
          action: analysis.action,
          topics: analysis.topics
        });

        if (autoJournalProjectId && newSegment?.id) {
          await upsertProjectSessionJournal({
            projectId: autoJournalProjectId,
            conversationId,
            segmentId: newSegment.id,
            summary: analysis.summary,
            topics: analysis.topics,
            embedding: segmentEmbedding,
          });
        }
        break;
      }

      case 'correction': {
        // Update previous segment with corrected summary and re-embed
        if (lastSegment) {
          const segmentText = `${analysis.summary} Topics: ${analysis.topics.join(', ')}`;
          const segmentEmbedding = await generateEmbedding(segmentText);

          await updateSegment(lastSegment.id, {
            summary: analysis.summary,
            topics: analysis.topics,
            end_turn: turnCount,
            embedding: segmentEmbedding.length > 0 ? segmentEmbedding : undefined,
          });

          // Update conversation embedding
          const embedding = await generateConversationEmbedding(messages.slice(-50));
          if (embedding.length > 0) {
            await updateConversation(conversationId, { embedding });
          }

          writeLog('segment_corrected', {
            conversationId,
            segmentId: lastSegment.id,
            topics: analysis.topics
          });

          if (autoJournalProjectId) {
            await upsertProjectSessionJournal({
              projectId: autoJournalProjectId,
              conversationId,
              segmentId: lastSegment.id,
              summary: analysis.summary,
              topics: analysis.topics,
              embedding: segmentEmbedding,
            });
          }
        } else {
          // No previous segment, treat as new
          const segmentText = `${analysis.summary} Topics: ${analysis.topics.join(', ')}`;
          const segmentEmbedding = await generateEmbedding(segmentText);

          const newSegment = await createSegment(
            conversationId,
            0,
            analysis.summary,
            analysis.topics,
            { embedding: segmentEmbedding }
          );

          const embedding = await generateConversationEmbedding(messages.slice(-50));
          if (embedding.length > 0) {
            await updateConversation(conversationId, { embedding });
          }

          writeLog('segment_created_from_correction', {
            conversationId,
            segmentId: newSegment?.id
          });

          if (autoJournalProjectId && newSegment?.id) {
            await upsertProjectSessionJournal({
              projectId: autoJournalProjectId,
              conversationId,
              segmentId: newSegment.id,
              summary: analysis.summary,
              topics: analysis.topics,
              embedding: segmentEmbedding,
            });
          }
        }
        break;
      }

      case 'same_topic': {
        // Do nothing - topic is the same with no meaningful new info
        writeLog('segment_unchanged', {
          conversationId,
          reason: analysis.reason
        });
        break;
      }

      case 'skip': {
        // Conversation has no lasting recall value - don't create a memory
        writeLog('segment_skipped', {
          conversationId,
          reason: analysis.reason
        });
        break;
      }

      case 'update_prior': {
        // B6: conversation circled back to an older topic — extend that
        // segment's range and merge the new summary/topics. Falls back to
        // 'new' if the index is missing or out of range (analyzer was wrong).
        const idx = analysis.priorIndex;
        const target = (idx && idx >= 1 && idx <= olderPriors.length) ? olderPriors[idx - 1] : null;
        if (target) {
          // Merge topics and union with existing, preserving order
          const mergedTopics = Array.from(new Set([...(target.topics || []), ...analysis.topics]));
          const mergedSummary = analysis.summary; // analyzer is told to produce the merged substance
          const segmentText = `${mergedSummary} Topics: ${mergedTopics.join(', ')}`;
          const segmentEmbedding = await generateEmbedding(segmentText);

          await updateSegment(target.id, {
            summary: mergedSummary,
            topics: mergedTopics,
            end_turn: turnCount,
            embedding: segmentEmbedding.length > 0 ? segmentEmbedding : undefined,
          });

          const embedding = await generateConversationEmbedding(messages.slice(-50));
          if (embedding.length > 0) {
            await updateConversation(conversationId, { embedding });
          }

          writeLog('segment_updated_prior', {
            conversationId,
            segmentId: target.id,
            priorIndex: idx,
            topics: mergedTopics,
          });

          if (autoJournalProjectId) {
            await upsertProjectSessionJournal({
              projectId: autoJournalProjectId,
              conversationId,
              segmentId: target.id,
              summary: mergedSummary,
              topics: mergedTopics,
              embedding: segmentEmbedding,
            });
          }
        } else {
          // Bad index — fall back to creating a new segment.
          const segmentText = `${analysis.summary} Topics: ${analysis.topics.join(', ')}`;
          const segmentEmbedding = await generateEmbedding(segmentText);
          if (lastSegment) {
            await updateSegment(lastSegment.id, { end_turn: turnCount - 1 });
          }
          const newSegment = await createSegment(
            conversationId,
            lastSegment ? turnCount : 0,
            analysis.summary,
            analysis.topics,
            { embedding: segmentEmbedding }
          );
          writeLog('segment_update_prior_fallback', {
            conversationId,
            segmentId: newSegment?.id,
            reason: 'invalid priorIndex',
            priorIndex: idx,
          });

          if (autoJournalProjectId && newSegment?.id) {
            await upsertProjectSessionJournal({
              projectId: autoJournalProjectId,
              conversationId,
              segmentId: newSegment.id,
              summary: analysis.summary,
              topics: analysis.topics,
              embedding: segmentEmbedding,
            });
          }
        }
        break;
      }
    }

    writeLog('conversation_processed', {
      conversationId,
      turnCount,
      segmentCount: segments.length,
      action: analysis.action,
    });
  } catch (error) {
    writeLog('conversation_processing_error', { conversationId, error: String(error) });
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION CONTEXT — runtime injection of relevant topic summaries
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a concise collection-context block for prompt injection.
 *
 * Given a query embedding, finds the most relevant topic drawers and
 * returns a formatted text block that can be appended to the knowledge context.
 * Also checks pre-computed collection summaries.
 */
export async function buildCollectionContext(
  queryEmbedding: number[],
  options?: { maxTopics?: number; owner?: MemoryOwnerScope }
): Promise<string> {
  const maxTopics = options?.maxTopics ?? 3;

  try {
    const result = await execLocalTool('segment_search_drawers_by_embedding', {
      vector: queryEmbedding,
      limit: maxTopics,
      ...serializeOwnerScope(options?.owner),
    }, undefined, 10000);

    if (!result?.ok) return '';

    const sections: string[] = [];

    // Prefer pre-computed collection summaries if available
    const collectionSummaries: any[] = result.collection_summaries || [];
    const topicHits: any[] = result.topics || [];

    // Merge: use collection summaries when available, fall back to raw topic hits
    const usedTopics = new Set<string>();
    for (const cs of collectionSummaries.slice(0, maxTopics)) {
      if (!cs.topic || !cs.summary) continue;
      sections.push(`- "${cs.topic}" (${cs.segment_count || '?'} conversations): ${cs.summary}`);
      usedTopics.add(String(cs.topic).toLowerCase());
    }

    // Fill remaining slots with raw topic hits
    for (const hit of topicHits) {
      if (sections.length >= maxTopics) break;
      if (usedTopics.has(String(hit.topic || '').toLowerCase())) continue;
      sections.push(`- "${hit.topic}" (${hit.segment_count || '?'} conversations, latest: ${String(hit.latest_at || '').slice(0, 10) || '?'})`);
    }

    if (sections.length === 0) return '';

    return `[RELEVANT COLLECTIONS]\n${sections.join('\n')}`;
  } catch (error) {
    writeLog('build_collection_context_error', { error: String(error) });
    return '';
  }
}
