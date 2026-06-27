import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, getResolvedBridgeSecrets, hasClientBridge, makeLocalTool, anyJsonObject, anyJsonValue } from './shared';
import { workflowMap } from '../workflow-system';
import { embedMany } from 'ai';
import { resolveEmbedder, cosineSimilarity } from '../../utils/embeddings';
import { sendVMCommand } from '../../services/vm-command';

// Consolidated: All workflow listing is now done via search_local_workflows
// list_local_stuards is deprecated - stuards and workflows are the same concept now

type VMWorkflowDeployment = {
  id: string;
  name: string;
  description?: string;
  triggers: string[];
  status?: string;
  sourceWorkflowId?: string | null;
  score?: number;
};

function resolveWorkflowUserId(inputData?: any): string {
  const secrets = getResolvedBridgeSecrets();
  const candidates = [
    secrets?.userId,
    inputData?.__userId,
  ];
  for (const value of candidates) {
    const userId = typeof value === 'string' ? value.trim() : '';
    if (userId) return userId;
  }
  return '';
}

function vmWorkflowTriggers(deploy: any): string[] {
  const bindings = Array.isArray(deploy?.trigger_bindings)
    ? deploy.trigger_bindings
    : Array.isArray(deploy?.triggerBindings)
      ? deploy.triggerBindings
      : [];
  const triggers = bindings
    .map((binding: any) => String(binding?.type || binding?.triggerType || binding?.id || '').trim())
    .filter(Boolean);
  return triggers.length ? Array.from(new Set(triggers)) : ['manual'];
}

function mapVMWorkflowDeployment(deploy: any): VMWorkflowDeployment | null {
  const id = String(deploy?.id || '').trim();
  if (!id) return null;
  const kind = String(deploy?.kind || 'workflow').toLowerCase();
  if (kind !== 'workflow') return null;
  return {
    id,
    name: String(deploy?.name || id),
    description: deploy?.description ? String(deploy.description) : undefined,
    triggers: vmWorkflowTriggers(deploy),
    status: deploy?.status ? String(deploy.status) : undefined,
    sourceWorkflowId: deploy?.source_workflow_id || deploy?.sourceWorkflowId || null,
  };
}

function lexicalWorkflowScore(workflow: VMWorkflowDeployment, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const haystack = [
    workflow.id,
    workflow.name,
    workflow.description || '',
    workflow.sourceWorkflowId || '',
    workflow.triggers.join(' '),
  ].join(' ').toLowerCase();
  if (workflow.id.toLowerCase() === q || workflow.name.toLowerCase() === q) return 1;
  if (workflow.name.toLowerCase().includes(q)) return 0.9;
  if (haystack.includes(q)) return 0.7;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits / tokens.length;
}

async function listVMWorkflowDeployments(
  userId: string,
  timeoutMs = 15000,
): Promise<{ ok: boolean; workflows: VMWorkflowDeployment[]; error?: string }> {
  if (!userId) return { ok: false, workflows: [], error: 'missing_user_context' };
  const result = await sendVMCommand(userId, 'deploy_list', {}, timeoutMs);
  if (!result.ok) {
    return { ok: false, workflows: [], error: result.error || 'vm_deploy_list_failed' };
  }
  const deploys = Array.isArray(result.result?.deploys) ? result.result.deploys : [];
  return {
    ok: true,
    workflows: deploys
      .map(mapVMWorkflowDeployment)
      .filter(Boolean) as VMWorkflowDeployment[],
  };
}

async function findVMWorkflowDeployment(
  userId: string,
  input: { id?: string; name?: string; timeoutMs?: number },
): Promise<{ ok: boolean; workflow?: VMWorkflowDeployment; error?: string }> {
  const listed = await listVMWorkflowDeployments(userId, input.timeoutMs || 15000);
  if (!listed.ok) return { ok: false, error: listed.error };
  const id = String(input.id || '').trim();
  if (id) {
    const byId = listed.workflows.find((workflow) => (
      workflow.id === id || workflow.sourceWorkflowId === id
    ));
    if (byId) return { ok: true, workflow: byId };
  }

  const name = String(input.name || '').toLowerCase().trim();
  if (name) {
    const byName = listed.workflows.find((workflow) => workflow.name.toLowerCase() === name)
      || listed.workflows.find((workflow) => workflow.name.toLowerCase().includes(name))
      || listed.workflows
        .map((workflow) => ({ workflow, score: lexicalWorkflowScore(workflow, name) }))
        .sort((a, b) => b.score - a.score)[0]?.workflow;
    if (byName) return { ok: true, workflow: byName };
  }

  return { ok: false, error: id ? `No VM workflow deployment found for id: ${id}` : `No VM workflow deployment found matching name: "${input.name || ''}"` };
}

async function triggerVMWorkflowDeployment(
  userId: string,
  workflow: VMWorkflowDeployment,
  args: any,
  source: string,
  timeoutMs = 30000,
): Promise<{ ok: boolean; result?: any; error?: string }> {
  const result = await sendVMCommand(userId, 'deploy_trigger', {
    deployId: workflow.id,
    payload: { args: args || {}, input: args || {} },
    source,
  }, timeoutMs);
  if (!result.ok) return { ok: false, error: result.error || 'vm_deploy_trigger_failed' };
  return { ok: true, result: result.result || { triggered: true } };
}

export const list_local_stuards = createTool({
  id: 'list_local_stuards',
  description: '[DEPRECATED] Use search_local_workflows instead. Lists local workflow automations.',
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async (inputData, runCtx) => {
    // Redirect to search_local_workflows
    if (!hasClientBridge()) {
      const userId = resolveWorkflowUserId(inputData);
      const listed = await listVMWorkflowDeployments(userId);
      return {
        ok: listed.ok,
        workflows: listed.workflows,
        mode: 'vm',
        error: listed.error,
      };
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
      inputs: anyJsonObject.optional().describe('Input schema as a key-value object.'),
      globals: anyJsonObject.optional(),
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
            args: anyJsonObject.optional(),
          }),
        )
        .optional(),
      steps: z.array(
        z.object({
          id: z.string(),
          uses: z.string(),
          with: anyJsonObject.optional(),
          if: z.string().optional(),
          timeoutMs: z.number().optional(),
          retry: z
            .object({
              times: z.number().optional(),
              backoffMs: z.number().optional(),
            })
            .optional(),
          on_error: z.enum(['skip', 'halt', 'continue']).optional(),
          out: anyJsonObject.optional().describe('Output mappings as a key-value object.'),
        }),
      ),
      outputs: anyJsonObject.optional().describe('Final outputs as a key-value object.'),
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
    args: anyJsonObject.optional().describe('Optional key-value arguments passed to the workflow as ctx.args'),
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

    if (!hasClientBridge()) {
      const userId = resolveWorkflowUserId(context);
      const found = await findVMWorkflowDeployment(userId, { id, timeoutMs: 15000 });
      if (!found.ok || !found.workflow) {
        return { ok: false, workflowId: id, status: 'error', error: found.error || 'workflow_not_found_on_vm' };
      }
      const triggered = await triggerVMWorkflowDeployment(
        userId,
        found.workflow,
        context.args || {},
        'execute_workflow',
        30000,
      );
      return triggered.ok
        ? {
            ok: true,
            workflowId: found.workflow.sourceWorkflowId || found.workflow.id,
            result: triggered.result,
            status: 'started',
          }
        : {
            ok: false,
            workflowId: found.workflow.sourceWorkflowId || found.workflow.id,
            status: 'error',
            error: triggered.error,
          };
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

export const run_automation = makeLocalTool(
  'run_automation',
  'Run a Stuard automation by its ID. The automation must exist in the local Stuards folder.',
  z.object({
    id: z.string().describe('The Stuard automation ID to run'),
    input: anyJsonValue.optional().describe('Optional input payload passed as ctx.input inside the Stuard run'),
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
    args: anyJsonObject
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
      const context = (inputData as any) || {};
      const userId = resolveWorkflowUserId(context);
      const workflowId = String(context.id || '').trim();
      if (!workflowId) return { ok: false, status: 'error' as const, error: 'missing_id' };
      const found = await findVMWorkflowDeployment(userId, { id: workflowId, timeoutMs: 15000 });
      if (!found.ok || !found.workflow) {
        return { ok: false, workflowId, status: 'error' as const, error: found.error || 'workflow_not_found_on_vm' };
      }
      const triggered = await triggerVMWorkflowDeployment(
        userId,
        found.workflow,
        context.args || {},
        'invoke_workflow',
        context.waitForCompletion ? 30000 : 15000,
      );
      return triggered.ok
        ? {
            ok: true,
            workflowId: found.workflow.sourceWorkflowId || found.workflow.id,
            status: 'started' as const,
            result: triggered.result,
          }
        : {
            ok: false,
            workflowId: found.workflow.sourceWorkflowId || found.workflow.id,
            status: 'error' as const,
            error: triggered.error,
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
  description: `Search local Stuard workflows semantically or lexically. Returns workflow metadata and schemas.

Returns for each workflow:
- id, name, description
- triggers: list of trigger types (manual, hotkey, webhook.local, etc.)
- inputSchema: input parameters the workflow accepts
- outputSchema: output fields the workflow returns

Use with empty query to browse workflows, or provide a query to search by meaning or exact text.
Use this before run_workflow to discover what arguments a workflow needs.`,
  inputSchema: z.object({
    query: z.string().optional().describe('Search query. If empty, returns recent workflows.'),
    mode: z.enum(['semantic', 'lexical']).default('semantic').describe('semantic uses embeddings for natural language matching; lexical uses exact text/token matching.'),
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
      score: z.number().optional(),
    })).optional(),
    mode: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, runCtx) => {
    const writer = (runCtx as any)?.writer;
    const { query, limit, mode } = inputData as any;
    const searchMode = mode === 'lexical' ? 'lexical' : 'semantic';
    const trimmedQuery = typeof query === 'string' ? query.trim() : '';
    const resultLimit = Math.max(1, Number(limit || 10));

    if (!hasClientBridge()) {
      const userId = resolveWorkflowUserId(inputData);
      const listed = await listVMWorkflowDeployments(userId, 15000);
      if (!listed.ok) {
        return { ok: false, workflows: [], mode: 'vm', error: listed.error };
      }
      const workflows = listed.workflows
        .map((workflow) => ({ ...workflow, score: lexicalWorkflowScore(workflow, trimmedQuery) }))
        .filter((workflow) => !trimmedQuery || Number(workflow.score || 0) > 0)
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, resultLimit);
      return { ok: true, workflows, mode: 'vm' };
    }

    const localSearch = async (localQuery: string, localLimit: number) => {
      const res = await execLocalTool(
        'search_local_workflows',
        { query: localQuery, limit: localLimit, mode: 'lexical' },
        writer as any,
        15000,
        { noFallback: true },
      );
      return Array.isArray(res?.workflows) ? res.workflows : [];
    };

    if (searchMode === 'semantic' && trimmedQuery) {
      const candidates = await localSearch('', 250);
      if (!candidates.length) return { ok: true, workflows: [], mode: 'semantic' };

      const texts = candidates.map((it: any) => {
        const triggers = Array.isArray(it?.triggers) ? it.triggers.join(', ') : '';
        const inputs = Array.isArray(it?.inputSchema)
          ? it.inputSchema.map((p: any) => `${p?.name || ''}:${p?.description || p?.type || ''}`).join(', ')
          : '';
        const outputs = Array.isArray(it?.outputSchema)
          ? it.outputSchema.map((p: any) => `${p?.name || ''}:${p?.description || p?.type || ''}`).join(', ')
          : '';
        return [
          `id=${String(it?.id || '')}`,
          `name=${String(it?.name || '')}`,
          `description=${String(it?.description || '')}`,
          `triggers=${triggers}`,
          `inputs=${inputs}`,
          `outputs=${outputs}`,
        ].join('\n');
      });

      try {
        const { embedder } = await resolveEmbedder(writer as any);
        const { embeddings } = await embedMany({ model: embedder as any, values: [trimmedQuery, ...texts] });
        const qVec = embeddings[0];
        const workflows = candidates.map((it: any, idx: number) => ({
          ...it,
          score: cosineSimilarity(qVec as any, embeddings[idx + 1] as any),
        })).sort((a: any, b: any) => Number(b.score || 0) - Number(a.score || 0))
          .slice(0, resultLimit);
        return { ok: true, workflows, mode: 'semantic' };
      } catch {
        const workflows = await localSearch(trimmedQuery, resultLimit);
        return { ok: true, workflows, mode: 'lexical', error: 'semantic_search_unavailable_fell_back_to_lexical' };
      }
    }

    const workflows = await localSearch(trimmedQuery, resultLimit);
    return { ok: true, workflows, mode: 'lexical' };
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
    status: z.enum(['started', 'completed', 'error', 'timeout']).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, runCtx) => {
    const writer = (runCtx as any)?.writer;
    const { id, name, args, timeoutMs } = inputData as any;

    // Need either id or name
    if (!id && !name) {
      return { ok: false, error: 'Either id or name is required' };
    }

    if (!hasClientBridge()) {
      const userId = resolveWorkflowUserId(inputData);
      const found = await findVMWorkflowDeployment(userId, {
        id,
        name,
        timeoutMs: 15000,
      });
      if (!found.ok || !found.workflow) {
        return {
          ok: false,
          workflowId: id,
          workflowName: name,
          status: 'error' as const,
          error: found.error || 'workflow_not_found_on_vm',
        };
      }
      const triggered = await triggerVMWorkflowDeployment(
        userId,
        found.workflow,
        args || {},
        'run_workflow',
        Math.min(Number(timeoutMs || 30000), 30000),
      );
      return triggered.ok
        ? {
            ok: true,
            workflowId: found.workflow.sourceWorkflowId || found.workflow.id,
            workflowName: found.workflow.name,
            result: triggered.result,
            status: 'started' as const,
          }
        : {
            ok: false,
            workflowId: found.workflow.sourceWorkflowId || found.workflow.id,
            workflowName: found.workflow.name,
            status: 'error' as const,
            error: triggered.error || 'Workflow execution failed on VM',
          };
    }

    let workflowId = id;
    let workflowName = name;

    // If name provided but not id, search for the workflow
    if (!workflowId && name) {
      const searchRes = await execLocalTool(
        'search_local_workflows',
        { query: name, limit: 5, mode: 'lexical' },
        writer as any,
        15000,
        { noFallback: true },
      );
      const items = Array.isArray(searchRes?.workflows) ? searchRes.workflows : [];
      
      const q = String(name).toLowerCase().trim();
      const match = items.find((it: any) => {
        const itName = String(it?.name || '').toLowerCase();
        return itName === q || itName.includes(q);
      }) || items[0];

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

// Workflow discovery is handled by search_local_workflows.
