import type { VoiceToolDefinition } from './types';
import { search_tools as metaSearchTools, get_tool_schema as metaGetToolSchema, execute_tool as metaExecuteTool } from '../tools/meta-tools';
import { web_search } from '../tools/perplexity-tools';
import { delegate, replyToSubagent } from '../orchestrator/delegation-tools';
import { withClientBridge } from '../tools/bridge';
import { sendVMCommand } from '../services/vm-command';
import { search_past_conversations } from '../tools/device/memory';
import {
  getConversationMessages,
  getExternalAccount,
  getSmsUserState,
  getSupabaseService,
} from '../supabase';
import { TELNYX_API_KEY, TELNYX_FROM_NUMBER, TELNYX_MESSAGING_PROFILE_ID } from '../utils/config';
import { getVoiceBridgeWs } from './voice-bridge-manager';

const VOICE_RUNTIME_MEMORY_QUERY =
  'important things about me, who I am, my preferences, ongoing projects, current priorities, and context that helps Stuard feel familiar on a live call';

const MAX_VOICE_MEMORY_SUMMARY_CHARS = 900;
const MAX_VOICE_RESULT_JSON_CHARS = 2_000;

// Per-tool execution timeouts. Voice calls are real-time — a tool that hangs
// blocks the model from responding, leaving the caller in silence. Keep
// timeouts aggressive so the AI can speak again quickly and either follow
// up, text the caller, or retry, instead of the caller giving up and
// hanging up while the model is still waiting.
const VOICE_TOOL_TIMEOUTS_MS: Record<string, number> = {
  delegate: 90_000,
  reply_to_subagent: 90_000,
  execute_tool: 45_000,
  web_search: 30_000,
  search_memory: 20_000,
  search_tools: 15_000,
  get_tool_schema: 15_000,
  send_sms: 15_000,
};
const DEFAULT_VOICE_TOOL_TIMEOUT_MS = 30_000;

function voiceToolTimeoutFor(name: string): number {
  return VOICE_TOOL_TIMEOUTS_MS[name] ?? DEFAULT_VOICE_TOOL_TIMEOUT_MS;
}

function voiceFriendlyTimeoutMessage(toolName: string, seconds: number): string {
  switch (toolName) {
    case 'delegate':
    case 'reply_to_subagent':
      return `The background task is still running after ${seconds} seconds. Tell the caller you're still working on it, keep the call going with small talk or a follow-up question, and offer to text them the result with send_sms once it's ready.`;
    case 'web_search':
      return `The web search took longer than ${seconds} seconds and was cancelled. Tell the caller search is slow right now and either try a simpler query, offer to text them results later, or move on.`;
    case 'send_sms':
      return `The text message is still being delivered after ${seconds} seconds. Let the caller know the message is on its way and continue the call.`;
    default:
      return `Tool '${toolName}' took longer than ${seconds} seconds and was cancelled so the call can continue. Acknowledge the caller verbally and decide whether to try again, skip it, or text a follow-up with send_sms.`;
  }
}

async function runWithVoiceTimeout<T>(toolName: string, fn: () => Promise<T>): Promise<T | { ok: false; error: string; timedOut: true }> {
  const ms = voiceToolTimeoutFor(toolName);
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<{ ok: false; error: string; timedOut: true }>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        ok: false,
        timedOut: true,
        error: voiceFriendlyTimeoutMessage(toolName, Math.round(ms / 1000)),
      });
    }, ms);
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const VOICE_BLOCKED_TOOL_IDS = new Set([
  'ask_user',
  'chat_ui',
  'custom_ui',
  'update_custom_ui',
  'search_past_conversations',
  'get_conversation_context',
]);

function makeFunctionTool(
  name: string,
  description: string,
  parameters: Record<string, any>,
): VoiceToolDefinition {
  return {
    type: 'function',
    name,
    description,
    parameters,
  };
}

export const VOICE_TOOL_DEFINITIONS: VoiceToolDefinition[] = [
  makeFunctionTool(
    'search_memory',
    'Search the user\'s memory for helpful context. This prefers the configured desktop or VM runtime when available.',
    {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What memory to search for, for example "my health goals", "what project I was working on", or "travel plans".',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return. Use 1-5.',
        },
      },
      required: ['query'],
    },
  ),
  makeFunctionTool(
    'search_tools',
    'Search for available non-UI tools. Use this before calling execute_tool if you do not already know the exact tool name.',
    {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What you want to do, for example "send email", "check calendar", "open browser", or "run a command".',
        },
        category: {
          type: 'string',
          description: 'Optional category filter such as System, Memory, Google, GitHub, or Workflow.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of tools to return. Use 1-10.',
        },
      },
    },
  ),
  makeFunctionTool(
    'get_tool_schema',
    'Get the exact argument schema for a tool before calling execute_tool.',
    {
      type: 'object',
      properties: {
        tool_name: {
          type: 'string',
          description: 'The exact tool name.',
        },
      },
      required: ['tool_name'],
    },
  ),
  makeFunctionTool(
    'execute_tool',
    'Execute a non-UI tool by name. Prefer calling get_tool_schema first when the args are not obvious.',
    {
      type: 'object',
      properties: {
        tool_name: {
          type: 'string',
          description: 'The exact tool name to execute.',
        },
        args: {
          type: 'object',
          description: 'Arguments that match the tool schema.',
        },
      },
      required: ['tool_name'],
    },
  ),
  makeFunctionTool(
    'delegate',
    'Delegate a larger task to a specialized subagent, similar to the orchestrator. Use this when the work is multi-step or better suited to a focused specialist.',
    {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'One task for sequential work, or multiple tasks for parallel delegation.',
          items: {
            type: 'object',
            properties: {
              subagent: {
                type: 'string',
                description: 'Subagent name such as browser, file_ops, workflow, google, github, telnyx, or discord.',
              },
              instruction: {
                type: 'string',
                description: 'Detailed instruction for the subagent.',
              },
              context: {
                type: 'string',
                description: 'Optional extra context for the subagent.',
              },
            },
            required: ['subagent', 'instruction'],
          },
          minItems: 1,
          maxItems: 6,
        },
      },
      required: ['tasks'],
    },
  ),
  makeFunctionTool(
    'reply_to_subagent',
    'Answer a question from a delegated subagent after asking the caller verbally for any missing information.',
    {
      type: 'object',
      properties: {
        questionId: {
          type: 'string',
          description: 'The questionId returned by delegate.',
        },
        answer: {
          type: 'string',
          description: 'Your answer to the delegated subagent.',
        },
      },
      required: ['questionId', 'answer'],
    },
  ),
  makeFunctionTool(
    'web_search',
    'Search the web for current information.',
    {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query.',
        },
        max_results: {
          type: 'number',
          description: 'Number of results to return. Use 1-5.',
        },
      },
      required: ['query'],
    },
  ),
  makeFunctionTool(
    'send_sms',
    'Send the caller a follow-up text message with links, notes, or confirmation.',
    {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Text message to send.',
        },
      },
      required: ['message'],
    },
  ),
];

type VoiceSearchResult = { name: string; description: string; category?: string };

export type VoiceRuntimeChannel = 'telnyx' | 'discord';

function normalizeVoiceToolName(rawName: string): string {
  const name = String(rawName || '').trim();
  switch (name) {
    case 'search_tool':
    case 'sis_search_tools':
      return 'search_tools';
    case 'sis_execute_tool':
      return 'execute_tool';
    case 'memory_search':
      return 'search_memory';
    default:
      return name;
  }
}

export function isVoiceBlockedTool(toolName: string): boolean {
  const normalized = String(toolName || '').trim();
  return VOICE_BLOCKED_TOOL_IDS.has(normalized) || normalized.startsWith('sis_');
}

export function filterVoiceSearchResults<T extends VoiceSearchResult>(tools: T[]): T[] {
  return tools.filter((tool) => !isVoiceBlockedTool(tool.name));
}

function findVoiceToolDefinition(toolName: string): VoiceToolDefinition | undefined {
  return VOICE_TOOL_DEFINITIONS.find((tool) => tool.name === toolName);
}

function coerceLimit(rawLimit: unknown, fallback: number, max: number): number {
  const num = Number(rawLimit);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(Math.trunc(num), max));
}

function shortDate(value: unknown): string {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function cleanExcerpt(value: unknown, maxChars = 220): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}...` : text;
}

function trimSummary(text: string, maxChars = MAX_VOICE_MEMORY_SUMMARY_CHARS): string {
  const cleaned = text.trim();
  if (!cleaned) return '';
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 1)}...` : cleaned;
}

async function withVoiceBridge<T>(voiceSessionId: string | undefined, fn: () => Promise<T>): Promise<T> {
  const bridgeWs = getVoiceBridgeWs(voiceSessionId);
  if (!bridgeWs) return fn();
  return withClientBridge(bridgeWs, fn) as Promise<T>;
}

function formatDesktopMemorySummary(payload: any): string {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const lines = results.slice(0, 4).map((item: any) => {
    const title = cleanExcerpt(item?.title || 'Past conversation', 80);
    const summary = cleanExcerpt(item?.summary, 220);
    const topics = Array.isArray(item?.topics) && item.topics.length > 0
      ? ` Topics: ${item.topics.slice(0, 4).map((topic: any) => String(topic)).join(', ')}.`
      : '';
    const date = shortDate(item?.date);
    return `[${date}] ${title}${summary ? `: ${summary}` : ''}${topics}`;
  });
  return trimSummary(lines.join('\n'));
}

function formatVmMemorySummary(payload: any): string {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const lines = results.slice(0, 4).map((item: any) => {
    const topic = cleanExcerpt(item?.topic || item?.title || 'Memory', 80);
    const excerpt = cleanExcerpt(item?.content || item?.summary || item?.text, 220);
    const tags = Array.isArray(item?.tags) && item.tags.length > 0
      ? ` Tags: ${item.tags.slice(0, 4).map((tag: any) => String(tag)).join(', ')}.`
      : '';
    const date = shortDate(item?.updated_at || item?.created_at);
    return `[${date}] ${topic}${excerpt ? `: ${excerpt}` : ''}${tags}`;
  });
  return trimSummary(lines.join('\n'));
}

async function searchMemoryOnDesktop(voiceSessionId: string | undefined, query: string, limit: number): Promise<any> {
  const bridgeWs = getVoiceBridgeWs(voiceSessionId);
  if (!bridgeWs) return null;

  return withClientBridge(bridgeWs, async () =>
    (search_past_conversations as any).execute?.({
      query,
      limit,
      filter: { mode: query ? 'semantic' : 'recent' },
    }, {} as any),
  );
}

async function searchMemoryOnVm(userId: string, query: string, limit: number): Promise<any> {
  const vmResult = await sendVMCommand(userId, 'memory_search', { query, limit }, 15_000);
  if (!vmResult.ok) {
    return {
      ok: false,
      source: 'vm',
      error: vmResult.error || 'vm_memory_search_failed',
      results: [],
    };
  }

  const payload = vmResult.result || {};
  return {
    ok: payload.ok !== false,
    source: 'vm',
    results: Array.isArray(payload.results) ? payload.results : [],
    count: payload.count,
  };
}

async function searchMemoryInCloud(userId: string, query: string, limit: number): Promise<any> {
  const supabase = getSupabaseService();
  if (!supabase) {
    return { ok: false, source: 'cloud', error: 'memory_service_unavailable', results: [] };
  }

  try {
    const safeLimit = coerceLimit(limit, 3, 5);
    const queryLower = String(query || '').toLowerCase();
    const { data: convs } = await supabase
      .from('conversations')
      .select('id, title, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!convs || convs.length === 0) {
      return { ok: true, source: 'cloud', results: [], message: 'No past conversations found.' };
    }

    const scored = convs
      .map((conv) => {
        const title = String(conv.title || '').toLowerCase();
        let score = 0;
        for (const word of queryLower.split(/\s+/)) {
          if (word.length > 2 && title.includes(word)) score += 1;
        }
        return { ...conv, score };
      })
      .sort((a, b) => b.score - a.score || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, safeLimit);

    const results = [];
    for (const conv of scored) {
      const messages = await getConversationMessages(userId, conv.id, 3);
      results.push({
        title: conv.title || 'Untitled',
        date: conv.created_at,
        messages: messages.map((message) => ({
          role: message.role,
          content: cleanExcerpt(message.content, 150),
        })),
      });
    }

    return { ok: true, source: 'cloud', results };
  } catch (error: any) {
    return { ok: false, source: 'cloud', error: error?.message || 'memory_search_failed', results: [] };
  }
}

export async function searchVoiceMemory(
  userId: string,
  query: string,
  limit: number,
  voiceSessionId?: string,
): Promise<any> {
  const smsState = await getSmsUserState(userId).catch(() => null);
  const target = smsState?.agent_target || 'auto';
  const safeLimit = coerceLimit(limit, 3, 5);

  if (target === 'desktop') {
    const desktopResult = await searchMemoryOnDesktop(voiceSessionId, query, safeLimit);
    if (desktopResult?.ok !== false && Array.isArray(desktopResult?.results)) {
      return { ...desktopResult, source: 'desktop' };
    }
    return {
      ok: false,
      source: 'desktop',
      error: desktopResultErrorMessage(),
      results: [],
    };
  }

  if (target === 'vm') {
    const vmResult = await searchMemoryOnVm(userId, query, safeLimit);
    if (vmResult?.ok !== false && Array.isArray(vmResult?.results)) {
      return vmResult;
    }
    return {
      ok: false,
      source: 'vm',
      error: vmResult?.error || 'vm_memory_unavailable',
      results: [],
    };
  }

  return searchMemoryInCloud(userId, query, safeLimit);
}

function desktopResultErrorMessage(): string {
  return 'desktop_memory_unavailable';
}

export async function loadVoiceRuntimeMemorySummary(userId: string): Promise<{ source?: string; summary: string }> {
  const smsState = await getSmsUserState(userId).catch(() => null);
  const target = smsState?.agent_target || 'auto';

  if (target !== 'desktop' && target !== 'vm') {
    return { summary: '' };
  }

  const result = await searchVoiceMemory(userId, VOICE_RUNTIME_MEMORY_QUERY, 4);
  if (!result?.ok) {
    return { source: result?.source, summary: '' };
  }

  const summary = result?.source === 'vm'
    ? formatVmMemorySummary(result)
    : formatDesktopMemorySummary(result);

  return {
    source: result?.source,
    summary,
  };
}

async function executeSendSms(userId: string, message: string): Promise<any> {
  try {
    const account = await getExternalAccount(userId, 'telnyx');
    if (!account?.meta?.verified || !account.meta.phone) {
      return { ok: false, error: 'No verified phone number' };
    }

    if (!TELNYX_API_KEY || !TELNYX_FROM_NUMBER) {
      return { ok: false, error: 'SMS not configured' };
    }

    const body: any = {
      from: TELNYX_FROM_NUMBER,
      to: account.meta.phone,
      text: String(message || '').slice(0, 1600),
    };
    if (TELNYX_MESSAGING_PROFILE_ID) {
      body.messaging_profile_id = TELNYX_MESSAGING_PROFILE_ID;
    }

    const response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return { ok: false, error: `SMS failed (${response.status})` };
    }

    return { ok: true, message: 'SMS sent successfully' };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Failed to send SMS' };
  }
}

const KNOWN_VOICE_TOOLS = new Set([
  'search_memory',
  'search_tools',
  'get_tool_schema',
  'delegate',
  'reply_to_subagent',
  'web_search',
  'send_sms',
]);

export async function executeVoiceToolCall(input: {
  name: string;
  argsJson: string;
  userId: string;
  channel: VoiceRuntimeChannel;
  voiceSessionId?: string;
}): Promise<any> {
  const { userId, channel, voiceSessionId } = input;
  const toolName = normalizeVoiceToolName(input.name);
  let args: Record<string, any> = {};
  try {
    args = JSON.parse(input.argsJson || '{}');
  } catch {
    args = {};
  }

  // Resolve the effective tool name for timeout selection. When execute_tool
  // is used as a redirect to another known voice tool (e.g. delegate), honor
  // the inner tool's timeout so long-running subagents aren't cut off by the
  // shorter execute_tool budget.
  let effectiveName = toolName;
  if (toolName === 'execute_tool') {
    const requestedTool = normalizeVoiceToolName(String(args.tool_name || ''));
    if (KNOWN_VOICE_TOOLS.has(requestedTool)) {
      effectiveName = requestedTool;
    }
  }

  return runWithVoiceTimeout(effectiveName, () => dispatchVoiceTool(toolName, args, { userId, channel, voiceSessionId }));
}

async function dispatchVoiceTool(
  toolName: string,
  args: Record<string, any>,
  ctx: { userId: string; channel: VoiceRuntimeChannel; voiceSessionId?: string },
): Promise<any> {
  const { userId, channel, voiceSessionId } = ctx;
  switch (toolName) {
    case 'search_tools': {
      const result = await withVoiceBridge(voiceSessionId, async () =>
        (metaSearchTools as any).execute?.({
          query: args.query,
          category: args.category,
          list_categories: !!args.list_categories,
          limit: coerceLimit(args.limit, 5, 10),
        }, {} as any),
      );

      return {
        ...(result || {}),
        tools: filterVoiceSearchResults(Array.isArray(result?.tools) ? result.tools : []),
      };
    }

    case 'get_tool_schema': {
      const requestedTool = normalizeVoiceToolName(String(args.tool_name || ''));
      if (isVoiceBlockedTool(requestedTool)) {
        return {
          ok: false,
          error: `Tool '${requestedTool}' is not available in voice mode. Use direct voice tools instead of UI-only tools.`,
        };
      }

      const directVoiceTool = findVoiceToolDefinition(requestedTool);
      if (directVoiceTool) {
        return {
          name: directVoiceTool.name,
          description: directVoiceTool.description,
          inputSchema: directVoiceTool.parameters,
        };
      }

      return withVoiceBridge(voiceSessionId, async () =>
        (metaGetToolSchema as any).execute?.({ tool_name: requestedTool }, {} as any),
      );
    }

    case 'execute_tool': {
      const requestedTool = normalizeVoiceToolName(String(args.tool_name || ''));
      if (isVoiceBlockedTool(requestedTool)) {
        return {
          success: false,
          tool: requestedTool,
          error: `Tool '${requestedTool}' is not available in voice mode. UI prompts are disabled for calls.`,
        };
      }

      if (KNOWN_VOICE_TOOLS.has(requestedTool)) {
        return dispatchVoiceTool(requestedTool, (args.args && typeof args.args === 'object') ? args.args : {}, ctx);
      }

      return withVoiceBridge(voiceSessionId, async () =>
        (metaExecuteTool as any).execute?.({
          tool_name: requestedTool,
          args: args.args || {},
        }, {} as any),
      );
    }

    case 'delegate': {
      return withVoiceBridge(voiceSessionId, async () =>
        (delegate as any).execute?.({
          tasks: Array.isArray(args.tasks) ? args.tasks : [],
        }, {} as any),
      );
    }

    case 'reply_to_subagent': {
      return withVoiceBridge(voiceSessionId, async () =>
        (replyToSubagent as any).execute?.({
          questionId: String(args.questionId || ''),
          answer: String(args.answer || ''),
        }, {} as any),
      );
    }

    case 'web_search': {
      return (web_search as any).execute?.({
        query: String(args.query || ''),
        max_results: coerceLimit(args.max_results, 3, 5),
      }, {} as any);
    }

    case 'search_memory': {
      return searchVoiceMemory(
        userId,
        String(args.query || ''),
        coerceLimit(args.limit, 3, 5),
        voiceSessionId,
      );
    }

    case 'send_sms': {
      if (channel === 'discord') {
        return {
          ok: true,
          note: 'SMS sending is disabled during Discord voice calls. Summarize the information verbally or send it from a phone call session.',
        };
      }
      return executeSendSms(userId, String(args.message || ''));
    }

    default:
      return {
        ok: false,
        error: `Unknown voice tool: ${toolName}. Use search_tools to discover non-UI tools.`,
      };
  }
}

export function truncateVoiceToolResult(result: any): string {
  const json = JSON.stringify(result);
  return json.length > MAX_VOICE_RESULT_JSON_CHARS
    ? `${json.slice(0, MAX_VOICE_RESULT_JSON_CHARS)}...(truncated)`
    : json;
}
