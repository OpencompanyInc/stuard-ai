import * as path from 'path';
import { app } from 'electron';
import { readWorkflowModel, designerModelToStuardSpec } from '../../workflows/workflows';
import { runStuardEngine, EngineContext } from '../../engine';
import { stuards_save } from '../../stuards';
import { RouterContext } from '../types';

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
        await runStuardEngine(id, payload, engineCtx);
        return { ok: true, workflowId: id, status: 'completed' };
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
        const result = await execTool(toolName, interpolatedArgs, ctx);
        
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
