import { PROACTIVE_TASK_TOOL_NAMES as PROACTIVE_INTERNAL_TOOL_NAMES } from '../tools/proactive-task-tools';

/** Core tools that should ALWAYS be available to proactive agents, even when allowedTools filtering is active */
const PROACTIVE_CORE_TOOLS = [
  ...PROACTIVE_INTERNAL_TOOL_NAMES,
  'web_search',
  'deploy_headless_agent',
  'search_tools',
  'get_tool_schema',
  'execute_tool',
  'get_skill_info',
] as const;

interface TaskSnapshot {
  id: string;
  title: string;
  instructions: string;
  status: string;
  result?: string;
}

export function buildProactiveUserMessage(args: {
  prompt?: string;
  taskCount: number;
  tasks?: TaskSnapshot[];
  screenshot?: string | boolean;
}): string {
  const parts: string[] = [];

  if (typeof args.prompt === 'string' && args.prompt.trim()) {
    parts.push(args.prompt.trim());
  } else {
    parts.push('[Proactive Wake-Up] — Act on your tasks NOW.');

    const tasks = args.tasks || [];
    const queued = tasks.filter(t => t.status === 'queued');
    const inProgress = tasks.filter(t => t.status === 'in_progress');

    if (queued.length > 0 || inProgress.length > 0) {
      parts.push('');
      parts.push(`You have ${queued.length} queued and ${inProgress.length} in-progress task(s). Here they are:`);
      parts.push('');
      for (const t of [...inProgress, ...queued].slice(0, 15)) {
        const detail = t.instructions ? ` — ${t.instructions}` : '';
        parts.push(`• [${t.status.toUpperCase()}] "${t.title}" (id: ${t.id})${detail}`);
      }
      parts.push('');
      parts.push('ACTION REQUIRED:');
      parts.push('1. For each task above, call proactive_task_update(task_id, status="in_progress") to claim it');
      parts.push('2. Use your tools (web_search, execute_tool, etc.) to actually work on and complete the task');
      parts.push('3. When done, call proactive_task_update(task_id, status="completed", result="what you did")');
      parts.push('4. If you cannot complete it, set status="failed" with the reason');
      parts.push('Do NOT just list the tasks — actually work on them and change their status.');
    } else if (args.taskCount > 0) {
      parts.push(`\nYou have ${args.taskCount} task(s) (all completed/failed). Call proactive_task_list to review. Create new tasks if you spot opportunities.`);
    } else {
      parts.push('\nNo tasks on the board. Check in with the user — create a task if you spot something helpful.');
    }
  }

  if (args.screenshot && typeof args.screenshot === 'string') {
    parts.push('\nA screenshot of the user\'s current screen is attached for context.');
  }
  parts.push('\nYour final response will be shown as a user notification. Return ONLY a concise, user-facing summary of what you accomplished. Do not include reasoning or internal planning.');
  return parts.join('\n');
}

/**
 * Build the user message content array for the proactive agent.
 * When a screenshot is available, returns a multi-part message with both text and image.
 */
export function buildProactiveMessageContent(args: { prompt?: string; taskCount: number; tasks?: TaskSnapshot[]; screenshot?: string | null }): any[] {
  const textPart = buildProactiveUserMessage({
    prompt: args.prompt,
    taskCount: args.taskCount,
    tasks: args.tasks,
    screenshot: args.screenshot || undefined,
  });

  const content: any[] = [{ type: 'text', text: textPart }];

  if (typeof args.screenshot === 'string' && args.screenshot.length > 0) {
    // Extract media type and data from data URL (data:image/png;base64,...)
    const match = args.screenshot.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (match) {
      content.push({
        type: 'image',
        image: match[2],
        mimeType: match[1],
      });
    }
  }

  if (typeof args.systemAudio === 'string' && args.systemAudio.length > 0) {
    const match = args.systemAudio.match(/^data:(audio\/[^;]+);base64,(.+)$/);
    if (match) {
      content.push({
        type: 'file',
        data: Buffer.from(match[2], 'base64'),
        mimeType: match[1],
      });
    }
  }

  if (typeof args.micAudio === 'string' && args.micAudio.length > 0) {
    const match = args.micAudio.match(/^data:(audio\/[^;]+);base64,(.+)$/);
    if (match) {
      content.push({
        type: 'file',
        data: Buffer.from(match[2], 'base64'),
        mimeType: match[1],
      });
    }
  }

  return content;
}

export function filterProactiveTools<T extends Record<string, any>>(tools: T, allowedTools: unknown): T {
  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    return tools;
  }

  const allowed = new Set(
    allowedTools
      .map((tool) => String(tool || '').trim())
      .filter(Boolean)
  );

  // Always keep core proactive tools + user-allowed tools
  const keep = new Set<string>([...PROACTIVE_CORE_TOOLS, ...allowed]);
  const filteredEntries = Object.entries(tools).filter(([name]) => keep.has(name));
  return Object.fromEntries(filteredEntries) as T;
}