/**
 * Workflow Subagent Tool
 *
 * Allows any agent (e.g. Stuard) to delegate workflow creation/modification
 * tasks to the specialized Workflow Architect agent mid-conversation.
 *
 * Now uses the generic orchestrator subagent runtime. Falls back to the
 * legacy Workflow Agent path when the orchestrator is disabled so
 * existing behavior is preserved.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getWorkflowAgent, WORKFLOW_SYSTEM_PROMPT } from '../agents/workflow-agent';
import { generateWithToolRecovery } from '../routes/proactive-utils';
import { safeToolWrite } from './bridge';
import { writeLog } from '../utils/logger';
import { runSubagent } from '../orchestrator/subagent-runtime';

const USE_ORCHESTRATOR = process.env.USE_ORCHESTRATOR === '1';

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

    // ── New path: use generic subagent runtime ──
    if (USE_ORCHESTRATOR) {
      const runId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await runSubagent({
        request: { kind: 'workflow', instruction, context, timeoutMs },
        runId,
        parentRunId: runId,
      });
      return { ok: result.ok, result: result.result, error: result.error };
    }

    // ── Legacy path: direct Workflow Agent ──
    const agent = getWorkflowAgent();

    let prompt = instruction;
    if (context) {
      prompt += `\n\nAdditional context:\n${context}`;
    }

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Workflow subagent timed out')), timeoutMs);
      });

      const runPromise = generateWithToolRecovery({
        agent: agent as any,
        baseMessages: [
          { role: 'system', content: WORKFLOW_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        maxSteps: 60,
        maxRetries: 3,
      });

      const response: any = await Promise.race([runPromise, timeoutPromise]);
      const text = response?.text || '';

      writeLog('route_to_workflow_agent_done', { ok: true, textLength: text.length });

      return { ok: true, result: text };
    } catch (error: any) {
      writeLog('route_to_workflow_agent_error', { error: error.message });
      return { ok: false, error: error.message || 'Workflow subagent failed' };
    }
  },
});
