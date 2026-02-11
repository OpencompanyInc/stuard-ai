import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getBridgeSecrets, execLocalTool } from './bridge';

export const listHeadlessAgentTasks = createTool({
  id: 'list_headless_agent_tasks',
  description: 'List recent sub-agent tasks (optionally filtered by status or parent conversation).',
  inputSchema: z.object({
    status: z.enum(['running', 'completed', 'failed']).optional(),
    parent_id: z.string().optional().describe('Filter by parent conversation ID'),
    limit: z.number().min(1).max(100).default(25),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    tasks: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const secrets = getBridgeSecrets();
    const userId = secrets?.userId;
    const conversationId = secrets?.conversationId;
    if (!userId) return { ok: false, error: 'User not authenticated' };

    try {
      // Get sub-agents from local storage
      const result = await execLocalTool('subagent_list', {
        parent_id: (inputData as any).parent_id || conversationId,
        status: (inputData as any).status,
        limit: (inputData as any).limit,
      });

      if (!result?.ok) {
        return { ok: false, error: result?.error || 'Failed to list sub-agents' };
      }

      return { ok: true, tasks: result.tasks || [] };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Failed to list sub-agents' };
    }
  },
});





