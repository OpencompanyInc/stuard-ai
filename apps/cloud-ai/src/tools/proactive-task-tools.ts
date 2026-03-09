import { z } from 'zod';
import { makeLocalTool } from './device/shared';

export const PROACTIVE_TASK_TOOL_NAMES = [
  'proactive_task_list',
  'proactive_task_update',
  'proactive_task_create',
  'proactive_task_delete',
] as const;

export function hasProactiveModeMarker(hiddenContext: unknown): boolean {
  return typeof hiddenContext === 'string' && (
    hiddenContext.includes('[PROACTIVE MODE]') ||
    hiddenContext.includes('[PROACTIVE FOLLOW-UP]')
  );
}

export function mergeForcedToolNames(rankedToolNames?: string[]): string[] {
  const merged = new Set([...(rankedToolNames || []), ...PROACTIVE_TASK_TOOL_NAMES]);
  return Array.from(merged);
}

const proactiveTaskOutputSchema = z.object({
  ok: z.boolean(),
  tasks: z.array(z.any()).optional(),
  task: z.any().optional(),
  error: z.string().optional(),
});

export const proactive_task_list = makeLocalTool(
  'proactive_task_list',
  'List the current proactive task board stored in the user\'s desktop app.',
  z.object({}).passthrough(),
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