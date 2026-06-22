/**
 * Workflow Agent Tools - workflow-specific read/test helpers
 *
 * Total: 11 tools for the workflow agent
 * 1. search_tools (from meta-tools)
 * 2. get_tool_schema (from workflow-system)
 * 3. inspect_workflow (defined here)
 * 4. modify_workflow (from workflow.ts)
 * 5. execute_step (defined here)
 * 6. search_workflows (defined here)
 * 7. stop_workflow (from device-tools)
 * 8. web_search (from perplexity-tools)
 * 9. write_file (from device-tools)
 * 10. create_directory (from device-tools)
 * 11. file_edit (from agentic-file-tools)
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, hasClientBridge } from '../../tools/bridge';
import { search_local_workflows } from '../../tools/device/workflows';
import { getSessionWorkflow, setSessionWorkflow, loadSubWorkflowFile } from '../../tools/workflow';
import { workflowMap } from '../../tools/workflow-system';
import { writeLog } from '../../utils/logger';
import {
  analyzeWorkflowTopology,
  formatWorkflowSchematic,
  getFlowContextById,
  getWireBySelector,
} from '@stuardai/workflow-core/topology';

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
  description:
    'Test-run node(s) on the device. ONE node: { tool, args }. A PATH: { steps:[{ id, tool, args }], context?, ' +
    'stopOnError? } runs them in order with shared context (reference a prior step as "{{priorStepId}}"). Give ' +
    'tool OR steps, not both. Whole flow → deploy_workflow.',
  // Free-form bags use z.object({}).loose() (NOT z.any(): a type-less property 400s
  // Gemini on the OpenRouter→Google path); optional fields are nullable so the model
  // can omit them. See project_gemini_tool_schema_no_any.
  inputSchema: z.object({
    tool: z.string().nullable().optional().describe('Single mode: node to run once.'),
    args: z.object({}).loose().nullable().optional().describe('Single mode: its args.'),
    steps: z.array(z.object({
      id: z.string().describe('Step id (ref as "{{id}}").'),
      tool: z.string().describe('Node to run.'),
      args: z.object({}).loose().nullable().optional().describe('Args; prior output = "{{priorStepId}}".'),
    })).nullable().optional().describe('Path mode: nodes in order, shared context.'),
    context: z.object({}).loose().nullable().optional().describe('Path mode: initial context.'),
    stopOnError: z.boolean().nullable().optional().describe('Path mode: stop on first failure (default true).'),
    timeoutMs: z.number().int().min(1000).max(120000).nullable().optional().describe('Single mode: timeout ms (default 30000).'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    // single-node mode
    result: z.any().optional(),
    duration: z.number().optional(),
    // sequence mode
    steps: z.any().optional(),
    finalContext: z.any().optional(),
    totalDuration_ms: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, { writer }) => {
    const { tool, args, steps, context, stopOnError, timeoutMs } = inputData as any;
    const startTime = Date.now();

    // ── Sequence mode: run a path of nodes with shared context ──
    if (Array.isArray(steps) && steps.length > 0) {
      wfLog('execute_step_sequence', { count: steps.length });
      try {
        const result = await execLocalTool(
          'test_run_steps',
          { steps, context: context || {}, stopOnError: stopOnError !== false },
          writer as any,
          Math.max(Number(timeoutMs) || 60000, 60000),
        );
        wfLog('execute_step_sequence_done', { ok: result?.ok });
        return {
          ok: result?.ok !== false,
          steps: result?.steps,
          finalContext: result?.finalContext,
          totalDuration_ms: result?.totalDuration_ms,
          error: result?.error,
        };
      } catch (e: any) {
        wfLog('execute_step_sequence_error', { error: e.message });
        return { ok: false, totalDuration_ms: Date.now() - startTime, error: e.message || 'Sequence run failed' };
      }
    }

    // ── Single-node mode ──
    if (typeof tool !== 'string' || !tool.trim()) {
      return { ok: false, error: 'Provide `tool` (+args) to test one node, or `steps` to test a sequence.' };
    }

    wfLog('execute_step', { tool });
    try {
      const result = await execLocalTool(
        tool,
        args && typeof args === 'object' && !Array.isArray(args)
          ? { ...args, __workflowToolCall: true }
          : (args || {}),
        writer as any,
        Number(timeoutMs) || 30000,
      );
      const duration = Date.now() - startTime;
      wfLog('execute_step_done', { tool, ok: result?.ok, duration });
      return { ok: result?.ok !== false, result, duration };
    } catch (e: any) {
      wfLog('execute_step_error', { tool, error: e.message });
      return { ok: false, duration: Date.now() - startTime, error: e.message || 'Execution failed' };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH WORKFLOWS - Search saved workflows
// ═══════════════════════════════════════════════════════════════════════════════

export const searchWorkflows = createTool({
  id: 'search_workflows',
  description: 'Search saved workflows from the local store by semantic meaning or lexical text.',
  inputSchema: z.object({
    query: z.string().optional().describe('Workflow name, id, or natural language description. Empty returns recent workflows.'),
    mode: z.enum(['semantic', 'lexical']).default('semantic').describe('semantic for natural language matching; lexical for exact text/name/id matching.'),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    workflows: z.array(z.object({
      id: z.string(),
      name: z.string(),
      path: z.string().optional(),
      description: z.string().optional(),
      score: z.number().optional(),
    })).optional(),
    mode: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, { writer }) => {
    const args = inputData as any;
    wfLog('search_workflows', { query: args?.query, mode: args?.mode, limit: args?.limit });

    if (!hasClientBridge()) {
      return { ok: true, workflows: [], error: 'No client bridge available' };
    }

    try {
      const result = await (search_local_workflows as any).execute?.(
        { query: args?.query || '', mode: args?.mode || 'semantic', limit: args?.limit || 10 },
        { writer } as any,
      );
      
      if (result?.ok && result?.workflows) {
        return {
          ok: true,
          mode: result.mode,
          workflows: result.workflows.map((w: any) => ({
            id: w.id || w.name,
            name: w.name,
            path: w.path,
            description: w.description,
            score: typeof w.score === 'number' ? w.score : undefined,
          })),
        };
      }

      return { ok: true, workflows: [] };
    } catch (e: any) {
      wfLog('search_workflows_error', { error: e.message });
      return { ok: false, workflows: [], error: e.message };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOAD WORKFLOW - Load an existing workflow from disk into the session
// ═══════════════════════════════════════════════════════════════════════════════

export const loadWorkflow = createTool({
  id: 'load_workflow',
  description:
    'Load an existing saved workflow into the editing session so inspect_workflow and modify_workflow can act on it. ' +
    'Use this when the user references an existing workflow by id (e.g. "modify flow_morning_brief"). ' +
    'Call search_workflows first if you do not know the exact id. ' +
    'After loading, call inspect_workflow to see the current topology before editing.',
  inputSchema: z.object({
    workflowId: z.string().describe('The id of the saved workflow to load (e.g. "flow_morning_brief").'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    id: z.string().optional(),
    name: z.string().optional(),
    nodes: z.number().optional(),
    wires: z.number().optional(),
    triggers: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, { writer }) => {
    const { workflowId } = inputData as { workflowId: string };
    wfLog('load_workflow_start', { workflowId });

    if (!workflowId) return { ok: false, error: 'workflowId is required' };
    if (!hasClientBridge()) {
      return { ok: false, error: 'No client bridge available — cannot read local workflows.' };
    }

    try {
      const res = await execLocalTool(
        'read_local_workflow',
        { workflowId },
        writer as any,
        10_000,
        { silent: true, noFallback: true },
      );

      let workflow: any = null;
      if (res?.ok) {
        if (res.model && typeof res.model === 'object') workflow = res.model;
        else if (typeof res.content === 'string') {
          try { workflow = JSON.parse(res.content); } catch { workflow = null; }
        }
      }

      if (!workflow || typeof workflow !== 'object') {
        return { ok: false, error: res?.error || `Workflow not found: ${workflowId}` };
      }

      if (!workflow.id) workflow.id = workflowId;
      setSessionWorkflow(workflow);
      wfLog('load_workflow_loaded', {
        id: workflow.id,
        nodes: workflow.nodes?.length,
        triggers: workflow.triggers?.length,
      });

      return {
        ok: true,
        id: String(workflow.id),
        name: workflow.name ? String(workflow.name) : undefined,
        nodes: Array.isArray(workflow.nodes) ? workflow.nodes.length : 0,
        wires: Array.isArray(workflow.wires) ? workflow.wires.length : 0,
        triggers: Array.isArray(workflow.triggers) ? workflow.triggers.length : 0,
      };
    } catch (e: any) {
      wfLog('load_workflow_error', { workflowId, error: e?.message });
      return { ok: false, error: e?.message || 'Failed to load workflow' };
    }
  },
});

export const inspectWorkflow = createTool({
  id: 'inspect_workflow',
  description:
    'Inspect workflow topology. Use mode="overview" for a summary; "node_flow" with nodeId for node details + surrounding topology; "trigger_flow" with triggerId for trigger details; "wire" with from/to (or index) for a single wire lookup. Pass stuardFile (e.g. "helpers/send-email.stuard") to inspect a sub-workflow file from the workspace instead of the main workflow. Pass null for unused fields.',
  // Schema is laid out for OpenAI strict mode (required by GPT-5 / Responses API
  // with strict tool schemas): every property is in `required`, optional fields
  // are `.nullable()` instead of `.optional()`. Without this, OpenAI rejects
  // tool calls or omits the call entirely, which is what made inspect_workflow
  // appear "broken" on GPT-5 while Gemini accepted it fine.
  inputSchema: z.object({
    mode: z.enum(['overview', 'node_flow', 'trigger_flow', 'wire']),
    nodeId: z.string().nullable(),
    triggerId: z.string().nullable(),
    from: z.string().nullable(),
    to: z.string().nullable(),
    index: z.number().int().min(0).nullable(),
    stuardFile: z.string().nullable(),
  }),
  // Output schema is internal-only — it validates the tool's return value
  // before it's serialized for the model. OpenAI strict mode does not apply to
  // outputs, so `.optional()` is fine here and keeps the return shape relaxed.
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
  execute: async (inputData, { writer }) => {
    const raw = inputData as any;
    // Schema is nullable for OpenAI strict mode — coerce null/"" back to
    // undefined so downstream helpers (getWireBySelector, typeof checks) work
    // unchanged. normalizeToolInputForSchema handles this upstream too.
    const nullish = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim() ? v : undefined;
    const mode = raw?.mode;
    const nodeId = nullish(raw?.nodeId);
    const triggerId = nullish(raw?.triggerId);
    const from = nullish(raw?.from);
    const to = nullish(raw?.to);
    const index = raw?.index == null || raw?.index === '' ? undefined : raw?.index;
    const stuardFile = typeof raw?.stuardFile === 'string' && raw.stuardFile.trim() ? raw.stuardFile.trim() : undefined;
    wfLog('inspect_workflow', { mode, nodeId, triggerId, from, to, index, stuardFile });

    let workflow: any;
    if (stuardFile) {
      const mainId = getSessionWorkflow()?.id;
      const loaded = await loadSubWorkflowFile(stuardFile, mainId, writer);
      if ('error' in loaded) return { ok: false, error: loaded.error };
      workflow = loaded.workflow;
    } else {
      workflow = getSessionWorkflow() || (workflowMap.size === 1 ? Array.from(workflowMap.values())[0] : null);
    }
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
