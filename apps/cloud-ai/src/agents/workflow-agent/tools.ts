/**
 * Workflow Agent Tools - workflow-specific read/test helpers
 *
 * Total: 11 tools for the workflow agent
 * 1. search_tools (from meta-tools)
 * 2. get_tool_schema (from workflow-system)
 * 3. inspect_workflow (defined here)
 * 4. modify_workflow (from workflow.ts)
 * 5. execute_step (defined here)
 * 6. list_workflows (defined here)
 * 7. stop_workflow (from device-tools)
 * 8. web_search (from perplexity-tools)
 * 9. write_file (from device-tools)
 * 10. create_directory (from device-tools)
 * 11. file_edit (from agentic-file-tools)
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, hasClientBridge } from '../../tools/bridge';
import { getSessionWorkflow } from '../../tools/workflow';
import { workflowMap } from '../../tools/workflow-system';
import { writeLog } from '../../utils/logger';
import {
  analyzeWorkflowTopology,
  formatWorkflowSchematic,
  getFlowContextById,
  getWireBySelector,
} from '../../../../../shared/workflow-topology';

function wfLog(event: string, data?: Record<string, any>) {
  const msg = data ? `[wf-agent-tool] ${event}: ${JSON.stringify(data)}` : `[wf-agent-tool] ${event}`;
  console.log(msg);
  writeLog(`wf_agent_tool_${event}`, data);
}

function getWorkflowElementById(workflow: any, id: string) {
  return workflow?.nodes?.find((node: any) => node?.id === id)
    || workflow?.triggers?.find((trigger: any) => trigger?.id === id)
    || null;
}

function buildElementInspection(workflow: any, flowContext: any) {
  if (!flowContext?.id) return null;

  const element = getWorkflowElementById(workflow, flowContext.id);
  const predecessorElements = (flowContext.predecessorIds || [])
    .map((id: string) => getWorkflowElementById(workflow, id))
    .filter(Boolean);
  const successorElements = (flowContext.successorIds || [])
    .map((id: string) => getWorkflowElementById(workflow, id))
    .filter(Boolean);
  const relatedWires = (workflow?.wires || []).filter((wire: any) =>
    wire?.from === flowContext.id
    || wire?.to === flowContext.id
    || (flowContext.predecessorIds || []).includes(wire?.from)
    || (flowContext.successorIds || []).includes(wire?.to),
  );

  return {
    ...flowContext,
    element,
    predecessorElements,
    successorElements,
    relatedWires,
  };
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
      const result = await execLocalTool(
        tool,
        args && typeof args === 'object' && !Array.isArray(args)
          ? { ...args, __workflowToolCall: true }
          : args,
        writer as any,
        timeoutMs,
      );
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

export const inspectWorkflow = createTool({
  id: 'inspect_workflow',
  description: 'Inspect workflow topology. Use this for overview, full selected node/trigger details plus surrounding topology, or a single wire lookup.',
  inputSchema: z.object({
    mode: z.enum(['overview', 'node_flow', 'trigger_flow', 'wire']),
    nodeId: z.string().optional(),
    triggerId: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    index: z.number().int().min(0).optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    summary: z.string().optional(),
    validation: z.any().optional(),
    topology: z.any().optional(),
    nodeFlow: z.any().optional(),
    triggerFlow: z.any().optional(),
    wire: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const { mode, nodeId, triggerId, from, to, index } = inputData as any;
    wfLog('inspect_workflow', { mode, nodeId, triggerId, from, to, index });

    const workflow = getSessionWorkflow() || (workflowMap.size === 1 ? Array.from(workflowMap.values())[0] : null);
    if (!workflow) {
      return {
        ok: false,
        error: 'No workflow is loaded in session. The workflow should be provided through context.workflow before using inspect_workflow.',
      };
    }

    const analysis = analyzeWorkflowTopology(workflow);
    const validation = analysis.validation;
    const topology = analysis.overview;

    if (mode === 'overview') {
      return {
        ok: true,
        summary: formatWorkflowSchematic(workflow, { validationIssues: analysis.validation.issues }),
        validation,
        topology,
      };
    }

    if (mode === 'node_flow') {
      if (!nodeId) {
        return { ok: false, error: 'nodeId is required when mode is "node_flow"' };
      }
      const nodeFlow = getFlowContextById(analysis, nodeId);
      if (!nodeFlow || nodeFlow.kind !== 'node') {
        return { ok: false, error: `Node not found: ${nodeId}` };
      }
      return { ok: true, validation, topology, nodeFlow: buildElementInspection(workflow, nodeFlow) };
    }

    if (mode === 'trigger_flow') {
      if (!triggerId) {
        return { ok: false, error: 'triggerId is required when mode is "trigger_flow"' };
      }
      const triggerFlow = getFlowContextById(analysis, triggerId);
      if (!triggerFlow || triggerFlow.kind !== 'trigger') {
        return { ok: false, error: `Trigger not found: ${triggerId}` };
      }
      return { ok: true, validation, topology, triggerFlow: buildElementInspection(workflow, triggerFlow) };
    }

    const wire = getWireBySelector(analysis, { from, to, index });
    if (!wire) {
      return {
        ok: false,
        error: typeof index === 'number'
          ? `Wire not found at index ${index}`
          : `Wire not found for selector ${from || '?'} -> ${to || '?'}`,
      };
    }

    return {
      ok: true,
      validation,
      topology,
      wire: {
        ...wire,
        type: wire.classifications[0] || 'unconditional',
      },
    };
  },
});
