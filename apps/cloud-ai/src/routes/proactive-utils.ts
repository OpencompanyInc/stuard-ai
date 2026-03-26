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
  'search_past_conversations',
  'get_conversation_context',
  'choose_notification_channel',
  'write_session_summary',
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
export function buildProactiveMessageContent(args: { prompt?: string; taskCount: number; tasks?: TaskSnapshot[]; screenshot?: string | null; systemAudio?: string | null; micAudio?: string | null }): any[] {
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
}): Promise<any> {
  const { agent, baseMessages, maxSteps = 20, maxRetries = 3 } = args;
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
        toolErrorHistory.push(
          `The tool "${toolError.toolName}" does not exist and cannot be called directly. Use search_tools to find available tools, or use execute_tool({ tool_name: "...", args: {...} }) to run tools by name. Do NOT invent tool names — only use tools you can verify exist.`
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