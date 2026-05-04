import { z } from 'zod';
import { makeLocalTool } from './device/shared';

export const PROACTIVE_TASK_TOOL_NAMES = [
  'proactive_task_list',
  'proactive_task_update',
  'proactive_task_create',
  'proactive_task_delete',
] as const;

/**
 * Bot's private kanban + run-log tools. Distinct from proactive_task_*
 * (which are user-facing tasks): bot_memory_* is the *bot's own* working
 * memory across runs, surfaced in the Kanban tab of BotsView. Always
 * force-included for proactive runs so the bot can remember.
 */
export const BOT_MEMORY_TOOL_NAMES = [
  'bot_memory_list',
  'bot_memory_create',
  'bot_memory_update',
  'bot_memory_delete',
  'bot_memory_log',
] as const;

export function hasProactiveModeMarker(hiddenContext: unknown): boolean {
  return typeof hiddenContext === 'string' && (
    hiddenContext.includes('[PROACTIVE MODE]') ||
    hiddenContext.includes('[PROACTIVE FOLLOW-UP]')
  );
}

export function mergeForcedToolNames(rankedToolNames?: string[]): string[] {
  const merged = new Set([
    ...(rankedToolNames || []),
    ...PROACTIVE_TASK_TOOL_NAMES,
    ...BOT_MEMORY_TOOL_NAMES,
  ]);
  return Array.from(merged);
}

const proactiveTaskOutputSchema = z.object({
  ok: z.boolean(),
  tasks: z.array(z.any()).optional(),
  task: z.any().optional(),
  total: z.number().optional(),
  hasMore: z.boolean().optional(),
  error: z.string().optional(),
});

export const proactive_task_list = makeLocalTool(
  'proactive_task_list',
  'List the current proactive task board stored in the user\'s desktop app. Returns paginated results (default 20). Use status filter to narrow results.',
  z.object({
    status: z.enum(['queued', 'in_progress', 'completed', 'failed']).optional().describe('Filter tasks by status. Omit to return all statuses.'),
    limit: z.number().int().min(1).max(100).default(20).describe('Max tasks to return (default 20).'),
    offset: z.number().int().min(0).default(0).describe('Number of tasks to skip for pagination (default 0).'),
  }),
  proactiveTaskOutputSchema,
  30000,
  { noFallback: true }
);

export const proactive_task_update = makeLocalTool(
  'proactive_task_update',
  'Update a proactive task on the user\'s desktop board. Use this to move tasks between queued, in_progress, completed, or failed.',
  z.object({
    task_id: z.string().min(1),
    status: z.enum(['queued', 'in_progress', 'completed', 'failed']),
    result: z.string().optional(),
  }),
  proactiveTaskOutputSchema,
  30000,
  { noFallback: true }
);

export const proactive_task_create = makeLocalTool(
  'proactive_task_create',
  'Create a new proactive follow-up task on the user\'s desktop board.',
  z.object({
    title: z.string().min(1),
    instructions: z.string().optional(),
    status: z.enum(['queued', 'in_progress', 'completed', 'failed']).optional(),
  }),
  proactiveTaskOutputSchema,
  30000,
  { noFallback: true }
);

export const proactive_task_delete = makeLocalTool(
  'proactive_task_delete',
  'Delete a proactive task from the user\'s desktop board. Use this to remove obsolete or duplicate tasks.',
  z.object({
    task_id: z.string().min(1),
  }),
  proactiveTaskOutputSchema,
  30000,
  { noFallback: true }
);