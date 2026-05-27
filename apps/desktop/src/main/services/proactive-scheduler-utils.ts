import type { RouterContext } from '../tools/types';

const DEFAULT_PROACTIVE_NOTIFICATION_MESSAGE = 'I checked in and I’m ready to help. Open Chat if you want me to continue.';

const INTERNAL_PLANNING_PATTERNS = [
  /from catalog/i,
  /tool call/i,
  /get_tool_schema/i,
  /available tools?/i,
  /parameters not full/i,
  /to confirm schema/i,
  /another way/i,
  /but first/i,
  /the expectation is/i,
  /here goes/i,
  /respond concisely,? and since/i,
  /call\s+[a-z0-9_]+/i,
  /\banalyze_media\b/i,
  /\blist_open_windows\b/i,
];

function normalizeLine(value: string): string {
  // Preserve leading whitespace for markdown indentation (nested lists, code blocks)
  const match = value.match(/^(\s*)(.*)/);
  if (!match) return value.trim();
  const leading = match[1];
  const rest = match[2].replace(/\s+/g, ' ').trim();
  return rest ? leading + rest : '';
}

function truncateText(value: string, maxLength: number): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1))}…` : normalized;
}

function formatTriggerPayload(value: any, maxLength = 2000): string {
  if (!value) return '';
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return String(text || '').trim().slice(0, maxLength);
  } catch {
    return String(value || '').trim().slice(0, maxLength);
  }
}

function compactWindowTitle(title: string): string {
  const normalized = truncateText(title, 120);
  if (!normalized) return '';

  const parts = normalized
    .split(/\s+\|\s+|\s+[-—]\s+/)
    .map((part) => truncateText(part, 60))
    .filter(Boolean);

  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];
    if (/^(google chrome|chrome|arc|firefox|microsoft edge|edge|visual studio code|cursor|slack|discord|notion|terminal|powershell)$/i.test(last)) {
      return truncateText(`${prev} · ${last}`, 70);
    }
    return last;
  }

  return truncateText(normalized, 70);
}

function isUiArtifactLine(line: string): boolean {
  const normalized = normalizeLine(line).toLowerCase();
  return normalized === 'show less'
    || normalized.startsWith('reply to stuard')
    || normalized === 'open chat'
    || normalized === 'agent is thinking...'
    || normalized === 'local agent processing'
    || normalized === 'cloud vm processing';
}

function looksLikeInternalPlanningLine(line: string): boolean {
  const normalized = normalizeLine(line);
  if (!normalized) return false;
  if (isUiArtifactLine(normalized)) return true;
  if (/^(yes|no|maybe)\.?$/i.test(normalized)) return true;
  return INTERNAL_PLANNING_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function summarizeProactiveActivity(openWindows: Array<{ title?: string }> = []): string {
  const seen = new Set<string>();
  const titles: string[] = [];

  for (const windowInfo of openWindows) {
    const title = compactWindowTitle(String(windowInfo?.title || ''));
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length >= 3) break;
  }

  if (titles.length === 0) return 'No clear app context captured.';
  return titles.join('; ');
}

export function buildUserFacingProactiveMessage(rawText: string, fallback = DEFAULT_PROACTIVE_NOTIFICATION_MESSAGE): string {
  const raw = String(rawText || '').trim();
  if (!raw) return fallback;

  const lines = raw
    .split(/\r?\n/)
    .map((line) => normalizeLine(line))
    .filter(Boolean);

  if (lines.length === 0) return fallback;

  const filteredLines = lines.filter((line) => !looksLikeInternalPlanningLine(line));
  const filteredText = filteredLines.join('\n').trim();

  if (!filteredText) {
    return fallback;
  }

  const suspiciousLineCount = lines.filter((line) => looksLikeInternalPlanningLine(line)).length;
  const mostlyPlanning = suspiciousLineCount >= Math.max(2, Math.ceil(lines.length / 2));

  if (mostlyPlanning && filteredText.length < 24) {
    return fallback;
  }

  return filteredText;
}

export function buildProactiveSessionSummary(args: {
  existingSummary?: string;
  openWindows?: Array<{ title?: string }>;
  agentMessage?: string;
  taskCount?: number;
  skipped?: boolean;
  failureReason?: string;
  timedOut?: boolean;
}): string {
  const existingSummary = truncateText(String(args.existingSummary || ''), 320);
  if (existingSummary) return existingSummary;

  const activity = summarizeProactiveActivity(Array.isArray(args.openWindows) ? args.openWindows : []);

  if (args.failureReason) {
    const reason = truncateText(String(args.failureReason || ''), 160);
    return `Activity: ${activity} | Intervention: wake-up failed${args.timedOut ? ' after timing out' : ''}${reason ? ` — ${reason}` : ''}`;
  }

  if (args.skipped || !String(args.agentMessage || '').trim()) {
    return `Activity: ${activity} | Intervention: skipped the check-in because nothing materially changed.`;
  }

  const message = truncateText(buildUserFacingProactiveMessage(String(args.agentMessage || '')), 160);
  const taskCount = typeof args.taskCount === 'number' && args.taskCount > 0
    ? ` after reviewing ${args.taskCount} proactive task${args.taskCount === 1 ? '' : 's'}`
    : '';
  return `Activity: ${activity} | Intervention: notified the user${taskCount}${message ? ` — ${message}` : '.'}`;
}

export function splitProactiveStructuredContent(text: string): {
  message: string;
  structuredContent?: { toolName: 'show_table' | 'show_json'; args: any };
} {
  const source = String(text || '').trim();
  if (!source) return { message: '' };

  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  let best: { start: number; end: number; value: any } | null = null;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (start === -1) {
      if (ch === '{') {
        start = i;
        depth = 1;
        inString = false;
        escape = false;
      }
      continue;
    }

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') {
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = source.slice(start, i + 1).trim();
        try {
          const value = JSON.parse(candidate);
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            best = { start, end: i + 1, value };
          }
        } catch { }
        start = -1;
      }
    }
  }

  if (!best) {
    return { message: source };
  }

  const value = best.value;
  const toolName = Array.isArray(value?.columns) && Array.isArray(value?.data)
    ? 'show_table'
    : 'show_json';
  const args = toolName === 'show_table'
    ? value
    : { title: value?.title || 'Details', data: value };

  const before = source.slice(0, best.start).trim();
  const after = source.slice(best.end).trim();
  const message = [before, after].filter(Boolean).join('\n\n').trim() || 'Here are the details.';

  return {
    message,
    structuredContent: { toolName, args },
  };
}

export function extractAgentTextFromWsMessage(msg: any, fallback = ''): string {
  const candidates = [
    msg?.result?.text,
    msg?.result?.response,
    msg?.message?.text,
    msg?.message,
    msg?.text,
    msg?.response,
    msg?.result,
  ];

  for (const value of candidates) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }

  return fallback;
}

/**
 * The proactive prompt instructs the model to reply with just the word "skip"
 * when it has nothing worth saying. Detect that sentinel so the scheduler can
 * suppress the notification instead of literally showing "skip" to the user.
 */
export function isProactiveSkipResponse(text: string): boolean {
  const normalized = String(text || '')
    .replace(/[\s"'`*_.!?,;:()\[\]{}<>]+/g, '')
    .toLowerCase();
  return normalized === 'skip' || normalized === 'skipnotification' || normalized === 'noop';
}

/**
 * Strip leaked tool-call artifacts (XML tags, function-call syntax) from
 * proactive agent responses.  Models sometimes output these as plain text
 * when the tool isn't registered in the current chat session.
 */
export function cleanProactiveResponseText(text: string): string {
  if (!text) return text;
  let cleaned = text;

  // Remove XML tool-call blocks (greedy across lines):
  //   <invoke name="write_session_summary"><parameter name="summary">...</parameter></invoke>
  //   </minimax:tool_call>   etc.
  cleaned = cleaned.replace(/<\/?(?:invoke|parameter|antml:[a-z_]+|minimax:[a-z_]+|tool_call|function_call|tool_use)[^>]*>/gi, '');

  // Remove function-call syntax:  write_session_summary("...")  or  write_session_summary('...')
  cleaned = cleaned.replace(/\b[a-z_]{2,}\s*\(\s*["'][\s\S]*?["']\s*\)/gi, '');

  // Remove stray "or" connectors left between stripped blocks (e.g. "or write_session_summary(...)")
  cleaned = cleaned.replace(/\bor\s+[a-z_]{2,}\s*\(/gi, '');

  // Collapse runs of whitespace / blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}


export interface AgentToolRequest {
  id: string;
  tool: string;
  args: any;
}

// Tools that stay available to bots regardless of the per-bot allowedTools
// These are the bot's "default kit": user task board, private kanban, cross-run
// memory recall, plus the bookkeeping tools the scheduler relies on. External
// tools are added on top by exact name or explicit prefix.
const LOCAL_PROACTIVE_INTERNAL_TOOLS = new Set([
  'proactive_task_list',
  'proactive_task_update',
  'proactive_task_create',
  'proactive_task_delete',
  'bot_memory_list',
  'bot_memory_create',
  'bot_memory_update',
  'bot_memory_delete',
  'bot_memory_log',
  'write_session_summary',
  'choose_notification_channel',
  'search_tools',
  'get_tool_schema',
  'execute_tool',
  'get_skill_info',
  'search_past_conversations',
  'get_conversation_context',
]);

function localHumanizeToolName(name: string): string {
  return String(name || '')
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function localSearchAllowedTools(query: string, allowedTools?: string[]): Array<{ name: string; description: string; category: string }> {
  const q = String(query || '').toLowerCase().trim();
  const names = Array.from(new Set([
    ...(Array.isArray(allowedTools) ? allowedTools : []),
    ...Array.from(LOCAL_PROACTIVE_INTERNAL_TOOLS),
  ].map((name) => String(name || '').trim()).filter(Boolean)));

  return names
    .filter((name) => {
      if (!q) return true;
      const label = localHumanizeToolName(name).toLowerCase();
      return name.toLowerCase().includes(q) || label.includes(q);
    })
    .filter((name) => !name.startsWith('proactive_task_') && !name.startsWith('bot_memory_'))
    .slice(0, 12)
    .map((name) => ({
      name,
      description: `Allowed tool: ${localHumanizeToolName(name)}`,
      category: name.includes('_') ? name.split('_')[0] : 'tool',
    }));
}

export function extractAgentToolRequest(msg: any): AgentToolRequest | null {
  if (String(msg?.type || '').toLowerCase() !== 'tool_request') return null;

  const id = String(msg?.id || '').trim();
  const tool = String(msg?.tool || '').trim();
  if (!id || !tool) return null;

  return {
    id,
    tool,
    args: msg?.args || {},
  };
}

export async function executeAgentToolRequest(
  request: AgentToolRequest,
  ctx: RouterContext,
  execTool: (toolName: string, args: any, ctx: RouterContext) => Promise<any>,
  allowedTools?: string[],
): Promise<{ type: 'tool_result'; id: string; result: any }> {
  try {
    if (request.tool === 'search_tools') {
      const query = String(request.args?.query || '').trim();
      return {
        type: 'tool_result',
        id: request.id,
        result: { ok: true, tools: localSearchAllowedTools(query, allowedTools) },
      };
    }
    if (request.tool === 'get_tool_schema') {
      const toolName = String(request.args?.tool_name || request.args?.toolName || '').trim();
      if (!isLocalProactiveToolAllowed(toolName, allowedTools)) {
        return {
          type: 'tool_result',
          id: request.id,
          result: { ok: false, error: `Tool '${toolName}' is not allowed for this agent.` },
        };
      }
      return {
        type: 'tool_result',
        id: request.id,
        result: {
          ok: true,
          tool_name: toolName,
          schema: { type: 'object', additionalProperties: true },
          note: 'Desktop local proactive runs expose a permissive schema preview; call execute_tool with args matching the tool docs or prior examples.',
        },
      };
    }
    if (request.tool === 'execute_tool') {
      const toolName = String(request.args?.tool_name || request.args?.toolName || '').trim();
      const args = request.args?.args && typeof request.args.args === 'object' ? request.args.args : {};
      if (!isLocalProactiveToolAllowed(toolName, allowedTools)) {
        return {
          type: 'tool_result',
          id: request.id,
          result: { ok: false, error: `Tool '${toolName}' is not allowed for this agent.` },
        };
      }
      const result = await execTool(toolName, args, ctx);
      return { type: 'tool_result', id: request.id, result };
    }
    if (request.tool === 'choose_notification_channel') {
      return {
        type: 'tool_result',
        id: request.id,
        result: { ok: true, channel: 'app', urgency: 'normal', reason: 'Default desktop notification channel.' },
      };
    }
    if (!isLocalProactiveToolAllowed(request.tool, allowedTools)) {
      return {
        type: 'tool_result',
        id: request.id,
        result: { ok: false, error: `Tool '${request.tool}' is not allowed for this agent.` },
      };
    }
    const result = await execTool(request.tool, request.args, ctx);
    return { type: 'tool_result', id: request.id, result };
  } catch (e: any) {
    return {
      type: 'tool_result',
      id: request.id,
      result: { ok: false, error: e?.message || 'local_exec_failed' },
    };
  }
}

const LOCAL_PROACTIVE_MARKER = '[PROACTIVE MODE]';

export function isLocalProactiveToolAllowed(toolName: string, allowedTools?: string[]): boolean {
  const name = String(toolName || '').trim();
  if (!name) return false;
  if (LOCAL_PROACTIVE_INTERNAL_TOOLS.has(name)) return true;

  const allowedValues = Array.isArray(allowedTools) ? allowedTools : [];
  const allowed = new Set(allowedValues.map(t => String(t || '').trim()).filter(Boolean));
  if (allowed.has(name)) return true;
  if (name === 'run_system_command' && allowed.has('run_command')) return true;

  return Array.from(allowed).some(prefix => prefix.endsWith('_') && name.startsWith(prefix));
}

export function buildLocalProactivePrompt(payload: any): string {
  const parts: string[] = ['[Proactive Wake-Up] — Read the room, then decide what to do.'];

  // Task summary
  const tasks: any[] = Array.isArray(payload?.tasks) ? payload.tasks : [];
  const queued = tasks.filter((t: any) => t.status === 'queued');
  const inProgress = tasks.filter((t: any) => t.status === 'in_progress');

  if (queued.length > 0 || inProgress.length > 0) {
    parts.push('');
    parts.push(`Task board: ${queued.length} queued, ${inProgress.length} in-progress.`);
    for (const t of [...inProgress, ...queued].slice(0, 10)) {
      const detail = t.instructions ? ` — ${t.instructions}` : '';
      parts.push(`  • [${t.status}] "${t.title}" (id: ${t.id})${detail}`);
    }
    parts.push('');
    parts.push('Work on these silently. Only notify the user if you completed something they\'re waiting on or need input.');
  } else if (tasks.length > 0) {
    parts.push('\nAll tasks completed/failed. Focus on observation — create a task only if you spot a genuine opportunity.');
  } else {
    parts.push('\nNo tasks. Focus on reading the room and deciding if anything is worth bringing up.');
  }

  if (payload?.config?.instructions) {
    parts.push(`\nFocus instructions: ${String(payload.config.instructions).trim()}`);
  }

  const triggerPayload = formatTriggerPayload(payload?.context?.triggerPayload);
  if (triggerPayload) {
    parts.push(`\nTrigger payload:\n${triggerPayload}`);
  }

  if (payload?.context?.screenshot) {
    parts.push('\n(A screenshot of the user\'s current screen is attached.)');
  }

  // Notification digest — so the agent knows what it recently said
  const digest: string[] = Array.isArray(payload?.context?.notificationDigest) ? payload.context.notificationDigest : [];
  if (digest.length > 0) {
    parts.push('');
    parts.push('[YOUR RECENT NOTIFICATIONS — do not repeat these]');
    for (const line of digest.slice(0, 8)) {
      parts.push(`  ${line}`);
    }
    parts.push('Only bring up a topic from above if it has meaningfully escalated.');
  }

  parts.push('\nUse tools as needed to do the work. Your final response becomes the user notification, so the final text should be only the plain message you want the user to see — no XML, no code blocks, and no raw tool-call syntax. If you have nothing new or important to say, respond with just the word "skip".');
  return parts.join('\n');
}

export function buildLocalProactiveHiddenContext(payload: any): string {
  const lines = [
    LOCAL_PROACTIVE_MARKER,
    'This is a proactive wake-up. Your job: DO things, not remind about things. Act first, notify with results.',
    'Return a normal plain markdown/text reply only. Do NOT use GenUI, interactive UI blocks, JSON UI payloads, or code fences.',
    '',
    '## YOUR DEFAULT TOOLKIT (always available before added tools)',
    '- proactive_task_* — manage the USER\'s task board (tasks they see).',
    '- bot_memory_* — manage YOUR PRIVATE kanban. This is your working memory across runs:',
    '  • bot_memory_list — see your cards.',
    '  • bot_memory_create({ title, notes?, status? }) — capture a plan or finding.',
    '  • bot_memory_update({ id, ... }) — move cards between columns or edit notes.',
    '  • bot_memory_delete({ id }) — drop a card (prefer "completed" to preserve history).',
    '  • bot_memory_log({ summary, outcome }) — append a one-line run wrap-up.',
    '- search_past_conversations / get_conversation_context — recall prior runs and chats.',
    'Use bot_memory_* aggressively. Without it every run starts blind. The user can also edit these cards from the Agents > Kanban tab; lastEditedBy distinguishes their edits from yours.',
    'Kanban truth rule: if the user asks you to add, update, move, or delete a kanban card, call the matching bot_memory_* tool and verify ok=true before saying it was done. Never claim memory or kanban changes from text alone.',
    '',
    '## HOW TO THINK',
    '1. Read the context below (windows, calendar, session history) and your kanban (in the user message). What is the user doing, and what does your past self want you to pick up?',
    '2. Check your notification digest in the user message. DO NOT repeat yourself. If you said it before, skip it.',
    '3. If you have tasks or kanban cards, DO THE WORK — use tools, produce output, complete things. Update your kanban as you go. Then tell the user what you accomplished.',
    '4. If you spot a conflict (distraction + deadline), you can mention it — but only if you haven\'t already AND you\'re also offering help (e.g., "I prepped your meeting notes").',
    '5. If you have nothing to act on or report, skip the notification. Don\'t manufacture check-ins.',
    '',
    '## BIAS TOWARD ACTION',
    'You are NOT a reminder agent. Never say "don\'t forget" or "you should". Instead:',
    '- Research things → present findings',
    '- Draft things → show the draft',
    '- Complete tasks → report results',
    '- Spot opportunities → create a task and start working on it',
    '',
    '## ANTI-REPETITION',
    'Your notification digest shows what you recently told the user. Do NOT bring up the same topics unless they escalated.',
    'If the user ignored/dismissed your last 2+ notifications, strongly consider skipping.',
    'If the same activity keeps showing up across the last 5 wake-up summaries, call out the persistence and change your approach instead of repeating the same generic reminder.',
    '',
    '## TASKS',
    'Claim → work → complete. Create tasks for things YOU can do, not reminders for the user.',
    '',
    '## RESPONSE FORMAT',
    'Your text response IS the notification the user sees. Do NOT include tool calls, function calls, XML tags, or code blocks in your response.',
    'Just write the plain message you want the user to read. Keep it brief and conversational.',
  ];

  // Inject time context
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dayStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  lines.push('');
  lines.push(`Current time: ${timeStr}, ${dayStr}`);

  // Inject open windows context if available
  if (Array.isArray(payload?.context?.openWindows) && payload.context.openWindows.length > 0) {
    lines.push('');
    lines.push('[OPEN WINDOWS — user\'s currently visible apps]');
    for (const w of payload.context.openWindows.slice(0, 20)) {
      const title = String(w?.title || '').trim();
      if (title) lines.push(`- ${title}`);
    }
  }

  // Inject upcoming calendar events if available
  if (Array.isArray(payload?.context?.upcomingEvents) && payload.context.upcomingEvents.length > 0) {
    lines.push('');
    lines.push('[UPCOMING EVENTS — next few hours]');
    for (const ev of payload.context.upcomingEvents.slice(0, 10)) {
      const title = String(ev?.title || ev?.summary || '').trim();
      const start = String(ev?.start || ev?.startTime || '').trim();
      if (title) lines.push(`- ${title}${start ? ` (${start})` : ''}`);
    }
  }

  // Kanban first — the agent's private working memory is the most load-bearing
  // piece of context for any non-first run. Render it under its own header
  // before the user-configured focus brief so the model sees its own state
  // before it sees any directives.
  const kanbanContext = String(payload?.kanbanContext || '').trim();
  if (kanbanContext) lines.push(`\n${kanbanContext}`);

  const instructions = String(payload?.config?.instructions || '').trim();
  if (instructions) lines.push(`\nUser-configured proactive instructions: ${instructions}`);

  const triggerPayload = formatTriggerPayload(payload?.context?.triggerPayload);
  if (triggerPayload) {
    lines.push('');
    lines.push('[TRIGGER PAYLOAD]');
    lines.push(triggerPayload);
  }

  if (Array.isArray(payload?.config?.allowedTools) && payload.config.allowedTools.length > 0) {
    lines.push(`Added non-internal tools for this agent: ${payload.config.allowedTools.join(', ')}.`);
    lines.push('All other non-internal tools are not part of this agent. Exact tools add only that tool; prefixes like x_ add a family only when explicitly listed. Your default toolkit (proactive_task_*, bot_memory_*, search_past_conversations, get_conversation_context, choose_notification_channel, write_session_summary, search_tools/get_tool_schema/execute_tool) remains available regardless.');
    lines.push('If the user asks what tools you have, list only the added non-internal tools above plus your default toolkit. Do not answer with Stuard main-chat capabilities.');
  } else {
    lines.push('Added non-internal tools for this agent: (none).');
    lines.push('If the user asks what tools you have, list only your default toolkit. Do not answer with a generic Stuard main-chat capability list.');
  }

  // Inject previous session summaries for pattern awareness
  if (Array.isArray(payload?.context?.recentSessionSummaries) && payload.context.recentSessionSummaries.length > 0) {
    lines.push('');
    lines.push('[LAST 5 WAKE-UP SUMMARIES — use these to avoid repeating yourself]');
    lines.push('If the same activity appears more than once below, acknowledge that persistence and change your tack instead of sending the same reminder again.');
    for (const summary of payload.context.recentSessionSummaries.slice(0, 5)) {
      lines.push(`- ${String(summary).trim()}`);
    }
  }

  // Skill and workflow awareness
  lines.push('');
  lines.push('SKILLS: Use get_skill_info to look up user-defined skills. If a task matches a skill trigger, follow the skill steps.');
  lines.push('WORKFLOWS: Use search_local_workflows to find workflows and run_workflow to execute them.');

  if (Array.isArray(payload?.skills) && payload.skills.length > 0) {
    lines.push('Available skills:');
    for (const skill of payload.skills.slice(0, 15)) {
      const name = String(skill?.name || '').trim();
      const trigger = String(skill?.trigger || skill?.description || '').trim();
      if (name) lines.push(`- ${name}${trigger ? `: ${trigger}` : ''}`);
    }
  }

  return lines.join('\n');
}
