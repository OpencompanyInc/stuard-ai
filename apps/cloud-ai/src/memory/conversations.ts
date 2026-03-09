/**
 * Conversation Memory Service
 * 
 * Handles:
 * - Conversation storage and retrieval via local agent
 * - Embedding generation for conversations and segments
 * - Topic segmentation and summarization
 * - Search across conversation history
 */

import { buildProviderModel } from '../utils/models';
import { getDefaultModelForCategory } from '../pricing';
import { embed, generateObject, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { execLocalTool } from '../tools/bridge';
import { writeLog } from '../utils/logger';
import { contentToText } from '../utils/messages';

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

export interface Space {
  id: string;
  name: string;
  description: string | null;
  type: 'project' | 'topic' | 'research' | 'reference' | 'custom';
  icon: string;
  color: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
}

export interface SpaceItem {
  id: string;
  space_id: string;
  type: 'note' | 'source' | 'link' | 'file' | 'fact' | 'snippet' | 'folder';
  title: string | null;
  content: string;
  metadata: Record<string, any> | null;
  added_by: 'user' | 'ai';
  pinned: boolean;
  parent_id?: string | null;
  position?: number;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMBEDDING
// ═══════════════════════════════════════════════════════════════════════════════

const EMBEDDING_MODEL = 'text-embedding-3-large';

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
      model: openai.embedding(EMBEDDING_MODEL),
      value: text.slice(0, 8000), // Limit input length
    });
    return embedding;
  } catch (error) {
    writeLog('embedding_error', { error: String(error) });
    return [];
  }
}

export async function createSpaceFolder(
  spaceId: string,
  name: string,
  options?: { parent_id?: string; position?: number }
): Promise<SpaceItem | null> {
  try {
    const result = await execLocalTool('space_folder_create', {
      space_id: spaceId,
      name,
      ...options,
    });
    if (result?.ok && result.folder) {
      return result.folder as SpaceItem;
    }
    return null;
  } catch (error) {
    return null;
  }
}

export async function getSpaceTree(spaceId: string): Promise<any[] | null> {
  try {
    const result = await execLocalTool('space_get_tree', { space_id: spaceId });
    if (result?.ok && result.tree) {
      return result.tree as any[];
    }
    return null;
  } catch (error) {
    return null;
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
 */
type AnalysisAction = 'new' | 'topic_change' | 'correction' | 'same_topic';

const SegmentSchema = z.object({
  action: z.enum(['new', 'topic_change', 'correction', 'same_topic']).describe(
    'What action to take: "new" for first/unrelated topic, "topic_change" for significant shift, "correction" for typo fixes, "same_topic" if nothing meaningful changed'
  ),
  summary: z.string().describe('A concise 1-2 sentence summary of the conversation so far (or the new topic if topic_change)'),
  topics: z.array(z.string()).describe('2-5 topic tags for this segment'),
  reason: z.string().describe('Brief reason for the chosen action'),
});

export async function analyzeConversationSegment(
  messages: Array<{ role: string; content: any }>,
  previousSummary?: string,
  previousTopics?: string[]
): Promise<{ action: AnalysisAction; summary: string; topics: string[]; reason: string }> {
  try {
    const conversationText = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${normalizeConversationContent(m.content)}`)
      .join('\n\n');

    const previousContext = previousSummary
      ? `Previous summary: "${previousSummary}"\nPrevious topics: ${previousTopics?.join(', ') || 'none'}`
      : 'This is a new conversation with no previous segments.';

    const modelId = getDefaultModelForCategory('fast');
    const model = buildProviderModel(modelId);

    const { object } = await generateObject({
      model: model as any,
      schema: SegmentSchema,
      system: `You analyze conversations to determine how to update the memory/summary.

${previousContext}

Choose the appropriate action:
- "new": This is the first segment OR the topic is completely unrelated to previous
- "topic_change": The conversation has shifted to a significantly different subject (keep the old segment, create new)
- "correction": The latest message was just a typo fix, clarification, or minor correction (update existing summary)
- "same_topic": The conversation continues on the same topic with no meaningful new information to add (do nothing)

Rules:
- Summary should capture the main intent/outcome
- Topics should be specific but not too narrow
- Be conservative with "topic_change" - only use for significant shifts
- Use "same_topic" if the new messages don't add substantial information worth summarizing`,
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
    const model = buildProviderModel(modelId);

    const { text: title } = await generateText({
      model: model as any,
      system: 'Generate a short (3-6 word) title for this conversation. Output only the title, nothing else.',
      prompt: text,
      temperature: 0.3,
    });

    return title.trim().replace(/^["']|["']$/g, '').slice(0, 80);
  } catch (error) {
    return 'New Conversation';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

export async function createConversation(
  title?: string,
  model?: string,
  conversationId?: string,
  source: 'stuard' | 'workflow' | 'skill' | 'proactive' = 'stuard'
): Promise<Conversation | null> {
  try {
    const result = await execLocalTool('conversation_create', {
      title,
      model,
      conversation_id: conversationId,
      source,
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
}): Promise<ConversationSegment[]> {
  try {
    const result = await execLocalTool('segment_list_recent', options || {});
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
  options?: { limit?: number; threshold?: number }
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
  options?: { limit?: number; threshold?: number }
): Promise<Array<{ segment: ConversationSegment; score: number }>> {
  if (!embedding.length) return [];

  const result = await execLocalTool('segment_search', {
    embedding,
    limit: options?.limit ?? 10,
    threshold: options?.threshold ?? 0.6,
  });

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
// SPACE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

export async function createSpace(
  name: string,
  type: Space['type'],
  options?: { description?: string; icon?: string; color?: string }
): Promise<Space | null> {
  try {
    // Generate embedding for search
    const text = `${name} ${options?.description || ''}`;
    const embedding = await generateEmbedding(text);

    const result = await execLocalTool('space_create', {
      name,
      type,
      ...options,
      embedding,
    });

    if (result?.ok && result.space) {
      return result.space as Space;
    }
    return null;
  } catch (error) {
    writeLog('space_create_error', { error: String(error) });
    return null;
  }
}

export async function getSpace(spaceId: string): Promise<Space | null> {
  try {
    const result = await execLocalTool('space_get', { space_id: spaceId });
    if (result?.ok && result.space) {
      return result.space as Space;
    }
    return null;
  } catch (error) {
    return null;
  }
}

export async function listSpaces(options?: {
  type?: Space['type'];
  include_archived?: boolean;
  limit?: number;
}): Promise<Space[]> {
  try {
    const result = await execLocalTool('space_list', options || {});
    if (result?.ok && result.spaces) {
      return result.spaces as Space[];
    }
    return [];
  } catch (error) {
    return [];
  }
}

export async function updateSpace(
  spaceId: string,
  updates: Partial<Pick<Space, 'name' | 'description' | 'icon' | 'color' | 'archived'>>
): Promise<Space | null> {
  try {
    const result = await execLocalTool('space_update', {
      space_id: spaceId,
      ...updates,
    });
    if (result?.ok && result.space) {
      return result.space as Space;
    }
    return null;
  } catch (error) {
    return null;
  }
}

export async function deleteSpace(spaceId: string): Promise<boolean> {
  try {
    const result = await execLocalTool('space_delete', { space_id: spaceId });
    return result?.ok && result.deleted;
  } catch (error) {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPACE ITEM MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

export async function addSpaceItem(
  spaceId: string,
  type: SpaceItem['type'],
  content: string,
  options?: {
    title?: string;
    metadata?: Record<string, any>;
    added_by?: 'user' | 'ai';
    pinned?: boolean;
    parent_id?: string;
    position?: number;
  }
): Promise<SpaceItem | null> {
  try {
    // Generate embedding for search
    const text = `${options?.title || ''} ${content}`.trim();
    const embedding = await generateEmbedding(text);

    const result = await execLocalTool('space_item_add', {
      space_id: spaceId,
      type,
      content,
      ...options,
      embedding,
    });

    if (result?.ok && result.item) {
      return result.item as SpaceItem;
    }
    return null;
  } catch (error) {
    writeLog('space_item_add_error', { error: String(error) });
    return null;
  }
}

export async function getSpaceItems(
  spaceId: string,
  options?: {
    type?: SpaceItem['type'];
    pinned_only?: boolean;
    parent_id?: string;
    include_all?: boolean;
    limit?: number;
  }
): Promise<SpaceItem[]> {
  try {
    const result = await execLocalTool('space_item_list', {
      space_id: spaceId,
      ...options,
    });
    if (result?.ok && result.items) {
      return result.items as SpaceItem[];
    }
    return [];
  } catch (error) {
    return [];
  }
}

export async function updateSpaceItem(
  itemId: string,
  updates: Partial<Pick<SpaceItem, 'title' | 'content' | 'metadata' | 'pinned'>>
): Promise<SpaceItem | null> {
  try {
    const result = await execLocalTool('space_item_update', {
      item_id: itemId,
      ...updates,
    });
    if (result?.ok && result.item) {
      return result.item as SpaceItem;
    }
    return null;
  } catch (error) {
    return null;
  }
}

export async function deleteSpaceItem(itemId: string): Promise<boolean> {
  try {
    const result = await execLocalTool('space_item_delete', { item_id: itemId });
    return result?.ok && result.deleted;
  } catch (error) {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPACE-CONVERSATION LINKING
// ═══════════════════════════════════════════════════════════════════════════════

export async function linkConversationToSpace(
  spaceId: string,
  conversationId: string,
  options?: { relevance_score?: number; auto_linked?: boolean }
): Promise<boolean> {
  try {
    const result = await execLocalTool('space_link_conversation', {
      space_id: spaceId,
      conversation_id: conversationId,
      ...options,
    });
    return result?.ok || false;
  } catch (error) {
    return false;
  }
}

export async function unlinkConversationFromSpace(
  spaceId: string,
  conversationId: string
): Promise<boolean> {
  try {
    const result = await execLocalTool('space_unlink_conversation', {
      space_id: spaceId,
      conversation_id: conversationId,
    });
    return result?.ok && result.unlinked;
  } catch (error) {
    return false;
  }
}

export async function getSpaceConversations(
  spaceId: string
): Promise<Array<{ conversation: Conversation; relevance_score: number }>> {
  try {
    const result = await execLocalTool('space_get_conversations', { space_id: spaceId });
    if (result?.ok && result.conversations) {
      return result.conversations;
    }
    return [];
  } catch (error) {
    return [];
  }
}

export async function getConversationSpaces(conversationId: string): Promise<Space[]> {
  try {
    const result = await execLocalTool('conversation_get_spaces', {
      conversation_id: conversationId,
    });
    if (result?.ok && result.spaces) {
      return result.spaces as Space[];
    }
    return [];
  } catch (error) {
    return [];
  }
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
  spaces: number;
  space_items: number;
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
  source: 'stuard' | 'workflow' | 'skill' | 'proactive' = 'stuard'
): Promise<Conversation | null> {
  try {
    // Check if conversation exists locally
    let conversation = await getConversation(conversationId);
    
    if (!conversation) {
      // Create it locally
      conversation = await createConversation(undefined, model, conversationId, source);
      writeLog('local_conversation_created', { conversationId });
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
  }
): Promise<boolean> {
  try {
    // Ensure conversation exists first
    const conversation = await ensureLocalConversation(conversationId, options?.model, options?.source || 'stuard');
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

export async function processConversationTurn(
  conversationId: string,
  messages: Array<{ role: string; content: any }>
): Promise<void> {
  try {
    // Ensure conversation exists locally first
    const conversation = await ensureLocalConversation(conversationId);
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

    // AI analyzes the conversation to decide what action to take
    const analysis = await analyzeConversationSegment(
      messages.map(m => ({ role: m.role, content: m.content })),
      lastSegment?.summary,
      lastSegment?.topics
    );

    writeLog('segment_analysis', { 
      conversationId, 
      action: analysis.action, 
      reason: analysis.reason,
      topics: analysis.topics 
    });

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
