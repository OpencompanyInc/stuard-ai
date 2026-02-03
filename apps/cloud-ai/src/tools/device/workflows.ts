import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, hasClientBridge, makeLocalTool } from './shared';
import { workflowMap } from '../workflow-system';
import { embedMany } from 'ai';
import { resolveEmbedder, cosineSimilarity } from '../../utils/embeddings';

// Consolidated: All workflow listing is now done via search_local_workflows
// list_local_stuards is deprecated - stuards and workflows are the same concept now

export const list_local_stuards = createTool({
  id: 'list_local_stuards',
  description: '[DEPRECATED] Use search_local_workflows instead. Lists local workflow automations.',
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async (inputData, runCtx) => {
    // Redirect to search_local_workflows
    if (!hasClientBridge()) {
      return { ok: true, workflows: [], _note: 'No desktop bridge available' };
    }
    const writer = (runCtx as any)?.writer;
    return await execLocalTool('list_local_stuards', inputData as any, writer as any, 15000);
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
  execute: async (inputData, runCtx) => {
    const writer = (runCtx as any)?.writer;
    const context = (inputData as any) || {};

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

    if (!hasClientBridge()) {
      return { ok: false, error: 'No desktop bridge available. show_json_workflow_code requires the Stuard desktop app.' };
    }

    const result = await execLocalTool('show_json_workflow_code', context, writer as any);
    
    // Automatically display the JSON if the workflow was successfully retrieved
    if (result?.ok && result?.workflow) {
      try {
        // Display the workflow JSON using show_json GenUI tool
        await execLocalTool('show_json', {
          title: `Workflow: ${result.workflow.name || inputData.id || 'Workflow JSON'}`,
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
  undefined, // timeoutMs
  { noFallback: true }, // Desktop-only tool
);

export const execute_workflow = createTool({
  id: 'execute_workflow',
  description: 'Execute a workflow by ID with arguments and return its structured return value (from return_value). This is the recommended way to treat workflows as custom tools.',
  inputSchema: z.object({
    id: z.string().describe('The workflow ID to execute'),
    args: z.any().optional().describe('Optional key-value arguments passed to the workflow as ctx.args'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    workflowId: z.string().optional(),
    result: z.any().optional(),
    status: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, runCtx) => {
    const writer = (runCtx as any)?.writer;
    const context = (inputData as any) || {};
    const id = String(context.id || '').trim();
    if (!id) return { ok: false, error: 'missing_id' };

    // Check for bridge first
    if (!hasClientBridge()) {
      return { ok: false, error: 'No desktop bridge available. execute_workflow requires the Stuard desktop app.' };
    }

    // Always wait; this is a tool-like execution.
    return await execLocalTool(
      'invoke_workflow',
      {
        id,
        args: context.args,
        waitForCompletion: true,
      },
      writer as any,
      300000,
      { noFallback: true },
    );
  },
});

export const find_workflow_semantic = createTool({
  id: 'find_workflow_semantic',
  description: 'Find the best matching local workflow for a natural language query using embeddings. Returns the selected workflow id and basic metadata.',
  inputSchema: z.object({
    query: z.string().min(1).describe('Natural language description of the workflow you want'),
    topK: z.number().int().min(1).max(10).default(5).describe('How many matches to return'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    best: z.any().optional(),
    matches: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, runCtx) => {
    const writer = (runCtx as any)?.writer;
    const { query, topK } = inputData as any;

    if (!hasClientBridge()) {
      return { ok: false, error: 'No desktop bridge available. find_workflow_semantic requires the Stuard desktop app.' };
    }

    const listRes = await execLocalTool('list_local_workflows', {}, writer as any, 15000, { noFallback: true });
    const items = Array.isArray(listRes?.workflows) ? listRes.workflows : (Array.isArray(listRes?.items) ? listRes.items : []);
    if (!items.length) return { ok: true, matches: [], best: null };

    const texts = items.map((it: any) => {
      const id = String(it?.id || '');
      const name = String(it?.name || '');
      const triggers = Array.isArray(it?.triggers) ? it.triggers.join(', ') : '';
      const inputKeys = Array.isArray(it?.inputKeys) ? it.inputKeys.join(', ') : '';
      return `id=${id}\nname=${name}\ntriggers=${triggers}\ninputKeys=${inputKeys}`;
    });

    try {
      const { embedder } = await resolveEmbedder(writer as any);
      const { embeddings } = await embedMany({ model: embedder as any, values: [String(query), ...texts] });
      const qVec = embeddings[0];

      const scored = items.map((it: any, idx: number) => {
        const vec = embeddings[idx + 1];
        const score = cosineSimilarity(qVec as any, vec as any);
        return { ...it, score };
      });

      scored.sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));
      const matches = scored.slice(0, Math.max(1, Number(topK || 5)));
      return { ok: true, best: matches[0] || null, matches };
    } catch {
      // Fallback: simple keyword scoring (works even without embeddings API keys)
      const q = String(query || '').toLowerCase();
      const scored = items.map((it: any) => {
        const name = String(it?.name || '').toLowerCase();
        const id = String(it?.id || '').toLowerCase();
        const triggers = Array.isArray(it?.triggers) ? it.triggers.join(' ').toLowerCase() : '';
        const inputKeys = Array.isArray(it?.inputKeys) ? it.inputKeys.join(' ').toLowerCase() : '';
        const hay = `${id} ${name} ${triggers} ${inputKeys}`;
        const score = q && hay.includes(q) ? 1 : 0;
        return { ...it, score };
      });
      scored.sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));
      const matches = scored.slice(0, Math.max(1, Number(topK || 5)));
      return { ok: true, best: matches[0] || null, matches };
    }
  },
});

export const run_automation = makeLocalTool(
  'run_automation',
  'Run a Stuard automation by its ID. The automation must exist in the local Stuards folder.',
  z.object({
    id: z.string().describe('The Stuard automation ID to run'),
    input: z.any().optional().describe('Optional input payload passed as ctx.input inside the Stuard run'),
  }),
  z.object({ ok: z.boolean().optional(), error: z.string().optional() }),
  undefined, // timeoutMs
  { noFallback: true }, // Desktop-only tool
);

export const stop_automation = makeLocalTool(
  'stop_automation',
  'Stop a running Stuard automation by its ID.',
  z.object({ id: z.string().describe('The Stuard automation ID to stop') }),
  z.object({ ok: z.boolean().optional(), error: z.string().optional() }),
  undefined, // timeoutMs
  { noFallback: true }, // Desktop-only tool
);

export const invoke_workflow = createTool({
  id: 'invoke_workflow',
  description:
    'Invoke a workflow by ID with optional arguments. Use this to trigger workflows programmatically from the Stuard agent. Arguments are available inside the workflow as ctx.args.',
  inputSchema: z.object({
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
  outputSchema: z.object({
    ok: z.boolean(),
    workflowId: z.string().optional(),
    status: z.enum(['started', 'completed', 'error']).optional(),
    result: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, runCtx) => {
    // NOTE: makeLocalTool throws when no desktop bridge is available.
    // Wrap it so callers get a normal tool result instead of an exception.
    if (!hasClientBridge()) {
      return {
        ok: false,
        status: 'error' as const,
        error: 'No desktop bridge available. invoke_workflow must be called via the Stuard desktop IPC bridge.',
      };
    }

    const writer = (runCtx as any)?.writer;
    return await execLocalTool('invoke_workflow', inputData as any, writer as any, undefined, {
      noFallback: true,
    });
  },
});

export const search_local_workflows = createTool({
  id: 'search_local_workflows',
  description: `List and search local Stuard workflows. Returns workflow metadata and schemas.

Returns for each workflow:
- id, name, description
- triggers: list of trigger types (manual, hotkey, webhook.local, etc.)
- inputSchema: input parameters the workflow accepts
- outputSchema: output fields the workflow returns

Use with empty query to list all workflows, or provide a query to filter by name/description.
Use this before run_workflow to discover what arguments a workflow needs.`,
  inputSchema: z.object({
    query: z.string().optional().describe('Search query to filter workflows by name/description. If empty, returns all workflows.'),
    limit: z.number().int().min(1).max(50).default(10).describe('Maximum number of results to return'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    workflows: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      triggers: z.array(z.string()).describe('Trigger types (e.g., manual, hotkey, webhook.local)'),
      inputSchema: z.array(z.object({
        name: z.string(),
        type: z.string(),
        required: z.boolean().optional(),
        defaultValue: z.any().optional(),
        description: z.string().optional(),
      })).optional().describe('Input parameters the workflow accepts'),
      outputSchema: z.array(z.object({
        name: z.string(),
        type: z.string(),
        description: z.string().optional(),
      })).optional().describe('Output fields the workflow returns'),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, runCtx) => {
    const writer = (runCtx as any)?.writer;
    const { query, limit } = inputData as any;

    // Check if we have a client bridge
    if (!hasClientBridge()) {
      return { ok: true, workflows: [], _note: 'No desktop bridge available' };
    }

    // Get list of local workflows from desktop only (no Python agent fallback)
    // Note: execListLocalWorkflows returns { workflows: [...] }, not { items: [...] }
    const listRes = await execLocalTool('list_local_workflows', {}, writer as any, 15000, { noFallback: true });
    const items = Array.isArray(listRes?.workflows) ? listRes.workflows : (Array.isArray(listRes?.items) ? listRes.items : []);
    if (!items.length) return { ok: true, workflows: [] };

    // Filter by query if provided
    let filtered = items;
    if (query && typeof query === 'string' && query.trim()) {
      const q = query.toLowerCase().trim();
      filtered = items.filter((it: any) => {
        const name = String(it?.name || '').toLowerCase();
        const id = String(it?.id || '').toLowerCase();
        const desc = String(it?.description || '').toLowerCase();
        return name.includes(q) || id.includes(q) || desc.includes(q);
      });
    }

    // Limit results
    const limited = filtered.slice(0, Math.max(1, Number(limit || 10)));

    // For each workflow, fetch full details to get inputParams and outputSchema
    const workflows = await Promise.all(limited.map(async (item: any) => {
      try {
        const detailRes = await execLocalTool('show_json_workflow_code', { id: item.id }, undefined, 10000);
        const wf = detailRes?.workflow;

        if (!wf) {
          return {
            id: item.id,
            name: item.name || item.id,
            description: item.description,
            triggers: item.triggers || [],
            inputSchema: [],
            outputSchema: [],
          };
        }

        // Extract inputParams from triggers
        const triggers = Array.isArray(wf.triggers) ? wf.triggers : [];
        const triggerTypes = triggers.map((t: any) => t.type || 'unknown');
        
        // Collect all inputParams from all triggers
        const inputSchema: any[] = [];
        for (const trigger of triggers) {
          const params = (trigger as any).inputParams;
          if (Array.isArray(params)) {
            for (const param of params) {
              inputSchema.push({
                name: param.name,
                type: param.type || 'string',
                required: param.required || false,
                defaultValue: param.defaultValue,
                description: param.description,
              });
            }
          }
        }

        // Get outputSchema from workflow
        const outputSchema = Array.isArray(wf.outputSchema)
          ? wf.outputSchema.map((field: any) => ({
              name: field.name,
              type: field.type || 'string',
              description: field.description,
            }))
          : [];

        return {
          id: wf.id || item.id,
          name: wf.name || item.name || item.id,
          description: wf.description || item.description,
          triggers: triggerTypes,
          inputSchema,
          outputSchema,
        };
      } catch {
        // If detail fetch fails, return basic info
        return {
          id: item.id,
          name: item.name || item.id,
          description: item.description,
          triggers: item.triggers || [],
          inputSchema: [],
          outputSchema: [],
        };
      }
    }));

    return { ok: true, workflows };
  },
});

export const run_workflow = createTool({
  id: 'run_workflow',
  description: `Run a local workflow by ID or name with optional input arguments.

This is the main tool for executing workflows as custom tools. The workflow executes synchronously and returns its result.

Arguments are passed to the workflow and available as:
- {{trigger.data.paramName}} - for input parameters defined on triggers
- {{args.key}} - for direct argument access

Returns the workflow's return value (from return_value tool) or the final context.`,
  inputSchema: z.object({
    id: z.string().optional().describe('The workflow ID to run (e.g., "flow_abc123")'),
    name: z.string().optional().describe('The workflow name to run (searches for matching workflow)'),
    args: z.record(z.string(), z.any()).optional().describe('Input arguments passed to the workflow'),
    timeoutMs: z.number().int().min(1000).max(600000).default(120000).describe('Maximum execution time in milliseconds'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    workflowId: z.string().optional(),
    workflowName: z.string().optional(),
    result: z.any().optional().describe('The workflow return value or final output'),
    status: z.enum(['completed', 'error', 'timeout']).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, runCtx) => {
    const writer = (runCtx as any)?.writer;
    const { id, name, args, timeoutMs } = inputData as any;

    // Check if we have a client bridge
    if (!hasClientBridge()) {
      return { ok: false, error: 'No desktop bridge available. run_workflow requires the Stuard desktop app.' };
    }

    // Need either id or name
    if (!id && !name) {
      return { ok: false, error: 'Either id or name is required' };
    }

    let workflowId = id;
    let workflowName = name;

    // If name provided but not id, search for the workflow
    if (!workflowId && name) {
      const listRes = await execLocalTool('list_local_workflows', {}, writer as any, 15000, { noFallback: true });
      const items = Array.isArray(listRes?.workflows) ? listRes.workflows : (Array.isArray(listRes?.items) ? listRes.items : []);
      
      const q = String(name).toLowerCase().trim();
      const match = items.find((it: any) => {
        const itName = String(it?.name || '').toLowerCase();
        return itName === q || itName.includes(q);
      });

      if (!match) {
        return { ok: false, error: `No workflow found matching name: "${name}"` };
      }

      workflowId = match.id;
      workflowName = match.name;
    }

    // Execute the workflow
    try {
      const result = await execLocalTool(
        'invoke_workflow',
        {
          id: workflowId,
          args: args || {},
          waitForCompletion: true,
        },
        writer as any,
        timeoutMs || 120000,
      );

      if (result?.ok) {
        return {
          ok: true,
          workflowId,
          workflowName: workflowName || workflowId,
          result: result.result,
          status: 'completed' as const,
        };
      } else {
        return {
          ok: false,
          workflowId,
          workflowName: workflowName || workflowId,
          status: 'error' as const,
          error: result?.error || 'Workflow execution failed',
        };
      }
    } catch (e: any) {
      return {
        ok: false,
        workflowId,
        workflowName: workflowName || workflowId,
        status: 'error' as const,
        error: e?.message || 'Workflow execution failed',
      };
    }
  },
});

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
  execute: async (inputData, runCtx) => {
    // Check if we have a client bridge - if not, return error gracefully instead of timeout
    if (!hasClientBridge()) {
      return {
        ok: false,
        error: 'No desktop bridge available. test_run_steps requires the Stuard desktop app to be connected.',
        steps: [],
      };
    }
    const writer = (runCtx as any)?.writer;
    return await execLocalTool('test_run_steps', inputData as any, writer as any, 60000);
  },
});

// list_local_workflows removed - use search_local_workflows instead
