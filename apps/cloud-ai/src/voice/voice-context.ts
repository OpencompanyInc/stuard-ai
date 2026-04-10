/**
 * Voice Context Builder
 *
 * Builds user-aware system prompts and tool definitions for AI voice calls.
 * Loads user context from Supabase (recent conversations, profile) and
 * defines the tools the voice AI can call mid-conversation.
 *
 * Design: Keep the pre-call work compact, but preload a short runtime-memory
 * summary from the user's configured desktop/vm route when available. The
 * live model then gets a voice-safe orchestrator-style tool surface for
 * on-demand actions during the call.
 */

import type { VoiceToolDefinition } from './types';
import {
  getConversationMessages,
  getSyncPreferences,
  getSupabaseService,
} from '../supabase';
import {
  getIdentityLens,
  getDirectiveLens,
  getBioLens,
  type Fact,
} from '../knowledge/retrieval';
import {
  getMessages as getLocalMessages,
  listConversations as listLocalConversations,
} from '../memory/conversations';
import { getDesktopWs } from '../services/vm-bridge';
import { withClientBridge } from '../tools/bridge';
import {
  VOICE_TOOL_DEFINITIONS,
  loadVoiceRuntimeMemorySummary,
} from './voice-runtime-tools';

// ── Voice Tool Definitions ──────────────────────────────────────────────────
// These are the voice-safe tools the model can call during a live call.
// They mirror the orchestrator pattern while excluding UI-only tools.
const VOICE_TOOLS: VoiceToolDefinition[] = VOICE_TOOL_DEFINITIONS;

// ── System Prompt Builder ───────────────────────────────────────────────────

function buildVoiceSystemPrompt(opts: {
  userName?: string;
  direction: 'inbound' | 'outbound';
  callerNumber?: string;
  recentContext?: string;
  runtimeMemorySummary?: string;
  runtimeMemorySource?: string;
  customPrompt?: string;
  identityFacts?: Fact[];
  directiveFacts?: Fact[];
  bioFacts?: Fact[];
}): string {
  const { userName, direction, callerNumber, recentContext, runtimeMemorySummary, runtimeMemorySource, customPrompt,
    identityFacts, directiveFacts, bioFacts } = opts;

  const userRef = userName ? `The user's name is ${userName}.` : '';
  const directionCtx = direction === 'inbound'
    ? `This is an inbound call — the user called you.${callerNumber ? ` Caller: ${callerNumber}.` : ''}`
    : 'This is an outbound call — you called the user.';

  const parts: string[] = [
    `You are Stuard, a proactive and warm AI assistant on a live phone call.`,
    directionCtx,
    userRef,
  ];

  // Inject user identity from knowledge graph (name, occupation, timezone, etc.)
  if (identityFacts && identityFacts.length > 0) {
    const validFacts = identityFacts.filter(f => f.text && !isPlaceholder(f.text));
    if (validFacts.length > 0) {
      parts.push('', 'What you know about the user:');
      for (const f of validFacts) {
        const key = f.attribute_key || 'info';
        parts.push(`- ${formatKey(key)}: ${f.text}`);
      }
    }
  }

  // Inject bio facts (preferences, habits, relationships)
  if (bioFacts && bioFacts.length > 0) {
    parts.push('', 'About the user:');
    for (const f of bioFacts) {
      parts.push(`- ${f.text}`);
    }
  }

  // Inject system instructions/directives
  if (directiveFacts && directiveFacts.length > 0) {
    parts.push('', 'User-configured instructions:');
    for (const f of directiveFacts) {
      parts.push(`- ${f.text}`);
    }
  }

  parts.push(
    '',
    'Voice call guidelines:',
    '- Be concise and conversational — this is a phone call, not a text chat.',
    '- Use natural speech patterns. Avoid bullet points, markdown, or overly structured responses.',
    '- Confirm understanding before taking actions.',
    '- If the user asks you to do something and you have the tools, do it. Use search_tools, then get_tool_schema when needed, then execute_tool.',
    '- Use delegate for bigger multi-step jobs that need a focused subagent.',
    '- Use search_memory when you need history or personal context from past conversations or runtime memory.',
    '- If the user wants you to send them something (a link, info, confirmation), use send_sms to text it to them.',
    '- Do not use ask_user, chat_ui, or other visual/UI-only flows during a phone call. If you need more information, ask the caller verbally.',
    '- If a delegated subagent asks a question, ask the caller verbally and answer it with reply_to_subagent.',
    '- When calling tools, briefly tell the user what you\'re doing (e.g. "Let me look that up for you").',
  );

  if (customPrompt) {
    parts.push('', 'Additional instructions:', customPrompt);
  }

  if (recentContext) {
    parts.push('', 'Recent conversation context (for reference):', recentContext);
  }

  if (runtimeMemorySummary) {
    const sourceLabel = runtimeMemorySource ? ` (${runtimeMemorySource})` : '';
    parts.push('', `Runtime memory preloaded${sourceLabel}:`, runtimeMemorySummary);
  }

  return parts.filter(p => p !== undefined).join('\n');
}

function formatKey(key: string): string {
  return key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function isPlaceholder(value: string): boolean {
  const v = value.trim().toLowerCase();
  return !v || v === 'unknown' || v === 'n/a' || v === 'not provided' ||
    v === 'not set' || v === 'tbd' || v === 'pending' ||
    v === "[user's response needed]" || v === '[user response needed]';
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface VoiceContext {
  systemPrompt: string;
  tools: VoiceToolDefinition[];
  userId: string;
  userName?: string;
}

/**
 * Load knowledge facts through the desktop bridge (if connected).
 * Knowledge graph lives in local SQLite on the user's machine — the desktop
 * client must be online for these to be available. Degrades gracefully.
 */
async function loadKnowledgeFacts(userId: string): Promise<{
  identity: Fact[];
  directives: Fact[];
  bio: Fact[];
}> {
  const empty = { identity: [] as Fact[], directives: [] as Fact[], bio: [] as Fact[] };

  // Try desktop bridge first (full knowledge graph access)
  const desktopWs = getDesktopWs(userId);
  if (desktopWs) {
    try {
      const result = await withClientBridge(desktopWs, async () => {
        const [identity, directives, bio] = await Promise.all([
          getIdentityLens().catch(() => [] as Fact[]),
          getDirectiveLens().catch(() => [] as Fact[]),
          getBioLens(10).catch(() => [] as Fact[]),
        ]);
        return { identity, directives, bio };
      }) as { identity: Fact[]; directives: Fact[]; bio: Fact[] };
      return result;
    } catch (e: any) {
      console.warn('[voice-context] Desktop bridge failed, trying Supabase fallback:', e?.message);
    }
  }

  const syncPrefs = await getSyncPreferences(userId);
  if (!syncPrefs.sync_memories) return empty;

  // Cloud-sync fallback: load knowledge facts directly from Supabase
  const supabase = getSupabaseService();
  if (!supabase) return empty;

  try {
    const [identityRes, directiveRes, bioRes] = await Promise.all([
      supabase.from('knowledge_facts')
        .select('id, entity_id, category, subtype, attribute_key, text, created_at, validity, source')
        .eq('owner', userId).eq('category', 'identity').eq('validity', true).limit(20),
      supabase.from('knowledge_facts')
        .select('id, entity_id, category, subtype, attribute_key, text, created_at, validity, source')
        .eq('owner', userId).eq('category', 'directive').eq('validity', true).limit(10),
      supabase.from('knowledge_facts')
        .select('id, entity_id, category, subtype, attribute_key, text, created_at, validity, source')
        .eq('owner', userId).eq('category', 'bio').eq('validity', true).limit(10),
    ]);

    return {
      identity: (identityRes.data || []) as Fact[],
      directives: (directiveRes.data || []) as Fact[],
      bio: (bioRes.data || []) as Fact[],
    };
  } catch (e: any) {
    console.warn('[voice-context] Supabase knowledge fallback failed:', e?.message);
    return empty;
  }
}

async function loadRecentContextFromDesktop(userId: string): Promise<string> {
  const desktopWs = getDesktopWs(userId);
  if (!desktopWs) return '';

  try {
    const recentContext = await withClientBridge(desktopWs, async () => {
      const conversations = await listLocalConversations({ limit: 3 }).catch(() => []);
      if (!Array.isArray(conversations) || conversations.length === 0) return '';

      const summaries = await Promise.all(
        conversations.slice(0, 3).map(async (conv) => {
          const title = conv.title || 'Untitled conversation';
          const date = new Date(conv.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric',
          });
          const msgs = await getLocalMessages(conv.id, { limit: 2 }).catch(() => []);
          if (!Array.isArray(msgs) || msgs.length === 0) {
            return `[${date}] ${title}`;
          }
          const preview = msgs.map((m) =>
            `${m.role === 'user' ? 'User' : 'You'}: ${String(m.content).slice(0, 80)}${m.content.length > 80 ? '...' : ''}`,
          ).join(' | ');
          return `[${date}] ${title}: ${preview}`;
        }),
      );

      return summaries.filter(Boolean).join('\n');
    });
    return typeof recentContext === 'string' ? recentContext : '';
  } catch (e: any) {
    console.warn('[voice-context] Desktop recent-context lookup failed:', e?.message);
    return '';
  }
}

/**
 * Build voice context for a user making/receiving a call.
 * Loads user profile and recent conversation context from local SQLite when
 * the desktop bridge is available, otherwise from Supabase when sync allows it.
 * Designed to be fast — no embedding search, just direct DB queries.
 */
export async function buildVoiceContext(opts: {
  userId: string;
  direction: 'inbound' | 'outbound';
  callerNumber?: string;
  customPrompt?: string;
}): Promise<VoiceContext> {
  const { userId, direction, callerNumber, customPrompt } = opts;

  // Load recent context + knowledge graph + configured runtime memory in parallel.
  const [recentMessages, userName, knowledge, runtimeMemory] = await Promise.all([
    loadRecentContext(userId).catch(() => ''),
    loadUserName(userId).catch(() => undefined),
    loadKnowledgeFacts(userId),
    loadVoiceRuntimeMemorySummary(userId).catch(() => ({ source: undefined, summary: '' })),
  ]);
  const { identity: identityFacts, directives: directiveFacts, bio: bioFacts } = knowledge;

  // Extract real name from identity facts if available (overrides email-derived name)
  const knownName = identityFacts.find(f => f.attribute_key === 'name' && f.text && !isPlaceholder(f.text))?.text;
  const effectiveName = knownName || userName;

  const systemPrompt = buildVoiceSystemPrompt({
    userName: effectiveName,
    direction,
    callerNumber,
    recentContext: recentMessages || undefined,
    runtimeMemorySummary: runtimeMemory.summary || undefined,
    runtimeMemorySource: runtimeMemory.source,
    customPrompt,
    identityFacts,
    directiveFacts,
    bioFacts,
  });

  return {
    systemPrompt,
    tools: VOICE_TOOLS,
    userId,
    userName: effectiveName,
  };
}

/**
 * Load user display name from Supabase auth metadata.
 */
async function loadUserName(userId: string): Promise<string | undefined> {
  const supabase = getSupabaseService();
  if (!supabase) return undefined;
  try {
    const { data } = await supabase
      .from('users_billing')
      .select('email')
      .eq('user_id', userId)
      .limit(1)
      .single();
    // Extract name from email prefix as fallback
    if (data?.email) {
      const name = data.email.split('@')[0].replace(/[._-]+/g, ' ');
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Load recent conversation context from local SQLite when the desktop bridge
 * is available, otherwise from Supabase when conversation sync is enabled.
 * Returns a compact summary of recent interactions.
 */
async function loadRecentContext(userId: string): Promise<string> {
  try {
    const desktopRecent = await loadRecentContextFromDesktop(userId);
    if (desktopRecent) return desktopRecent;

    const syncPrefs = await getSyncPreferences(userId);
    if (!syncPrefs.sync_conversations) return '';

    const supabase = getSupabaseService();
    if (!supabase) return '';

    // Get the 3 most recent conversations with their last messages
    const { data: convs } = await supabase
      .from('conversations')
      .select('id, title, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(3);

    if (!convs || convs.length === 0) return '';

    const summaries: string[] = [];
    for (const conv of convs) {
      const title = conv.title || 'Untitled conversation';
      const date = new Date(conv.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric',
      });

      // Get last 2 messages from each conversation
      const msgs = await getConversationMessages(userId, conv.id, 2);
      if (msgs.length > 0) {
        const preview = msgs.map(m =>
          `${m.role === 'user' ? 'User' : 'You'}: ${String(m.content).slice(0, 80)}${m.content.length > 80 ? '...' : ''}`
        ).join(' | ');
        summaries.push(`[${date}] ${title}: ${preview}`);
      } else {
        summaries.push(`[${date}] ${title}`);
      }
    }

    return summaries.join('\n');
  } catch (e: any) {
    console.warn('[voice-context] Failed to load recent context:', e?.message);
    return '';
  }
}

/** Get the voice tools list (for external use) */
export function getVoiceTools(): VoiceToolDefinition[] {
  return VOICE_TOOLS;
}
