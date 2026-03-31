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

export interface AgentToolRequest {
  id: string;
  tool: string;
  args: any;
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
): Promise<{ type: 'tool_result'; id: string; result: any }> {
  try {
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

  parts.push('\nYour response becomes the user notification. If you have nothing new or important to say, skip the notification and just record a session summary.');
  return parts.join('\n');
}

export function buildLocalProactiveHiddenContext(payload: any): string {
  const lines = [
    LOCAL_PROACTIVE_MARKER,
    'This is a proactive wake-up. Your job: DO things, not remind about things. Act first, notify with results.',
    'Return a normal plain markdown/text reply only. Do NOT use GenUI, interactive UI blocks, JSON UI payloads, or code fences.',
    '',
    '## HOW TO THINK',
    '1. Read the context below (windows, calendar, session history). What is the user doing? What can you DO for them?',
    '2. Check your notification digest in the user message. DO NOT repeat yourself. If you said it before, skip it.',
    '3. If you have tasks, DO THE WORK — use tools, produce output, complete things. Then tell the user what you accomplished.',
    '4. If you spot a conflict (distraction + deadline), you can mention it — but only if you haven\'t already AND you\'re also offering help (e.g., "I prepped your meeting notes").',
    '5. If you have nothing to act on or report, skip the notification. Don\'t manufacture check-ins.',
    '',
    '## BIAS TOWARD ACTION',
    'You are NOT a reminder bot. Never say "don\'t forget" or "you should". Instead:',
    '- Research things → present findings',
    '- Draft things → show the draft',
    '- Complete tasks → report results',
    '- Spot opportunities → create a task and start working on it',
    '',
    '## ANTI-REPETITION',
    'Your notification digest shows what you recently told the user. Do NOT bring up the same topics unless they escalated.',
    'If the user ignored/dismissed your last 2+ notifications, strongly consider skipping.',
    '',
    '## TASKS',
    'Claim → work → complete. Use proactive_task_update to change status. Create tasks for things YOU can do, not reminders for the user.',
    '',
    '## SESSION MEMORY',
    'Call write_session_summary before finishing. Note: what user was doing, what you did (or skipped), patterns observed.',
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

  const instructions = String(payload?.config?.instructions || '').trim();
  if (instructions) lines.push(`\nUser-configured proactive instructions: ${instructions}`);

  if (Array.isArray(payload?.config?.allowedTools) && payload.config.allowedTools.length > 0) {
    lines.push(`Preferred non-proactive tools: ${payload.config.allowedTools.join(', ')}.`);
  }

  // Inject previous session summaries for pattern awareness
  if (Array.isArray(payload?.context?.recentSessionSummaries) && payload.context.recentSessionSummaries.length > 0) {
    lines.push('');
    lines.push('[RECENT SESSION OBSERVATIONS — patterns from your previous wake-ups]');
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
