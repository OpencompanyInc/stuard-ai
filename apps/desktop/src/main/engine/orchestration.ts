import { execTool } from '../tool-router';
import { EngineContext, StuardSpec, StuardStep } from './types';
import { executeStep } from './execution';
import { interpolateForTool } from './utils';

export async function execRunSequential(
  spec: StuardSpec,
  parentStep: StuardStep,
  args: any,
  ctx: any,
  engineCtx: EngineContext
): Promise<any> {
  const stepsArr = Array.isArray(args?.steps) ? args.steps : [];
  const continueOnError = !!args?.continueOnError;
  const results: any[] = [];
  let firstError: string | undefined;

  for (let i = 0; i < stepsArr.length; i++) {
    const s = stepsArr[i];
    const toolName = String(s?.tool || '').trim();
    if (!toolName) continue;

    const subStep: StuardStep = {
      id: String(s?.id || `${parentStep.id}__${i}`),
      tool: toolName,
      args: s?.args || {},
    };

    let subExec: { ok: boolean; error?: string; ctx: any };
    try {
      subExec = await executeStep(spec, subStep, ctx, engineCtx);
    } catch (e: any) {
      subExec = { ok: false, error: String(e?.message || 'failed'), ctx };
    }

    ctx = subExec.ctx || ctx;
    const subResult = ctx[subStep.id];
    const ok = !!subExec.ok;
    results.push({ tool: toolName, ok, result: subResult, error: subExec.error });

    if (!ok) {
      if (!firstError) firstError = String(subExec.error || `${toolName}_failed`);
      if (!continueOnError) break;
    }
  }

  const allOk = results.every(r => r.ok);
  return { ok: allOk || continueOnError, results, firstError };
}

export async function execRunParallel(args: any, ctx: any, engineCtx: EngineContext): Promise<any> {
  const stepsArr = Array.isArray(args?.steps) ? args.steps : [];
  const continueOnError = args?.continueOnError !== false;

  engineCtx.logFn(`run_parallel: Starting ${stepsArr.length} tasks`);

  const results = await Promise.all(stepsArr.map(async (s: any, i: number) => {
    const toolName = String(s?.tool || '').trim();
    if (!toolName) return { tool: '', ok: true, result: undefined };

    const subArgs = s?.args || {};
    let subResult: any;

    try {
      engineCtx.logFn(`run_parallel[${i}]: ${toolName}`);
      subResult = await execTool(toolName, subArgs, engineCtx);
      engineCtx.logFn(`run_parallel[${i}]: ${toolName} done, ok=${subResult?.ok}`);
    } catch (e: any) {
      engineCtx.logFn(`run_parallel[${i}]: ${toolName} error: ${e?.message}`);
      subResult = { ok: false, error: String(e?.message || 'failed') };
    }

    // custom_ui timeout/closed is not a failure
    let ok = subResult?.ok ?? true;
    if (!ok && toolName === 'custom_ui' && (subResult?.action === 'timeout' || subResult?.action === 'closed')) {
      ok = true;
    }

    return { tool: toolName, ok, result: subResult };
  }));

  const allOk = results.every(r => r.ok);

  // Combine results and make them accessible by index
  const combined: any = {};
  for (const r of results) {
    if (r.result && typeof r.result === 'object') {
      Object.assign(combined, r.result);
    }
  }

  // Also expose results by numeric index for {{stepId[0].field}} access
  const indexed: any = { ok: allOk || continueOnError, results, combined };
  for (let i = 0; i < results.length; i++) {
    indexed[i] = results[i].result || {};
  }

  engineCtx.logFn(`run_parallel result: ${JSON.stringify({ ok: indexed.ok, keys: Object.keys(indexed), '1': indexed[1] })}`);

  return indexed;
}

export async function execLoopExecutor(args: any, ctx: any, engineCtx: EngineContext): Promise<any> {
  const mode = String(args?.mode || 'each');
  const items = Array.isArray(args?.items) ? args.items : [];
  const count = Number(args?.count || 0);
  const itemVar = String(args?.item_var || 'item');
  const tool = String(args?.tool || '').trim();
  const toolArgs = args?.args || {};

  const results: any[] = [];

  if (mode === 'each') {
    for (let i = 0; i < items.length; i++) {
      ctx[itemVar] = items[i];
      ctx['index'] = i;
      const interpolatedArgs = interpolateForTool(toolArgs, ctx, tool);
      const result = await execTool(tool, interpolatedArgs, engineCtx);
      results.push(result);
    }
  } else if (mode === 'times') {
    for (let i = 0; i < count; i++) {
      ctx['index'] = i;
      const interpolatedArgs = interpolateForTool(toolArgs, ctx, tool);
      const result = await execTool(tool, interpolatedArgs, engineCtx);
      results.push(result);
    }
  }

  return { ok: true, results };
}

