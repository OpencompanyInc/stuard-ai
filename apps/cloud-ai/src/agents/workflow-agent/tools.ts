/**
 * Workflow Agent Tools - LEAN (only 2 tools here, 4 imported from elsewhere)
 *
 * Total: 6 tools for the workflow agent
 * 1. search_tools (from meta-tools)
 * 2. get_tool_schema (from workflow-system)
 * 3. modify_workflow (from workflow.ts)
 * 4. execute_step (defined here)
 * 5. list_workflows (defined here)
 * 6. stop_workflow (from device-tools)
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, hasClientBridge } from '../../tools/bridge';
import { writeLog } from '../../utils/logger';

function wfLog(event: string, data?: Record<string, any>) {
  const msg = data ? `[wf-agent-tool] ${event}: ${JSON.stringify(data)}` : `[wf-agent-tool] ${event}`;
  console.log(msg);
  writeLog(`wf_agent_tool_${event}`, data);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTE STEP - Test/run a single tool (sis execute)
// ═══════════════════════════════════════════════════════════════════════════════

export const executeStep = createTool({
  id: 'execute_step',
  description: 'Execute a single tool to test it before adding to a workflow. Returns the tool result.',
  inputSchema: z.object({
    tool: z.string().describe('Tool name to execute'),
    args: z.any().default({}).describe('Tool arguments'),
    timeoutMs: z.number().int().min(1000).max(120000).default(30000).describe('Timeout in ms'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    result: z.any().optional(),
    duration: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, { writer }) => {
    const { tool, args, timeoutMs } = inputData as any;
    const startTime = Date.now();

    wfLog('execute_step', { tool });

    try {
      const result = await execLocalTool(tool, args, writer as any, timeoutMs);
      const duration = Date.now() - startTime;

      wfLog('execute_step_done', { tool, ok: result?.ok, duration });

      return {
        ok: result?.ok !== false,
        result,
        duration,
      };
    } catch (e: any) {
      wfLog('execute_step_error', { tool, error: e.message });
      return {
        ok: false,
        duration: Date.now() - startTime,
        error: e.message || 'Execution failed',
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// LIST WORKFLOWS - List all saved workflows
// ═══════════════════════════════════════════════════════════════════════════════

export const listWorkflows = createTool({
  id: 'list_workflows',
  description: 'List all saved workflows from the local store.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    workflows: z.array(z.object({
      id: z.string(),
      name: z.string(),
      path: z.string().optional(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, { writer }) => {
    wfLog('list_workflows');

    if (!hasClientBridge()) {
      return { ok: true, workflows: [], error: 'No client bridge available' };
    }

    try {
      const result = await execLocalTool('list_local_workflows', {}, writer as any, 10000);
      
      if (result?.ok && result?.workflows) {
        return {
          ok: true,
          workflows: result.workflows.map((w: any) => ({
            id: w.id || w.name,
            name: w.name,
            path: w.path,
          })),
        };
      }

      return { ok: true, workflows: [] };
    } catch (e: any) {
      wfLog('list_workflows_error', { error: e.message });
      return { ok: false, workflows: [], error: e.message };
    }
  },
});
