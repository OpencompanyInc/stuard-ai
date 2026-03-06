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
  return value.replace(/\s+/g, ' ').trim();
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
  const parts: string[] = ['[Proactive Wake-Up] — Act on your tasks NOW.'];

  const tasks: any[] = Array.isArray(payload?.tasks) ? payload.tasks : [];
  const queued = tasks.filter((t: any) => t.status === 'queued');
  const inProgress = tasks.filter((t: any) => t.status === 'in_progress');

  if (queued.length > 0 || inProgress.length > 0) {
    parts.push('');
    parts.push(`You have ${queued.length} queued and ${inProgress.length} in-progress task(s):`);
    parts.push('');
    for (const t of [...inProgress, ...queued].slice(0, 15)) {
      const detail = t.instructions ? ` — ${t.instructions}` : '';
      parts.push(`• [${String(t.status).toUpperCase()}] "${t.title}" (id: ${t.id})${detail}`);
    }
    parts.push('');
    parts.push('ACTION REQUIRED:');
    parts.push('1. Call proactive_task_update(task_id, status="in_progress") to claim each task');
    parts.push('2. Use your tools (web_search, execute_tool, etc.) to actually complete the task');
    parts.push('3. Call proactive_task_update(task_id, status="completed", result="what you did")');
    parts.push('4. If you cannot complete it, set status="failed" with the reason');
    parts.push('Do NOT just list the tasks — actually work on them and change their status.');
  } else if (tasks.length > 0) {
    parts.push(`You have ${tasks.length} task(s) (all completed/failed). Call proactive_task_list to review. Create new tasks if needed.`);
  } else {
    parts.push('No proactive tasks on the board. Check in with the user and create a task if useful.');
  }

  if (payload?.config?.instructions) {
    parts.push(`\nFocus instructions: ${String(payload.config.instructions).trim()}`);
  }

  if (payload?.context?.screenshot) {
    parts.push('(A screenshot of the user\'s current screen is attached.)');
  }

  parts.push('\nYour final response will be shown as a user notification. Return ONLY a concise summary of what you accomplished. Mention task status changes you made.');
  return parts.join('\n');
}

export function buildLocalProactiveHiddenContext(payload: any): string {
  const lines = [
    LOCAL_PROACTIVE_MARKER,
    'This is a proactive wake-up. You MUST actively work on tasks — not just list or acknowledge them.',
    '',
    'CRITICAL: For each queued/in-progress task you MUST:',
    '1. Call proactive_task_update(task_id, "in_progress") to claim it',
    '2. Use tools (web_search, execute_tool, search_tools, etc.) to ACTUALLY DO THE WORK',
    '3. Call proactive_task_update(task_id, "completed", result="summary") when done',
    '4. Or set status="failed" with the reason if you cannot complete it',
    '',
    'Other task tools: proactive_task_create (new tasks), proactive_task_delete (remove obsolete).',
  ];

  const instructions = String(payload?.config?.instructions || '').trim();
  if (instructions) lines.push(`\nUser-configured proactive instructions: ${instructions}`);

  if (Array.isArray(payload?.config?.allowedTools) && payload.config.allowedTools.length > 0) {
    lines.push(`Preferred non-proactive tools: ${payload.config.allowedTools.join(', ')}.`);
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