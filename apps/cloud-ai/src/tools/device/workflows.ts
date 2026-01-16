import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, hasClientBridge, makeLocalTool } from './shared';
import { workflowMap } from '../workflow-system';

export const list_local_workflows = createTool({
  id: 'list_local_workflows',
  description: 'List local Stuard workflows saved by the Stuard desktop app (from the workflows folder).',
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async (args, runCtx) => {
    // Check if we have a client bridge - if not, return empty gracefully
    if (!hasClientBridge()) {
      return { ok: true, items: [], _note: 'No desktop bridge available' };
    }
    const writer = (runCtx as any)?.writer;
    return await execLocalTool('list_local_workflows', args.context as any, writer as any, 15000);
  },
});

export const list_local_stuards = createTool({
  id: 'list_local_stuards',
  description: 'List local Stuard specs (Stuards automations) saved by the Stuard desktop app.',
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async (args, runCtx) => {
    // Check if we have a client bridge - if not, return empty gracefully
    if (!hasClientBridge()) {
      return { ok: true, items: [], _note: 'No desktop bridge available' };
    }
    const writer = (runCtx as any)?.writer;
    return await execLocalTool('list_local_stuards', args.context as any, writer as any, 15000);
  },
});

export const show_json_workflow_code = createTool({
  id: 'show_json_workflow_code',
  description: `Return the complete, full Stuard workflow JSON by workflow ID. This returns the entire workflow specification including all nodes, wires, triggers, and metadata.

Input: { id: "flow_xxx" } where flow_xxx is the workflow ID (e.g., "flow_ka3kby7p")
Output: { ok: true, workflow: { id, name, version, triggers, nodes, wires, ... }, filePath: "..." }

The returned workflow object contains the FULL JSON structure with all fields:
- id: workflow identifier
- name: workflow display name
- version: workflow version
- triggers: array of trigger definitions
- nodes: array of all workflow nodes/steps
- wires: array of connections between triggers and nodes
- All other workflow metadata

Use this tool to read workflow JSON - never use file_read for workflows!`,
  inputSchema: z.object({ 
    id: z.string().describe('The workflow ID (e.g., "flow_ka3kby7p")') 
  }),
  outputSchema: z.object({ 
    ok: z.boolean(),
    workflow: z.any().describe('The complete workflow JSON object with all fields (id, name, version, triggers, nodes, wires, etc.)'),
    filePath: z.string().optional().describe('The file path where the workflow is stored'),
    error: z.string().optional()
  }),
  execute: async (args, runCtx) => {
    const writer = (runCtx as any)?.writer;
    const context = args.context || {};

    // Check in-memory map first (for workflows created/modified in cloud AI)
    if (workflowMap.has(context.id)) {
      const workflow = workflowMap.get(context.id);
      try {
        await execLocalTool('show_json', {
          title: `Workflow: ${workflow.name || context.id || 'Workflow JSON'}`,
          data: workflow,
          expanded: true,
          maxDepth: 10
        }, writer);
      } catch (e) {
        // If show_json fails, still return the workflow data
      }
      return { ok: true, workflow, filePath: null };
    }

    // Try bridge first; if missing, fall back to direct agent WS (_forceDirect bypasses bridge check)
    const preferBridge = hasClientBridge();
    const result = await execLocalTool(
      'show_json_workflow_code',
      preferBridge ? context : { ...context, _forceDirect: true },
      writer as any,
    );
    
    // Automatically display the JSON if the workflow was successfully retrieved
    if (result?.ok && result?.workflow) {
      try {
        // Display the workflow JSON using show_json GenUI tool
        await execLocalTool('show_json', {
          title: `Workflow: ${result.workflow.name || args.context.id || 'Workflow JSON'}`,
          data: result.workflow,
          expanded: true,
          maxDepth: 10
        }, writer);
      } catch (e) {
        // If show_json fails, still return the workflow data
        // (non-blocking - the workflow data is still returned)
      }
    }
    
    return result;
  },
});

export const import_workflow = makeLocalTool(
  'import_workflow',
  'Import a WorkflowDefinition (authoring DSL) as a Stuard automation. The workflow will be saved and appear in the Automations tab. Pass the full WorkflowDefinition object with name, version, steps, etc.',
  z.object({
    definition: z.object({
      name: z.string(),
      version: z.string().default('1'),
      description: z.string().optional(),
      mode: z.enum(['auto', 'manual', 'hybrid']).optional(),
      inputs: z.any().optional().describe('Input schema as a key-value object.'),
      globals: z.any().optional(),
      policies: z
        .object({
          risk: z.enum(['low', 'medium', 'high']).optional(),
          spend_limit: z.number().optional(),
          ask_on: z.array(z.string()).optional(),
        })
        .optional(),
      triggers: z
        .array(
          z.object({
            id: z.string().optional(),
            type: z.string(),
            args: z.any().optional(),
          }),
        )
        .optional(),
      steps: z.array(
        z.object({
          id: z.string(),
          uses: z.string(),
          with: z.any().optional(),
          if: z.string().optional(),
          timeoutMs: z.number().optional(),
          retry: z
            .object({
              times: z.number().optional(),
              backoffMs: z.number().optional(),
            })
            .optional(),
          on_error: z.enum(['skip', 'halt', 'continue']).optional(),
          out: z.any().optional().describe('Output mappings as a key-value object.'),
        }),
      ),
      outputs: z.any().optional().describe('Final outputs as a key-value object.'),
    }),
  }),
  z.object({
    ok: z.boolean(),
    id: z.string().optional(),
    error: z.string().optional(),
  }),
);

export const run_automation = makeLocalTool(
  'run_automation',
  'Run a Stuard automation by its ID. The automation must exist in the local Stuards folder.',
  z.object({
    id: z.string().describe('The Stuard automation ID to run'),
    input: z.any().optional().describe('Optional input payload passed as ctx.input inside the Stuard run'),
  }),
  z.object({ ok: z.boolean().optional(), error: z.string().optional() }),
);

export const stop_automation = makeLocalTool(
  'stop_automation',
  'Stop a running Stuard automation by its ID.',
  z.object({ id: z.string().describe('The Stuard automation ID to stop') }),
  z.object({ ok: z.boolean().optional(), error: z.string().optional() }),
);

export const invoke_workflow = makeLocalTool(
  'invoke_workflow',
  'Invoke a workflow by ID with optional arguments. Use this to trigger workflows programmatically from the Stuard agent. Arguments are available inside the workflow as ctx.args.',
  z.object({
    id: z.string().describe('The workflow ID to invoke'),
    args: z
      .any()
      .optional()
      .describe('Optional key-value arguments passed to the workflow as ctx.args'),
    waitForCompletion: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, wait for workflow to complete before returning'),
  }),
  z.object({
    ok: z.boolean(),
    workflowId: z.string().optional(),
    status: z.enum(['started', 'completed', 'error']).optional(),
    result: z.any().optional(),
    error: z.string().optional(),
  }),
);

export const test_run_steps = createTool({
  id: 'test_run_steps',
  description: 'Test run one or more workflow steps without saving. Use this to validate step configurations and see actual output. Returns execution logs and results for debugging. Requires desktop app bridge.',
  inputSchema: z.object({
    steps: z
      .array(
        z.object({
          id: z.string().describe('Unique step ID'),
          tool: z.string().describe('Tool name to execute'),
          args: z.record(z.string(), z.any()).optional().describe('Tool arguments'),
        }),
      )
      .describe('Array of steps to execute in order'),
    context: z
      .record(z.string(), z.any())
      .optional()
      .describe('Initial context/variables available to steps'),
    stopOnError: z.boolean().optional().default(true).describe('Stop execution if a step fails'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    steps: z
      .array(
        z.object({
          id: z.string(),
          tool: z.string(),
          status: z.enum(['success', 'error', 'skipped']),
          duration_ms: z.number().optional(),
          result: z.any().optional(),
          error: z.string().optional(),
        }),
      )
      .optional(),
    totalDuration_ms: z.number().optional(),
    finalContext: z.record(z.string(), z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async (args, runCtx) => {
    // Check if we have a client bridge - if not, return error gracefully instead of timeout
    if (!hasClientBridge()) {
      return {
        ok: false,
        error: 'No desktop bridge available. test_run_steps requires the Stuard desktop app to be connected.',
        steps: [],
      };
    }
    const writer = (runCtx as any)?.writer;
    return await execLocalTool('test_run_steps', args.context as any, writer as any, 60000);
  },
});
