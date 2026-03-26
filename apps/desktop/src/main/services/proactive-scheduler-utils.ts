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
  const parts: string[] = ['[Proactive Wake-Up] — Observe first, then act.'];

  // Task summary
  const tasks: any[] = Array.isArray(payload?.tasks) ? payload.tasks : [];
  const queued = tasks.filter((t: any) => t.status === 'queued');
  const inProgress = tasks.filter((t: any) => t.status === 'in_progress');

  parts.push('');
  parts.push('ACTION REQUIRED: assess the user context, then actively move proactive tasks forward.');
  parts.push('STEP 1: Check the user\'s situation — call list_open_windows and calendar tools.');
  parts.push('STEP 2: If there\'s a conflict (distraction + deadline), lead with that.');
  parts.push('STEP 3: Work on tasks below.');
  parts.push('STEP 4: Call write_session_summary before finishing.');

  if (queued.length > 0 || inProgress.length > 0) {
    parts.push('');
    parts.push(`You have ${queued.length} queued and ${inProgress.length} in-progress task(s):`);
    parts.push('');
    for (const t of [...inProgress, ...queued].slice(0, 15)) {
      const detail = t.instructions ? ` — ${t.instructions}` : '';
      parts.push(`- [${String(t.status).toUpperCase()}] "${t.title}" (id: ${t.id})${detail}`);
    }
    parts.push('');
    parts.push('For each task: claim it (in_progress), do the work, then use proactive_task_update to mark completed/failed.');
  } else if (tasks.length > 0) {
    parts.push(`\nAll ${tasks.length} task(s) completed/failed. Review the board, create new tasks if useful.`);
  } else {
    parts.push('\nNo proactive tasks on the board. Focus on situational awareness and check in if needed.');
  }

  if (payload?.config?.instructions) {
    parts.push(`\nFocus instructions: ${String(payload.config.instructions).trim()}`);
  }

  if (payload?.context?.screenshot) {
    parts.push('\n(A screenshot of the user\'s current screen is attached for context.)');
  }

  parts.push('\nYour final response becomes the user notification. Be concise and lead with the most important thing.');
  return parts.join('\n');
}

export function buildLocalProactiveHiddenContext(payload: any): string {
  const lines = [
    LOCAL_PROACTIVE_MARKER,
    'This is a proactive wake-up. Follow the OBSERVE FIRST, THEN ACT procedure from your system prompt.',
    'Return a normal plain markdown/text reply only. Do NOT use GenUI, interactive UI blocks, JSON UI payloads, or code fences unless the user explicitly asks for code.',
    '',
    '## PHASE 1 — SITUATIONAL AWARENESS (do this first)',
    'Before working on tasks, observe the user\'s current state:',
    '1. Use execute_tool to call list_open_windows — see what apps/windows are open',
    '2. Use execute_tool to call calendar tools — check upcoming events in the next few hours',
    '3. Cross-reference: Is the user doing something that conflicts with their schedule?',
    '4. Determine urgency level (critical/high/normal/low)',
    '',
    '## PHASE 2 — ACT ON OBSERVATIONS',
    'If you detect a conflict (e.g., gaming before an exam), lead with that.',
    'If the user is focused on productive work, keep your message minimal.',
    '',
    '## PHASE 3 — WORK ON TASKS',
    'For each queued/in-progress task:',
    '1. Call proactive_task_update(task_id, "in_progress") to claim it',
    '2. Use tools (web_search, execute_tool, search_tools, etc.) to ACTUALLY DO THE WORK',
    '3. Call proactive_task_update(task_id, "completed", result="summary") when done',
    '4. Or set status="failed" with the reason if you cannot complete it',
    '',
    '## PHASE 4 — SESSION MEMORY',
    'Before finishing, call write_session_summary to record what you observed.',
    'Other task tools: proactive_task_create (new tasks), proactive_task_delete (remove obsolete).',
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
