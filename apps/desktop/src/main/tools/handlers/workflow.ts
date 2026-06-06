import * as path from 'path';
import { app } from 'electron';
import {
  readWorkflowModel,
  designerModelToStuardSpec,
  workflows_list,
  workflows_read,
  workflows_save,
  workflows_deploy,
  workflows_undeploy,
  workflows_getDeployStatus,
  workflows_gatherWorkspaceBundle,
} from '../../workflows/workflows';
import { runStuardEngine, EngineContext } from '../../engine';
import { stuards_save, stuards_list } from '../../stuards';
import { RouterContext } from '../types';

/**
 * Call a workflow as a function - waits for completion and returns result
 * This is the preferred way to call workflows with the 'function' trigger
 */
export async function execCallWorkflow(args: any, ctx: RouterContext): Promise<any> {
  try {
    const workflowId = String(args?.workflowId || args?.id || '').trim();
    if (!workflowId) return { ok: false, error: 'missing workflowId' };
    
    const inputs = args?.inputs || args?.args || {};
    
    // Build payload with inputs available as ctx.input and ctx.args
    const payload = { args: inputs, input: inputs };
    
    const stuardsDir = path.join(app.getPath('userData'), 'stuards');
    const engineCtx: EngineContext = {
      stuardsDir,
      agentWsUrl: ctx.agentWsUrl,
      cloudAiUrl: ctx.cloudAiUrl,
      logFn: ctx.logFn,
    };
    
    // Read and convert workflow
    const model = readWorkflowModel(workflowId);
    if (!model) return { ok: false, error: 'workflow_not_found', workflowId };
    
    // Check if workflow has a function trigger
    const hasFunctionTrigger = model.triggers?.some((t: any) => t.type === 'function');
    if (!hasFunctionTrigger) {
      ctx.logFn(`Warning: Workflow ${workflowId} doesn't have a 'function' trigger`);
    }
    
    const spec = designerModelToStuardSpec(model);
    
    // Save spec temporarily for execution
    const saveRes = stuards_save({ id: workflowId, content: JSON.stringify(spec, null, 2) });
    if (!saveRes?.ok) return { ok: false, error: saveRes?.error || 'failed to prepare workflow' };
    
    // Wait for completion and get return value
    try {
      const runRes: any = await runStuardEngine(workflowId, payload, engineCtx);
      return {
        ok: true,
        workflowId,
        result: runRes?.returnValue,
      };
    } catch (e: any) {
      return { ok: false, workflowId, error: e?.message || 'execution failed' };
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'call_workflow failed' };
  }
}

/**
 * Invoke a workflow with custom arguments
 */
export async function execInvokeWorkflow(args: any, ctx: RouterContext): Promise<any> {
  try {
    const id = String(args?.id || '').trim();
    if (!id) return { ok: false, error: 'missing workflow id' };
    
    const customArgs = args?.args || {};
    const waitForCompletion = args?.waitForCompletion === true;
    
    // Build payload with args available as ctx.args in the workflow
    const payload = { args: customArgs, input: customArgs };
    
    const stuardsDir = path.join(app.getPath('userData'), 'stuards');
    const engineCtx: EngineContext = {
      stuardsDir,
      agentWsUrl: ctx.agentWsUrl,
      cloudAiUrl: ctx.cloudAiUrl,
      logFn: ctx.logFn,
    };
    
    // Read and convert workflow
    const model = readWorkflowModel(id);
    if (!model) return { ok: false, error: 'workflow_not_found' };
    
    const spec = designerModelToStuardSpec(model);
    
    // Save spec temporarily for execution
    const saveRes = stuards_save({ id, content: JSON.stringify(spec, null, 2) });
    if (!saveRes?.ok) return { ok: false, error: saveRes?.error || 'failed to prepare workflow' };
    
    if (waitForCompletion) {
      // Wait for completion
      try {
        const runRes: any = await runStuardEngine(id, payload, engineCtx);
        return {
          ok: true,
          workflowId: id,
          status: 'completed',
          result: runRes?.returnValue,
        };
      } catch (e: any) {
        return { ok: false, workflowId: id, status: 'error', error: e?.message || 'execution failed' };
      }
    } else {
      // Fire and forget
      runStuardEngine(id, payload, engineCtx).catch((e: any) => {
        ctx.logFn(`Workflow ${id} error: ${e?.message || 'failed'}`);
      });
      return { ok: true, workflowId: id, status: 'started' };
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'invoke_workflow failed' };
  }
}

/**
 * Test run workflow steps for debugging
 */
export async function execTestRunSteps(args: any, ctx: RouterContext): Promise<any> {
  const { execTool } = await import('../index');
  
  const startTime = Date.now();
  const results: Array<{
    id: string;
    tool: string;
    status: 'success' | 'error' | 'skipped';
    duration_ms?: number;
    result?: any;
    error?: string;
  }> = [];
  
  try {
    const steps = args?.steps || [];
    const initialContext = args?.context || {};
    const stopOnError = args?.stopOnError !== false;
    
    if (!Array.isArray(steps) || steps.length === 0) {
      return { ok: false, error: 'no steps provided' };
    }
    
    // Build execution context
    let runContext: any = { ...initialContext };
    let hasError = false;
    
    for (const step of steps) {
      if (hasError && stopOnError) {
        results.push({
          id: step.id || 'unknown',
          tool: step.tool || 'unknown',
          status: 'skipped',
        });
        continue;
      }
      
      const stepStart = Date.now();
      const toolName = String(step.tool || '').trim();
      const toolArgs = step.args || {};
      
      // Interpolate context values in args
      const interpolatedArgs: any = {};
      for (const [k, v] of Object.entries(toolArgs)) {
        if (typeof v === 'string' && v.startsWith('{{') && v.endsWith('}}')) {
          const key = v.slice(2, -2).trim();
          interpolatedArgs[k] = runContext[key] ?? v;
        } else {
          interpolatedArgs[k] = v;
        }
      }
      
      try {
        ctx.logFn(`[test] Running step: ${step.id} (${toolName})`);
        const result = await execTool(
          toolName,
          { ...interpolatedArgs, __workflowToolCall: true },
          ctx,
        );
        
        results.push({
          id: step.id,
          tool: toolName,
          status: 'success',
          duration_ms: Date.now() - stepStart,
          result,
        });
        
        // Store result in context
        runContext[step.id] = result;
      } catch (e: any) {
        hasError = true;
        results.push({
          id: step.id,
          tool: toolName,
          status: 'error',
          duration_ms: Date.now() - stepStart,
          error: e?.message || 'step failed',
        });
        ctx.logFn(`[test] Step ${step.id} error: ${e?.message || 'failed'}`);
      }
    }
    
    return {
      ok: !hasError,
      steps: results,
      totalDuration_ms: Date.now() - startTime,
      finalContext: runContext,
    };
  } catch (e: any) {
    return {
      ok: false,
      steps: results,
      totalDuration_ms: Date.now() - startTime,
      error: e?.message || 'test_run_steps failed',
    };
  }
}

function extractWorkflowSchemas(model: any) {
  const triggers = Array.isArray(model?.triggers) ? model.triggers : [];
  const triggerTypes = triggers.map((t: any) => String(t?.type || '')).filter(Boolean);
  const inputSchema: any[] = [];

  for (const trigger of triggers) {
    const params = trigger?.inputParams;
    if (!Array.isArray(params)) continue;
    for (const param of params) {
      inputSchema.push({
        name: String(param?.name || ''),
        type: String(param?.type || 'string'),
        required: !!param?.required,
        defaultValue: param?.defaultValue,
        description: typeof param?.description === 'string' ? param.description : undefined,
      });
    }
  }

  const outputSchema = Array.isArray(model?.outputSchema)
    ? model.outputSchema.map((field: any) => ({
        name: String(field?.name || ''),
        type: String(field?.type || 'string'),
        description: typeof field?.description === 'string' ? field.description : undefined,
      }))
    : [];

  return { triggerTypes, inputSchema, outputSchema };
}

function workflowSearchText(item: any, model: any): string {
  const triggerTypes = Array.isArray(item?.triggers) ? item.triggers.join(' ') : '';
  const nodeTools = Array.isArray(model?.nodes)
    ? model.nodes.map((node: any) => String(node?.tool || node?.type || '')).filter(Boolean).join(' ')
    : '';
  return [
    item?.id,
    item?.name,
    item?.description,
    model?.name,
    model?.description,
    triggerTypes,
    nodeTools,
  ].map((v) => String(v || '').toLowerCase()).join(' ');
}

function scoreWorkflow(item: any, model: any, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const id = String(item?.id || '').toLowerCase();
  const name = String(item?.name || model?.name || '').toLowerCase();
  const desc = String(item?.description || model?.description || '').toLowerCase();
  const haystack = workflowSearchText(item, model);
  const tokens = q.split(/\s+/).filter(Boolean);

  let score = 0;
  if (id === q || name === q) score += 100;
  if (id.startsWith(q) || name.startsWith(q)) score += 60;
  if (id.includes(q) || name.includes(q)) score += 40;
  if (desc.includes(q)) score += 25;
  for (const token of tokens) {
    if (name.includes(token)) score += 12;
    if (desc.includes(token)) score += 8;
    if (haystack.includes(token)) score += 4;
  }
  return score;
}

/**
 * Search locally saved workflows. Empty query returns the recent workflow set.
 */
export async function execSearchLocalWorkflows(args: any, ctx: RouterContext): Promise<any> {
  try {
    const query = String(args?.query || '').trim();
    const limit = Math.max(1, Math.min(250, Number(args?.limit || 10)));
    const requestedMode = String(args?.mode || 'lexical').toLowerCase();
    const result = workflows_list();
    console.log('[execSearchLocalWorkflows] workflows_list returned:', result?.ok, 'items:', result?.items?.length);
    if (result?.ok && result?.items) {
      const workflows = result.items.map((w: any) => {
        let model: any = null;
        try {
          const read = workflows_read(w.id);
          if (read?.ok && typeof read.content === 'string') model = JSON.parse(read.content || '{}');
        } catch { /* best effort metadata only */ }
        const schemas = extractWorkflowSchemas(model);
        const triggers = schemas.triggerTypes.length > 0 ? schemas.triggerTypes : (Array.isArray(w.triggers) ? w.triggers : []);
        return {
          id: String(model?.id || w.id),
          name: String(model?.name || w.name || w.id),
          description: String(model?.description || w.description || ''),
          path: w.path,
          updatedAt: w.updatedAt,
          running: w.running,
          triggers,
          inputSchema: schemas.inputSchema,
          outputSchema: schemas.outputSchema,
          score: scoreWorkflow(w, model, query),
        };
      });

      const filtered = query
        ? workflows.filter((w: any) => Number(w.score || 0) > 0)
        : workflows;
      filtered.sort((a: any, b: any) => {
        const byScore = Number(b.score || 0) - Number(a.score || 0);
        if (byScore !== 0) return byScore;
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      });

      const limited = filtered.slice(0, limit);
      console.log('[execSearchLocalWorkflows] returning workflows:', limited.map((w: any) => w.name));
      return {
        ok: true,
        workflows: limited,
        mode: 'lexical',
        requestedMode,
      };
    }
    return { ok: false, workflows: [], error: result?.error || 'failed to search workflows' };
  } catch (e: any) {
    ctx.logFn(`search_local_workflows error: ${e?.message}`);
    return { ok: false, workflows: [], error: e?.message || 'failed' };
  }
}

/**
 * Read a saved workflow's JSON content from disk.
 */
export async function execReadLocalWorkflow(args: any, ctx: RouterContext): Promise<any> {
  try {
    const id = String(args?.workflowId || args?.id || '').trim();
    if (!id) return { ok: false, error: 'missing_workflowId' };
    const result: any = workflows_read(id);
    if (!result?.ok) return { ok: false, error: result?.error || 'read_failed' };
    const content = String(result.content || '');
    let model: any = null;
    try { model = content ? JSON.parse(content) : null; } catch { model = null; }

    // For VM deploy, the caller asks for the workspace bundle so it can ship a
    // self-contained copy (sub-workflows, scripts, assets) the VM can run.
    if (args?.includeWorkspaceBundle && model && typeof model === 'object') {
      try {
        const bundle = workflows_gatherWorkspaceBundle(id);
        if (bundle) model.__workspaceBundle = bundle;
      } catch { /* best-effort — deploy still works without bundled deps */ }
    }

    return {
      ok: true,
      id: result.id,
      content,
      model,
      isWorkspace: result.isWorkspace,
      workspacePath: result.workspacePath,
    };
  } catch (e: any) {
    ctx.logFn(`read_local_workflow error: ${e?.message}`);
    return { ok: false, error: e?.message || 'read_failed' };
  }
}

/**
 * Deploy or undeploy a saved workflow on the local desktop.
 *
 * If `definition` is provided, it is saved first (overwriting any existing
 * file). Otherwise the workflow on disk is deployed as-is. Set `undeploy:true`
 * to disable autostart and stop the runtime.
 */
export async function execDeployLocalWorkflow(args: any, ctx: RouterContext): Promise<any> {
  try {
    const workflowId = String(args?.workflowId || args?.id || '').trim();
    if (!workflowId) return { ok: false, error: 'missing_workflowId' };

    const definition = args?.definition;
    if (definition && typeof definition === 'object') {
      const content = JSON.stringify(definition, null, 2);
      const saveRes = workflows_save({ id: workflowId, content });
      if (!saveRes?.ok) return { ok: false, error: saveRes?.error || 'save_failed' };
    }

    if (args?.undeploy === true) {
      const undeployRes = workflows_undeploy(workflowId);
      return undeployRes;
    }

    const deployRes = workflows_deploy(workflowId);
    if (!deployRes?.ok) return deployRes;

    let status: any = null;
    try { status = workflows_getDeployStatus(workflowId); } catch { /* best-effort */ }

    return {
      ok: true,
      workflowId,
      deployed: deployRes.deployed ?? true,
      autostart: deployRes.autostart ?? true,
      running: status?.running ?? true,
      triggers: status?.triggers || [],
    };
  } catch (e: any) {
    ctx.logFn(`deploy_local_workflow error: ${e?.message}`);
    return { ok: false, error: e?.message || 'deploy_failed' };
  }
}

/**
 * List all locally saved stuards
 */
export async function execListLocalStuards(args: any, ctx: RouterContext): Promise<any> {
  try {
    const result = stuards_list();
    if (result?.ok && result?.items) {
      return {
        ok: true,
        stuards: result.items.map((s: any) => ({
          id: s.id,
          name: s.name,
          path: s.path,
          updatedAt: s.updatedAt,
          running: s.running,
        })),
      };
    }
    return { ok: false, stuards: [], error: result?.error || 'failed to list stuards' };
  } catch (e: any) {
    ctx.logFn(`list_local_stuards error: ${e?.message}`);
    return { ok: false, stuards: [], error: e?.message || 'failed' };
  }
}

