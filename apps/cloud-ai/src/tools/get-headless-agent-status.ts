import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getBridgeSecrets, execLocalTool } from './bridge';

export const getHeadlessAgentStatus = createTool({
  id: 'get_headless_agent_status',
  description: 'Retrieves the current status, logs, and results of a previously deployed sub-agent task.',
  inputSchema: z.object({
    taskId: z.string().describe('The unique task ID returned by deploy_headless_agent'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    task: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const { taskId  } = inputData as any;
    const secrets = getBridgeSecrets();
    const userId = secrets?.userId;

    if (!userId) {
      return { ok: false, error: 'User not authenticated' };
    }

    try {
      // Get sub-agent status from local storage
      const result = await execLocalTool('subagent_status', { task_id: taskId });

      if (!result?.ok) {
        return { ok: false, error: result?.error || 'Sub-agent not found' };
      }

      return {
        ok: true,
        task: result.task,
      };

    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Failed to fetch sub-agent status',
      };
    }
  },
});



