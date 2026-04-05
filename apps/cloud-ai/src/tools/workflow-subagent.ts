/**
 * Workflow Subagent Tool
 *
 * Allows any agent (e.g. Stuard) to delegate workflow creation/modification
 * tasks to the specialized Workflow Architect agent mid-conversation.
 *
 * Uses the generic orchestrator subagent runtime.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { writeLog } from '../utils/logger';
import { runSubagent } from '../orchestrator/subagent-runtime';

export const routeToWorkflowAgent = createTool({
  id: 'route_to_workflow_agent',
  description:
    'Delegates a task to the Workflow Architect subagent, which specialises in creating and modifying StuardAI workflows. ' +
    'Use this when the user wants to build, edit, or manage an automation workflow. ' +
    'Provide a clear instruction describing what the workflow should do. ' +
    'The subagent has access to workflow tools (modify_workflow, execute_step, list_workflows, etc.).',
  inputSchema: z.object({
    instruction: z
      .string()
      .describe(
        'A detailed description of the workflow to create or modify. Include trigger type, steps, conditions, and any specifics the user mentioned.',
      ),
    context: z
      .string()
      .optional()
      .describe(
        'Additional context such as existing workflow ID to modify, user preferences, or relevant conversation history.',
      ),
    timeoutMs: z
      .number()
      .default(120_000)
      .describe('Maximum time in milliseconds to allow the workflow agent to work (default 120s).'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    result: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ instruction, context, timeoutMs }) => {
    writeLog('route_to_workflow_agent_start', { instruction, hasContext: !!context });

    const runId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await runSubagent({
      request: { kind: 'workflow', instruction, context, timeoutMs },
      runId,
      parentRunId: runId,
    });
    return { ok: result.ok, result: result.result, error: result.error };
  },
});
