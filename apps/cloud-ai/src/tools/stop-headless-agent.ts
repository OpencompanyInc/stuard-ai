import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool } from './bridge';
import { abortHeadlessTask, getRunningTaskIds } from './deploy-headless-agent';
import { writeLog } from '../utils/logger';

/**
 * Tool to stop a running headless sub-agent.
 * This will:
 * 1. Abort the running stream if still active on the cloud
 * 2. Update the local Python agent's subagent status to 'cancelled'
 */
export const stopHeadlessAgent = createTool({
  id: 'stop_headless_agent',
  description: 'Stops a running headless sub-agent. Use this when you need to cancel a background task that was started with deploy_headless_agent.',
  inputSchema: z.object({
    task_id: z.string().describe('The task ID of the sub-agent to stop (returned from deploy_headless_agent)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    task_id: z.string().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { task_id } = context;

    if (!task_id) {
      return { ok: false, error: 'task_id is required' };
    }

    try {
      // 1. Try to abort the cloud-side running stream
      const abortedOnCloud = abortHeadlessTask(task_id);

      // 2. Update local Python agent status
      const localResult = await execLocalTool('subagent_stop', { task_id });

      if (localResult?.ok) {
        writeLog('headless_agent_stopped', { taskId: task_id, abortedOnCloud });
        return {
          ok: true,
          task_id,
          message: abortedOnCloud
            ? 'Sub-agent stopped successfully (stream aborted)'
            : 'Sub-agent marked as cancelled',
        };
      }

      // If local stop failed but we aborted on cloud, still consider it a success
      if (abortedOnCloud) {
        writeLog('headless_agent_stopped_cloud_only', { taskId: task_id });
        return {
          ok: true,
          task_id,
          message: 'Sub-agent stream aborted (local status update failed)',
        };
      }

      return {
        ok: false,
        task_id,
        error: localResult?.error || 'Failed to stop sub-agent',
      };

    } catch (error: any) {
      writeLog('headless_agent_stop_error', { taskId: task_id, error: error.message });
      return {
        ok: false,
        task_id,
        error: error.message || 'Failed to stop sub-agent',
      };
    }
  },
});

/**
 * Tool to list currently running headless sub-agents.
 */
export const listHeadlessAgents = createTool({
  id: 'list_headless_agents',
  description: 'Lists all running headless sub-agents. Use this to see what background tasks are currently active.',
  inputSchema: z.object({
    parent_id: z.string().optional().describe('Filter by parent conversation ID'),
    status: z.enum(['running', 'completed', 'failed', 'cancelled']).optional().describe('Filter by status'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    tasks: z.array(z.any()).optional(),
    running_on_cloud: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { parent_id, status } = context;

    try {
      // Get tasks from local Python agent
      const localResult = await execLocalTool('subagent_list', {
        parent_id,
        status,
        limit: 50
      });

      // Also get currently running task IDs from cloud
      const runningOnCloud = getRunningTaskIds();

      if (localResult?.ok) {
        return {
          ok: true,
          tasks: localResult.tasks || [],
          running_on_cloud: runningOnCloud,
        };
      }

      return {
        ok: false,
        error: localResult?.error || 'Failed to list sub-agents',
      };

    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Failed to list sub-agents',
      };
    }
  },
});
