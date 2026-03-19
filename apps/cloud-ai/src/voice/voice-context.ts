/**
 * Voice Context Builder
 *
 * Builds user-aware system prompts and tool definitions for AI voice calls.
 * Loads user context from Supabase (recent conversations, profile) and
 * defines the tools the voice AI can call mid-conversation.
 *
 * Design: Avoid heavy pre-call work (embedding search, semantic ranking)
 * to minimize latency. Instead, give the AI lightweight tools it can
 * call on-demand during the conversation (SIS search/execute, web search,
 * memory search).
 */

import type { VoiceToolDefinition } from './types';
import {
  getConversationMessages,
  getSupabaseService,
} from '../supabase';
import {
  getIdentityLens,
  getDirectiveLens,
  getBioLens,
  type Fact,
} from '../knowledge/retrieval';

// ── Voice Tool Definitions ──────────────────────────────────────────────────
// These are the tools the voice AI can call during a live call.
// Kept minimal to reduce latency and token overhead.

const VOICE_TOOLS: VoiceToolDefinition[] = [
  {
    type: 'function',
    name: 'sis_search_tools',
    description: 'Discover available tools by describing what you need. Returns tool names and descriptions. Use sis_execute_tool to run a discovered tool.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What you want to do, e.g. "send email", "check calendar", "create reminder"',
        },
        category: {
          type: 'string',
          enum: ['system', 'core', 'input', 'ui', 'vision', 'data', 'integrations', 'flow'],
          description: 'Optional category filter',
        },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'sis_execute_tool',
    description: 'Execute a tool by name after discovering it with sis_search_tools. Pass arguments matching the tool schema.',
    parameters: {
      type: 'object',
      properties: {
        tool_name: {
          type: 'string',
          description: 'The exact name of the tool to execute',
        },
        args: {
          type: 'object',
          description: 'Arguments for the tool',
        },
      },
      required: ['tool_name'],
    },
  },
  {
    type: 'function',
    name: 'web_search',
    description: 'Search the web for up-to-date information. Returns results with title, URL, and snippet.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        max_results: {
          type: 'number',
          description: 'Number of results (1-5, default 3)',
        },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'memory_search',
    description: 'Search your past conversations with the user to find relevant context. Use when the user asks about something you discussed before or you need historical context.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for, e.g. "project setup", "meeting notes", "what we discussed about X"',
        },
        limit: {
          type: 'number',
          description: 'Max results (1-5, default 3)',
        },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'send_sms',
    description: 'Send an SMS text message to the user (e.g. to share a link, confirmation, or follow-up info they mentioned during the call).',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The text message to send',
        },
      },
      required: ['message'],
    },
  },
];

// ── System Prompt Builder ───────────────────────────────────────────────────

function buildVoiceSystemPrompt(opts: {
  userName?: string;
  direction: 'inbound' | 'outbound';
  callerNumber?: string;
  recentContext?: string;
  customPrompt?: string;
  identityFacts?: Fact[];
  directiveFacts?: Fact[];
  bioFacts?: Fact[];
}): string {
  const { userName, direction, callerNumber, recentContext, customPrompt,
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
    '- If the user asks you to do something and you have the tools, do it. Use sis_search_tools to find tools, then sis_execute_tool to run them.',
    '- You can search the web with web_search and search past conversations with memory_search.',
    '- If the user wants you to send them something (a link, info, confirmation), use send_sms to text it to them.',
    '- When calling tools, briefly tell the user what you\'re doing (e.g. "Let me look that up for you").',
  );

  if (customPrompt) {
    parts.push('', 'Additional instructions:', customPrompt);
  }

  if (recentContext) {
    parts.push('', 'Recent conversation context (for reference):', recentContext);
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
 * Build voice context for a user making/receiving a call.
 * Loads user profile and recent conversation context from Supabase.
 * Designed to be fast — no embedding search, just direct DB queries.
 */
export async function buildVoiceContext(opts: {
  userId: string;
  direction: 'inbound' | 'outbound';
  callerNumber?: string;
  customPrompt?: string;
}): Promise<VoiceContext> {
  const { userId, direction, callerNumber, customPrompt } = opts;

  // Load recent context + knowledge graph in parallel (all fast, no embeddings)
  const [recentMessages, userName, identityFacts, directiveFacts, bioFacts] = await Promise.all([
    loadRecentContext(userId).catch(() => ''),
    loadUserName(userId).catch(() => undefined),
    getIdentityLens().catch(() => [] as Fact[]),
    getDirectiveLens().catch(() => [] as Fact[]),
    getBioLens(10).catch(() => [] as Fact[]),
  ]);

  // Extract real name from identity facts if available (overrides email-derived name)
  const knownName = identityFacts.find(f => f.attribute_key === 'name' && f.text && !isPlaceholder(f.text))?.text;
  const effectiveName = knownName || userName;

  const systemPrompt = buildVoiceSystemPrompt({
    userName: effectiveName,
    direction,
    callerNumber,
    recentContext: recentMessages || undefined,
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
 * Load recent conversation context from Supabase.
 * Returns a compact summary of recent interactions.
 */
async function loadRecentContext(userId: string): Promise<string> {
  try {
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
