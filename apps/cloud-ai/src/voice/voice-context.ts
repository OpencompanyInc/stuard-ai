/**
 * Voice Context Builder
 *
 * Builds user-aware system prompts and tool definitions for AI voice calls.
 * Call-time memory (knowledge facts + recent conversation context) is loaded
 * through the desktop/VM bridge when available, then falls back to Supabase's
 * cloud-synced knowledge so voice still has *some* context when the desktop
 * bridge is offline or hasn't authenticated yet (the original strict no-
 * fallback policy left voice sessions context-blind whenever the bridge was
 * a beat behind, which is the default condition for hold-to-talk triggers).
 * The live model then gets a voice-safe orchestrator-style tool surface for
 * on-demand actions during the call.
 */

import type { WebSocket } from 'ws';
import type { VoiceToolDefinition } from './types';
import { getSupabaseService } from '../supabase';
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
  enableTools?: boolean;
  identityFacts?: Fact[];
  directiveFacts?: Fact[];
  bioFacts?: Fact[];
}): string {
  const { userName, direction, callerNumber, recentContext, runtimeMemorySummary, runtimeMemorySource, customPrompt,
    enableTools = true, identityFacts, directiveFacts, bioFacts } = opts;

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
  );

  if (enableTools) {
    parts.push(
      '',
      'How you work (orchestrator on a live call):',
      '- You are the orchestrator. Hand multi-step work to specialized subagents via delegate, or do quick lookups directly with the meta-tools.',
      '',
      'Delegate to specialists:',
      '- browser     — web browsing, form filling, page scraping, screenshots',
      '- file_ops    — reading/writing files, code editing, terminal commands',
      '- workflow    — creating, modifying, testing StuardAI automation workflows',
      '- reminders   — scheduling reminders, managing tasks/to-dos',
      '- ffmpeg      — audio/video processing (convert, trim, extract audio, frames)',
      '- bot         — proactive bot lookup/status/ask workflows by bot id or name',
      '- google      — Gmail, Calendar, Drive, Sheets, Docs, Tasks',
      '- outlook     — Outlook mail & calendar',
      '- github      — repos, issues, PRs, branches, actions',
      '- meta        — Facebook, Instagram, Threads',
      '- whatsapp    — WhatsApp messaging',
      '- telnyx      — SMS, voice calls',
      '- reddit      — subreddits, posts, comments',
      '- discord     — Discord bot operations',
      '- x           — X/Twitter tweets, timelines, users, DMs',
      '- Pass `tasks` array — one entry sequential, multiple entries in parallel.',
      '- A subagent can ask back via ask_orchestrator. When that happens delegate returns with a questionId — ask the caller verbally, then call reply_to_subagent.',
      '',
      'Quick direct tools (no subagent needed):',
      '- ask_bot / bot_list / bot_get_status — ask configured bots for status/details or list available bots.',
      '- search_tools / get_tool_schema / execute_tool — discover and run any single tool from the full Stuard surface.',
      '- web_search / scrape_url — quick web research.',
      '- search_memory / search_past_conversations / get_conversation_context — recall prior context.',
      '- search_local_workflows / run_workflow — discover and run the user\'s saved automations as custom tools.',
      '- analyze_media — describe an image, screenshot, or media file (use captureScreen:true to grab the user\'s screen).',
      '- deploy_headless_agent / get_headless_agent_status / list_headless_agent_tasks / stop_headless_agent — long-running background agents.',
      '- get_skill_info — look up a user-defined skill (guidance playbook).',
      '- agent_todo — track multi-step tasks during the call.',
      '- send_sms — text the caller a follow-up (links, summaries, confirmations).',
      '- wait — pause briefly between actions when polling status.',
      '',
      'Rules:',
      '- Act > Ask. Complete requests end-to-end; don\'t over-confirm.',
      '- Delegate early for multi-step work; parallelize when tasks are independent.',
      '- Provide context to subagents (history, IDs, preferences).',
      '- Do not use ask_user, chat_ui, or other visual/UI-only flows during a phone call. If you need more information, ask the caller verbally.',
      '- When calling any tool, briefly tell the user what you\'re doing (e.g. "Let me look that up for you").',
      '- IMPORTANT — before calling delegate, reply_to_subagent, or deploy_headless_agent, ALWAYS speak a short acknowledgment first (e.g. "Give me a moment, I\'ll work on that"). The call goes silent while these run, so the caller needs to hear you acknowledge before you kick them off.',
      '- Subagents and headless agents can take a minute or more. If the caller starts talking while you\'re waiting, chat — and when the result comes back, smoothly continue where you left off.',
      '- If a tool result has "timedOut": true or says it was released so the call can continue, do NOT silently retry. Tell the caller you\'re still working on it, offer to text them a follow-up with send_sms, or ask whether to keep trying.',
      '- Never expose internal IDs, taskIds, or questionIds verbally — they are for tool calls only.',
    );
  } else {
    parts.push(
      '- Live tools are unavailable on this call, so do not claim to look things up, send texts, or complete external actions in real time.',
      '- If the user asks for something that would normally require tools, explain that this call is currently conversation-only and offer the best verbal help you can.',
      '- Ask follow-up questions verbally instead of referring to any UI or external workflow.',
    );
  }

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
 * Load knowledge facts. Prefers the desktop/VM bridge (authoritative SQLite),
 * falls back to the Supabase cloud-synced mirror so voice has at least some
 * identity/directive/bio context even when the bridge isn't connected yet.
 */
async function loadKnowledgeFacts(userId: string, bridgeWs?: WebSocket): Promise<{
  identity: Fact[];
  directives: Fact[];
  bio: Fact[];
}> {
  const empty = { identity: [] as Fact[], directives: [] as Fact[], bio: [] as Fact[] };

  const desktopWs = bridgeWs || getDesktopWs(userId);
  let viaBridge = empty;

  if (desktopWs) {
    try {
      viaBridge = await withClientBridge(desktopWs, async () => {
        const [identity, directives, bio] = await Promise.all([
          getIdentityLens().catch(() => [] as Fact[]),
          getDirectiveLens().catch(() => [] as Fact[]),
          getBioLens(10).catch(() => [] as Fact[]),
        ]);
        return { identity, directives, bio };
      }) as { identity: Fact[]; directives: Fact[]; bio: Fact[] };
    } catch (e: any) {
      console.warn('[voice-context] Desktop bridge knowledge lookup failed, will try cloud fallback:', e?.message);
    }
  } else {
    console.log('[voice-context] No desktop/VM bridge for knowledge facts — using Supabase mirror', {
      userId: userId.slice(0, 8),
    });
  }

  const haveAny = viaBridge.identity.length || viaBridge.directives.length || viaBridge.bio.length;
  if (haveAny) return viaBridge;

  // Cloud fallback: read the Supabase mirror so voice always has *some*
  // identity/directive/bio to ground responses. The mirror can be lossy but
  // it's still better than zero context.
  try {
    const cloud = await loadKnowledgeFactsFromSupabase(userId);
    return {
      identity: viaBridge.identity.length ? viaBridge.identity : cloud.identity,
      directives: viaBridge.directives.length ? viaBridge.directives : cloud.directives,
      bio: viaBridge.bio.length ? viaBridge.bio : cloud.bio,
    };
  } catch (e: any) {
    console.warn('[voice-context] Supabase knowledge fallback failed:', e?.message);
    return viaBridge;
  }
}

async function loadKnowledgeFactsFromSupabase(userId: string): Promise<{
  identity: Fact[];
  directives: Fact[];
  bio: Fact[];
}> {
  const empty = { identity: [] as Fact[], directives: [] as Fact[], bio: [] as Fact[] };
  const supabase = getSupabaseService();
  if (!supabase) return empty;

  const [identityRes, directiveRes, bioRes] = await Promise.all([
    supabase
      .from('knowledge_facts')
      .select('id, category, subtype, attribute_key, text, created_at, validity, source')
      .eq('owner', userId)
      .eq('category', 'identity')
      .eq('validity', true)
      .limit(20),
    supabase
      .from('knowledge_facts')
      .select('id, category, subtype, attribute_key, text, created_at, validity, source')
      .eq('owner', userId)
      .eq('category', 'directive')
      .eq('validity', true)
      .limit(20),
    supabase
      .from('knowledge_facts')
      .select('id, category, subtype, attribute_key, text, created_at, validity, source')
      .eq('owner', userId)
      .eq('category', 'bio')
      .eq('validity', true)
      .limit(10),
  ]);

  return {
    identity: (identityRes.data || []) as Fact[],
    directives: (directiveRes.data || []) as Fact[],
    bio: (bioRes.data || []) as Fact[],
  };
}

async function loadRecentContextFromDesktop(userId: string, bridgeWs?: WebSocket): Promise<string> {
  const desktopWs = bridgeWs || getDesktopWs(userId);
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
  bridgeWs?: WebSocket;
  enableTools?: boolean;
}): Promise<VoiceContext> {
  const { userId, direction, callerNumber, customPrompt, bridgeWs, enableTools = true } = opts;

  // Load recent context + knowledge graph + configured runtime memory in parallel.
  const [recentMessages, userName, knowledge, runtimeMemory] = await Promise.all([
    loadRecentContext(userId, bridgeWs).catch(() => ''),
    loadUserName(userId).catch(() => undefined),
    loadKnowledgeFacts(userId, bridgeWs),
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
    enableTools,
    identityFacts,
    directiveFacts,
    bioFacts,
  });

  return {
    systemPrompt,
    tools: enableTools ? VOICE_TOOLS : [],
    userId,
    userName: effectiveName,
  };
}

/**
 * Last-resort name source: derive from the email prefix in users_billing.
 * The real name should come from the desktop knowledge graph identity lens
 * (the "Profile" sticky notes), which is loaded separately in buildVoiceContext.
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
    if (data?.email) {
      const name = data.email.split('@')[0].replace(/[._-]+/g, ' ');
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  } catch { /* ignore */ }
  return undefined;
}

/**
 * Load recent conversation context. Prefers the device's local SQLite via the
 * desktop/VM bridge; falls back to the Supabase mirror so voice still has
 * recent-history grounding when the bridge is offline.
 */
async function loadRecentContext(userId: string, bridgeWs?: WebSocket): Promise<string> {
  try {
    const fromDesktop = await loadRecentContextFromDesktop(userId, bridgeWs);
    if (fromDesktop && fromDesktop.trim()) return fromDesktop;
  } catch (e: any) {
    console.warn('[voice-context] Desktop recent-context lookup failed, will try cloud fallback:', e?.message);
  }

  try {
    return await loadRecentContextFromSupabase(userId);
  } catch (e: any) {
    console.warn('[voice-context] Supabase recent-context fallback failed:', e?.message);
    return '';
  }
}

async function loadRecentContextFromSupabase(userId: string): Promise<string> {
  const supabase = getSupabaseService();
  if (!supabase) return '';

  const { data: convs } = await supabase
    .from('conversations')
    .select('id, title, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(3);

  if (!convs || convs.length === 0) return '';

  const summaries = await Promise.all(convs.map(async (conv) => {
    const title = conv.title || 'Untitled conversation';
    const date = new Date(conv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    try {
      const { data: msgs } = await supabase
        .from('messages')
        .select('role, content')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(2);
      if (!msgs || msgs.length === 0) return `[${date}] ${title}`;
      const preview = msgs.reverse().map((m: any) => {
        const text = String(m.content || '').slice(0, 80);
        return `${m.role === 'user' ? 'User' : 'You'}: ${text}${String(m.content).length > 80 ? '...' : ''}`;
      }).join(' | ');
      return `[${date}] ${title}: ${preview}`;
    } catch {
      return `[${date}] ${title}`;
    }
  }));

  return summaries.filter(Boolean).join('\n');
}

/** Get the voice tools list (for external use) */
export function getVoiceTools(): VoiceToolDefinition[] {
  return VOICE_TOOLS;
}
