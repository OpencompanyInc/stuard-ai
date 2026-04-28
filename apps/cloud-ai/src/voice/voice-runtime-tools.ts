import type { VoiceToolDefinition } from './types';
import { search_tools as metaSearchTools, get_tool_schema as metaGetToolSchema, execute_tool as metaExecuteTool } from '../tools/meta-tools';
import { web_search } from '../tools/perplexity-tools';
import { scrape_url } from '../tools/tavily-tools';
import { analyzeMediaTool } from '../tools/analyze-media';
import { waitTool } from '../tools/wait';
import { deployHeadlessAgent } from '../tools/deploy-headless-agent';
import { getHeadlessAgentStatus } from '../tools/get-headless-agent-status';
import { listHeadlessAgentTasks } from '../tools/list-headless-agent-tasks';
import { stopHeadlessAgent } from '../tools/stop-headless-agent';
import { get_skill_info } from '../tools/skill-tools';
import { agent_todo, search_local_workflows, run_workflow } from '../tools/device-tools';
import { delegate, replyToSubagent } from '../orchestrator/delegation-tools';
import { withClientBridge } from '../tools/bridge';
import { sendVMCommand } from '../services/vm-command';
import { search_past_conversations, get_conversation_context } from '../tools/device/memory';
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
  scrape_url: 30_000,
  search_memory: 20_000,
  search_past_conversations: 20_000,
  get_conversation_context: 20_000,
  search_tools: 15_000,
  get_tool_schema: 15_000,
  send_sms: 15_000,
  analyze_media: 60_000,
  agent_todo: 10_000,
  search_local_workflows: 15_000,
  run_workflow: 90_000,
  deploy_headless_agent: 90_000,
  get_headless_agent_status: 15_000,
  list_headless_agent_tasks: 15_000,
  stop_headless_agent: 15_000,
  get_skill_info: 10_000,
  wait: 60_000,
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
    'Delegate one or more tasks to specialized subagents — same delegation surface as the orchestrator. Pass a single task for sequential work or multiple tasks to run in parallel. Available subagents: browser, file_ops, workflow, reminders, ffmpeg, google, outlook, github, meta, whatsapp, telnyx, reddit, discord. The subagent can ask back via ask_orchestrator — when that happens this tool returns with a questionId, and you answer with reply_to_subagent.',
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
                description: 'Subagent name: browser, file_ops, workflow, reminders, ffmpeg, google, outlook, github, meta, whatsapp, telnyx, reddit, or discord.',
              },
              instruction: {
                type: 'string',
                description: 'Detailed instruction for the subagent.',
              },
              context: {
                type: 'string',
                description: 'Optional extra context for the subagent (history, IDs, preferences).',
              },
              skill: {
                type: 'string',
                description: 'Optional user-defined skill name to inject into the delegated subagent context.',
              },
            },
            required: ['subagent', 'instruction'],
          },
          minItems: 1,
          maxItems: 10,
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
  makeFunctionTool(
    'scrape_url',
    'Extract page content from one or more URLs (returns truncated text). Good for quickly reading an article, doc page, or product listing.',
    {
      type: 'object',
      properties: {
        urls: {
          description: 'A single URL string or an array of URL strings to scrape.',
        },
        extractDepth: {
          type: 'string',
          enum: ['basic', 'advanced'],
          description: 'basic is faster; advanced is higher quality. Default basic.',
        },
      },
      required: ['urls'],
    },
  ),
  makeFunctionTool(
    'analyze_media',
    'Analyze media (image, video, audio, PDF) or YouTube URLs, or capture and analyze the user\'s screen. Returns a summary.',
    {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Optional prompt — what to look for (e.g. "summarize this video", "what is on the screen?").',
        },
        sources: {
          type: 'array',
          description: 'Media sources. Each entry can be a URL, local path, base64 data, or { captureScreen: true } to grab the user\'s current screen.',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              path: { type: 'string' },
              data: { type: 'string' },
              mimeType: { type: 'string' },
              captureScreen: { type: 'boolean' },
            },
          },
          minItems: 1,
        },
        mode: {
          type: 'string',
          enum: ['fast', 'detailed'],
          description: 'fast = quick model, detailed = higher quality. Default fast.',
        },
      },
      required: ['sources'],
    },
  ),
  makeFunctionTool(
    'search_past_conversations',
    'Search the user\'s past conversations (semantic or recent) for context on something they mentioned discussing before.',
    {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for. Optional when using filter mode "recent".',
        },
        limit: {
          type: 'number',
          description: 'Max results (1-20). Default 5.',
        },
        filter: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['auto', 'semantic', 'recent'],
              description: 'auto: semantic when query exists else recent.',
            },
            since: { type: 'string', description: 'ISO datetime (inclusive).' },
            before: { type: 'string', description: 'ISO datetime (inclusive).' },
          },
        },
      },
    },
  ),
  makeFunctionTool(
    'get_conversation_context',
    'Retrieve the full message history from a specific past conversation. Use after search_past_conversations.',
    {
      type: 'object',
      properties: {
        conversation_id: { type: 'string', description: 'The conversation ID.' },
        limit: { type: 'number', description: 'Max messages (1-100). Default 20.' },
      },
      required: ['conversation_id'],
    },
  ),
  makeFunctionTool(
    'agent_todo',
    'Track multi-step tasks during the call. Actions: list, create, bulk_create, start, complete, fail, delete, clear, progress, get_current, get_next, block.',
    {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'The action to perform.' },
        data: { description: 'Action-specific data (object).' },
      },
      required: ['action'],
    },
  ),
  makeFunctionTool(
    'search_local_workflows',
    'List or search the user\'s saved Stuard workflows. Use this before run_workflow to find a matching automation and check what arguments it needs.',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional name/description filter.' },
        limit: { type: 'number', description: 'Max results (1-50). Default 10.' },
      },
    },
  ),
  makeFunctionTool(
    'run_workflow',
    'Run a local Stuard workflow synchronously by id or name. Match args keys to the workflow\'s inputSchema names.',
    {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workflow ID.' },
        name: { type: 'string', description: 'Workflow name (case-insensitive partial match).' },
        args: { type: 'object', description: 'Input arguments matching the workflow\'s inputSchema.' },
        timeoutMs: { type: 'number', description: 'Max execution time in ms (1000-600000). Default 120000.' },
      },
    },
  ),
  makeFunctionTool(
    'deploy_headless_agent',
    'Deploy autonomous headless sub-agents in parallel for longer-running background work. Pass tasks array. execution_mode: "wait" blocks until all finish, "background" returns taskIds immediately.',
    {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'Array of sub-agent tasks. Each task has objective and optional fields (mode, tools_allowed, custom_system_prompt).',
          items: { type: 'object' },
          minItems: 1,
        },
        execution_mode: {
          type: 'string',
          enum: ['wait', 'background'],
          description: 'wait = block until done; background = return taskIds.',
        },
        model: {
          type: 'string',
          enum: ['fast', 'balanced', 'smart'],
          description: 'Model tier. Default fast.',
        },
      },
      required: ['tasks'],
    },
  ),
  makeFunctionTool(
    'get_headless_agent_status',
    'Get the status, logs, and result of a previously deployed headless sub-agent.',
    {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID returned by deploy_headless_agent.' },
      },
      required: ['taskId'],
    },
  ),
  makeFunctionTool(
    'list_headless_agent_tasks',
    'List recent headless sub-agent tasks (optionally filtered by status).',
    {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['running', 'completed', 'failed'] },
        limit: { type: 'number', description: 'Max results (1-100). Default 25.' },
      },
    },
  ),
  makeFunctionTool(
    'stop_headless_agent',
    'Stop a running headless sub-agent task.',
    {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID returned by deploy_headless_agent.' },
      },
      required: ['task_id'],
    },
  ),
  makeFunctionTool(
    'get_skill_info',
    'Get full details of a user-defined skill (a guidance playbook) by name or ID.',
    {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Exact skill ID.' },
        skill_name: { type: 'string', description: 'Skill name (partial match).' },
        request_text: { type: 'string', description: 'Optional user request text to help match the best skill.' },
      },
    },
  ),
  makeFunctionTool(
    'wait',
    'Wait for a number of milliseconds. Useful for spacing out actions when polling status.',
    {
      type: 'object',
      properties: {
        milliseconds: { type: 'number', description: 'Time to wait in ms.' },
        message: { type: 'string', description: 'Optional status message.' },
      },
      required: ['milliseconds'],
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
  'scrape_url',
  'analyze_media',
  'search_past_conversations',
  'get_conversation_context',
  'agent_todo',
  'search_local_workflows',
  'run_workflow',
  'deploy_headless_agent',
  'get_headless_agent_status',
  'list_headless_agent_tasks',
  'stop_headless_agent',
  'get_skill_info',
  'wait',
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

    case 'scrape_url': {
      return (scrape_url as any).execute?.({
        urls: args.urls,
        extractDepth: args.extractDepth || 'basic',
      }, {} as any);
    }

    case 'analyze_media': {
      return withVoiceBridge(voiceSessionId, async () =>
        (analyzeMediaTool as any).execute?.({
          task: args.task,
          sources: Array.isArray(args.sources) ? args.sources : [],
          mode: args.mode || 'fast',
        }, {} as any),
      );
    }

    case 'search_past_conversations': {
      return withVoiceBridge(voiceSessionId, async () =>
        (search_past_conversations as any).execute?.({
          query: String(args.query || ''),
          limit: coerceLimit(args.limit, 5, 20),
          filter: args.filter && typeof args.filter === 'object' ? args.filter : undefined,
        }, {} as any),
      );
    }

    case 'get_conversation_context': {
      return withVoiceBridge(voiceSessionId, async () =>
        (get_conversation_context as any).execute?.({
          conversation_id: String(args.conversation_id || ''),
          limit: coerceLimit(args.limit, 20, 100),
        }, {} as any),
      );
    }

    case 'agent_todo': {
      return withVoiceBridge(voiceSessionId, async () =>
        (agent_todo as any).execute?.({
          action: String(args.action || ''),
          sessionId: voiceSessionId || userId,
          data: args.data,
        }, {} as any),
      );
    }

    case 'search_local_workflows': {
      return withVoiceBridge(voiceSessionId, async () =>
        (search_local_workflows as any).execute?.({
          query: typeof args.query === 'string' ? args.query : undefined,
          limit: coerceLimit(args.limit, 10, 50),
        }, {} as any),
      );
    }

    case 'run_workflow': {
      return withVoiceBridge(voiceSessionId, async () =>
        (run_workflow as any).execute?.({
          id: typeof args.id === 'string' ? args.id : undefined,
          name: typeof args.name === 'string' ? args.name : undefined,
          args: args.args && typeof args.args === 'object' ? args.args : undefined,
          timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : 120_000,
        }, {} as any),
      );
    }

    case 'deploy_headless_agent': {
      return withVoiceBridge(voiceSessionId, async () =>
        (deployHeadlessAgent as any).execute?.({
          tasks: Array.isArray(args.tasks) ? args.tasks : [],
          execution_mode: args.execution_mode || 'wait',
          model: args.model || 'fast',
        }, {} as any),
      );
    }

    case 'get_headless_agent_status': {
      return withVoiceBridge(voiceSessionId, async () =>
        (getHeadlessAgentStatus as any).execute?.({
          taskId: String(args.taskId || ''),
        }, {} as any),
      );
    }

    case 'list_headless_agent_tasks': {
      return withVoiceBridge(voiceSessionId, async () =>
        (listHeadlessAgentTasks as any).execute?.({
          status: args.status,
          limit: coerceLimit(args.limit, 25, 100),
        }, {} as any),
      );
    }

    case 'stop_headless_agent': {
      return withVoiceBridge(voiceSessionId, async () =>
        (stopHeadlessAgent as any).execute?.({
          task_id: String(args.task_id || ''),
        }, {} as any),
      );
    }

    case 'get_skill_info': {
      return (get_skill_info as any).execute?.({
        skill_id: typeof args.skill_id === 'string' ? args.skill_id : undefined,
        skill_name: typeof args.skill_name === 'string' ? args.skill_name : undefined,
        request_text: typeof args.request_text === 'string' ? args.request_text : undefined,
      }, {} as any);
    }

    case 'wait': {
      const ms = Math.max(0, Math.min(60_000, Number(args.milliseconds) || 0));
      return (waitTool as any).execute?.({
        milliseconds: ms,
        message: typeof args.message === 'string' ? args.message : undefined,
      }, {} as any);
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
