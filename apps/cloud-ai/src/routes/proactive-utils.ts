import { BOT_MEMORY_TOOL_NAMES, PROACTIVE_TASK_TOOL_NAMES } from '../tools/proactive-task-tools';

/**
 * Internal tools that should ALWAYS be available to bot/proactive agents, even
 * when allowedTools filtering is active. These are bot plumbing: task-board
 * management, the bot's private kanban, notification/session bookkeeping, and
 * the meta-tools needed to inspect the allowed tool surface.
 */
const PROACTIVE_CORE_TOOLS = [
  ...PROACTIVE_TASK_TOOL_NAMES,
  ...BOT_MEMORY_TOOL_NAMES,
  'search_tools',
  'get_tool_schema',
  'execute_tool',
  'get_skill_info',
  'choose_notification_channel',
  'write_session_summary',
] as const;

const PROACTIVE_TOOL_FAMILY_PREFIXES = [
  ['google_', 'gmail_', 'calendar_', 'drive_', 'sheets_', 'docs_', 'tasks_'],
  ['outlook_'],
  ['github_'],
  ['facebook_', 'instagram_', 'threads_'],
  ['whatsapp_'],
  ['telnyx_'],
  ['x_'],
] as const;

export function isBlockedProactiveToolName(name: string): boolean {
  const trimmed = String(name || '').trim();
  return trimmed.startsWith('browser_') && !trimmed.startsWith('browser_use_');
}

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
  notificationDigest?: string[];
}): string {
  const parts: string[] = [];

  if (typeof args.prompt === 'string' && args.prompt.trim()) {
    parts.push(args.prompt.trim());
  } else {
    parts.push('[Proactive Wake-Up] — Read the room, then decide what to do.');

    const tasks = args.tasks || [];
    const queued = tasks.filter(t => t.status === 'queued');
    const inProgress = tasks.filter(t => t.status === 'in_progress');

    if (queued.length > 0 || inProgress.length > 0) {
      parts.push('');
      parts.push(`Task board: ${queued.length} queued, ${inProgress.length} in-progress.`);
      for (const t of [...inProgress, ...queued].slice(0, 10)) {
        const detail = t.instructions ? ` — ${t.instructions}` : '';
        parts.push(`  • [${t.status}] "${t.title}" (id: ${t.id})${detail}`);
      }
      parts.push('');
      parts.push('Work on these silently. Only notify the user if you completed something they\'re waiting on, or if you need their input.');
    } else if (args.taskCount > 0) {
      parts.push('\nAll tasks completed/failed. Focus on observation — create a task only if you spot a genuine opportunity.');
    } else {
      parts.push('\nNo tasks. Focus on reading the room and deciding if there\'s anything worth bringing up.');
    }
  }

  if (args.screenshot && typeof args.screenshot === 'string') {
    parts.push('\nA screenshot of the user\'s current screen is attached.');
  }

  // Inject notification digest so the agent knows what it recently said
  if (Array.isArray(args.notificationDigest) && args.notificationDigest.length > 0) {
    parts.push('');
    parts.push('[YOUR RECENT NOTIFICATIONS — do not repeat these]');
    for (const line of args.notificationDigest.slice(0, 8)) {
      parts.push(`  ${line}`);
    }
    parts.push('Only bring up a topic from above if it has meaningfully escalated.');
  }

  parts.push('\nYour response becomes the user notification. If you have nothing new or important to say, call choose_notification_channel with channel=\'skip\' and return a brief internal note.');
  return parts.join('\n');
}

/**
 * Build the user message content array for the proactive agent.
 * When a screenshot is available, returns a multi-part message with both text and image.
 */
export function buildProactiveMessageContent(args: { prompt?: string; taskCount: number; tasks?: TaskSnapshot[]; screenshot?: string | null; systemAudio?: string | null; micAudio?: string | null; notificationDigest?: string[] }): any[] {
  const textPart = buildProactiveUserMessage({
    prompt: args.prompt,
    taskCount: args.taskCount,
    tasks: args.tasks,
    screenshot: args.screenshot || undefined,
    notificationDigest: args.notificationDigest,
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

type RetryableToolErrorType = 'no_such_tool' | 'invalid_args' | 'tool_not_found' | 'tool_execution_error';

type RetryableToolError = {
  toolName: string;
  type: RetryableToolErrorType;
  message: string;
};

function extractToolName(message: string): string | undefined {
  const direct = message.match(/[Tt]ool\s+['"`]?([A-Za-z0-9_:-]+)['"`]?\s+(?:not found|does not exist|is not a tool)/);
  if (direct?.[1]) return direct[1];
  const fallback = message.match(/tool_not_found:\s*([A-Za-z0-9_:-]+)/i);
  return fallback?.[1];
}

export function detectRetryableToolError(error: any, seen: Set<any> = new Set()): RetryableToolError | null {
  if (!error || typeof error !== 'object') return null;
  if (seen.has(error)) return null;
  seen.add(error);

  const name = String(error.name || '');
  const message = String(error.message || '');

  if (name === 'AI_NoSuchToolError' || name === 'NoSuchToolError' || message.includes('is not a tool')) {
    return {
      toolName: error.toolName || extractToolName(message) || 'unknown',
      type: 'no_such_tool',
      message: message || 'The model tried to call a tool that does not exist.',
    };
  }

  if (name === 'AI_InvalidToolArgumentsError' || name === 'InvalidToolArgumentsError') {
    return {
      toolName: error.toolName || extractToolName(message) || 'unknown',
      type: 'invalid_args',
      message: message || 'The model generated invalid arguments for a tool call.',
    };
  }

  if (name === 'AI_ToolExecutionError' || name === 'ToolExecutionError') {
    return {
      toolName: error.toolName || extractToolName(message) || 'unknown',
      type: 'tool_execution_error',
      message: message || 'Tool execution failed.',
    };
  }

  const lower = message.toLowerCase();
  if (
    (lower.includes('tool') && (lower.includes('not found') || lower.includes('does not exist') || lower.includes('unknown tool'))) ||
    lower.includes('no such tool')
  ) {
    return {
      toolName: error.toolName || extractToolName(message) || 'unknown',
      type: 'tool_not_found',
      message,
    };
  }

  if (lower.includes('tool') && (lower.includes('failed') || lower.includes('error') || lower.includes('timeout'))) {
    return {
      toolName: error.toolName || extractToolName(message) || 'unknown',
      type: 'tool_execution_error',
      message,
    };
  }

  const nested = detectRetryableToolError(error.error, seen) || detectRetryableToolError(error.cause, seen);
  if (nested) return nested;

  return null;
}

export async function generateWithToolRecovery(args: {
  agent: { generate: (messages: any[], options?: Record<string, any>) => Promise<any> };
  baseMessages: any[];
  maxSteps?: number;
  maxRetries?: number;
  onToolNotFound?: (toolName: string) => void;
}): Promise<any> {
  const { agent, baseMessages, maxSteps = 20, maxRetries = 3, onToolNotFound } = args;
  const toolErrorHistory: string[] = [];
  let attempt = 0;

  while (attempt <= maxRetries) {
    const messages = toolErrorHistory.length > 0
      ? [
          ...baseMessages,
          { role: 'assistant', content: 'I tried to use a tool.' },
          {
            role: 'user',
            content: `[System: Tool call failed] ${toolErrorHistory[toolErrorHistory.length - 1]}. Please use only the tools available to you. Do NOT invent or guess tool names.`,
          },
        ]
      : baseMessages;

    try {
      return await agent.generate(messages, { maxSteps });
    } catch (error: any) {
      const toolError = detectRetryableToolError(error);
      if (!toolError || attempt >= maxRetries) {
        throw error;
      }

      attempt++;
      const isHallucination = toolError.type === 'no_such_tool' || toolError.type === 'tool_not_found';
      if (isHallucination) {
        // Try to dynamically register the missing tool so the retry succeeds
        if (onToolNotFound && toolError.toolName && toolError.toolName !== 'unknown') {
          onToolNotFound(toolError.toolName);
        }
        toolErrorHistory.push(
          `The tool "${toolError.toolName}" was not directly available. Use execute_tool({ tool_name: "${toolError.toolName}", args: {...} }) to run it, or call get_tool_schema first to make it available for direct use.`
        );
      } else if (toolError.type === 'invalid_args') {
        toolErrorHistory.push(
          `Tool "${toolError.toolName}" received invalid arguments: ${toolError.message}. Use get_tool_schema({ tool_name: "${toolError.toolName}" }) to see the correct argument format before retrying.`
        );
      } else {
        toolErrorHistory.push(
          `Tool "${toolError.toolName}" failed during execution: ${toolError.message}. Try a different approach or use a different tool.`
        );
      }
    }
  }

  throw new Error('Agent execution failed');
}

export function expandProactiveAllowedToolNames(allowedTools: unknown): string[] {
  const expanded = new Set(
    (Array.isArray(allowedTools) ? allowedTools : [])
      .map((tool) => String(tool || '').trim())
      .filter((tool) => tool && !isBlockedProactiveToolName(tool))
  );

  if (expanded.has('search_tools') || expanded.has('get_tool_schema') || expanded.has('execute_tool')) {
    expanded.add('search_tools');
    expanded.add('get_tool_schema');
    expanded.add('execute_tool');
  }

  for (const family of PROACTIVE_TOOL_FAMILY_PREFIXES) {
    const matched = Array.from(expanded).some((name) => family.some((prefix) => name.startsWith(prefix)));
    if (!matched) continue;
    for (const prefix of family) {
      expanded.add(prefix);
    }
  }

  return Array.from(expanded);
}

export function filterProactiveTools<T extends Record<string, any>>(tools: T, allowedTools: unknown): T {
  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    const filteredEntries = Object.entries(tools).filter(([name]) => !isBlockedProactiveToolName(name));
    return Object.fromEntries(filteredEntries) as T;
  }

  const expandedAllowed = expandProactiveAllowedToolNames(allowedTools);
  const filteredEntries = Object.entries(tools).filter(([name]) => {
    return isProactiveToolAllowed(name, expandedAllowed);
  });
  return Object.fromEntries(filteredEntries) as T;
}

export function isProactiveToolAllowed(name: string, allowedTools: unknown): boolean {
  const toolName = String(name || '').trim();
  if (!toolName || isBlockedProactiveToolName(toolName)) return false;

  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    return true;
  }

  const expandedAllowed = expandProactiveAllowedToolNames(allowedTools);
  if ((PROACTIVE_CORE_TOOLS as readonly string[]).includes(toolName)) return true;
  if (expandedAllowed.includes(toolName)) return true;
  return expandedAllowed.some((allowedName) => allowedName.endsWith('_') && toolName.startsWith(allowedName));
}

export function getProactiveCoreToolNames(): string[] {
  return Array.from(PROACTIVE_CORE_TOOLS);
}
