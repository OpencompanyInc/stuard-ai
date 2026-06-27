/**
 * Shared orchestration-tool executors for the workflow engines.
 *
 * These back the `run_sequential`, `run_parallel`, and `loop_executor` tools —
 * inline "mini-runners" that execute a list/loop of sub-tools within one node.
 * They were previously duplicated per host (and the VM was missing
 * `loop_executor` entirely, plus a leaner `run_parallel` that dropped the
 * indexed/combined result shape), so a workflow using them behaved differently
 * — or broke — on the VM. Canonicalized on the desktop semantics.
 *
 * Tool execution is HOST-injected: `executeStep` (full per-step skeleton, used
 * by run_sequential so sub-steps get interpolation + edge handling) and
 * `execTool` (direct tool call, used by the parallel/loop fan-outs). The VM
 * additionally supplies `normalizeKind` so sub-steps keep their VM routing kind.
 */

import type { PathResolveOptions } from './helpers';
import { interpolateForTool } from './helpers';
import type { StuardSpec, StuardStep, StuardStepKind } from './types';
import type { ExecuteStepResult } from './step';

export interface OrchestrationHooks {
  logFn: (msg: string) => void;
  /** Threaded into loop_executor arg interpolation so `$vars` resolves per host. */
  pathOpts?: PathResolveOptions;
  /** Full per-step executor (interpolation + dispatch + edges). */
  executeStep: (spec: StuardSpec, step: StuardStep, ctx: any) => Promise<ExecuteStepResult>;
  /** Direct tool dispatch. `kind` is the (optionally normalized) routing kind. */
  execTool: (toolName: string, args: any, kind?: StuardStepKind) => Promise<any>;
  /** VM routing-kind normalizer; desktop omits it (routes by tool name). */
  normalizeKind?: (raw: any) => StuardStepKind | undefined;
}

/** run_sequential: execute sub-steps in order, short-circuiting on first error
 *  unless continueOnError. Each sub-step runs through the full executeStep. */
export async function execRunSequential(
  spec: StuardSpec,
  parentStep: StuardStep,
  args: any,
  ctx: any,
  hooks: OrchestrationHooks,
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
      ...(hooks.normalizeKind ? { kind: hooks.normalizeKind(s?.kind) } : {}),
    };

    let subExec: ExecuteStepResult;
    try {
      subExec = await hooks.executeStep(spec, subStep, ctx);
    } catch (e: any) {
      subExec = { ok: false, error: String(e?.message || 'failed'), ctx, edges: [] };
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

/** run_parallel: execute sub-tools concurrently. Exposes results three ways —
 *  by `.results`, merged into `.combined`, and indexed (`[0]`, `[1]`, …) so
 *  `{{step[0].field}}` works. continueOnError defaults true (independent tasks). */
export async function execRunParallel(
  flowId: string,
  args: any,
  ctx: any,
  hooks: OrchestrationHooks,
): Promise<any> {
  const stepsArr = Array.isArray(args?.steps) ? args.steps : [];
  const continueOnError = args?.continueOnError !== false;

  hooks.logFn(`run_parallel: Starting ${stepsArr.length} tasks`);

  const results = await Promise.all(stepsArr.map(async (s: any, i: number) => {
    const toolName = String(s?.tool || '').trim();
    if (!toolName) return { tool: '', ok: true, result: undefined };

    const subArgs = { ...(s?.args || {}), flowId, __workflowToolCall: true };
    let subResult: any;

    try {
      hooks.logFn(`run_parallel[${i}]: ${toolName}`);
      subResult = await hooks.execTool(toolName, subArgs, hooks.normalizeKind?.(s?.kind));
      hooks.logFn(`run_parallel[${i}]: ${toolName} done, ok=${subResult?.ok}`);
    } catch (e: any) {
      hooks.logFn(`run_parallel[${i}]: ${toolName} error: ${e?.message}`);
      subResult = { ok: false, error: String(e?.message || 'failed') };
    }

    // custom_ui timeout/closed is not a failure for blocking UIs.
    let ok = subResult?.ok ?? true;
    if (!ok && toolName === 'custom_ui' && (subResult?.action === 'timeout' || subResult?.action === 'closed')) {
      ok = true;
    }

    return { tool: toolName, ok, result: subResult };
  }));

  const allOk = results.every(r => r.ok);

  // Merge object results, and expose by numeric index for {{stepId[0].field}}.
  const combined: any = {};
  for (const r of results) {
    if (r.result && typeof r.result === 'object') Object.assign(combined, r.result);
  }
  const indexed: any = { ok: allOk || continueOnError, results, combined };
  for (let i = 0; i < results.length; i++) indexed[i] = results[i].result || {};

  return indexed;
}

/** loop_executor: run one sub-tool repeatedly over `items` (each) or `count`
 *  (times), injecting the item/index into ctx for arg interpolation. */
export async function execLoopExecutor(
  flowId: string,
  args: any,
  ctx: any,
  hooks: OrchestrationHooks,
): Promise<any> {
  const mode = String(args?.mode || 'each');
  const items = Array.isArray(args?.items) ? args.items : [];
  const count = Number(args?.count || 0);
  const itemVar = String(args?.item_var || 'item');
  const tool = String(args?.tool || '').trim();
  const toolArgs = args?.args || {};
  const kind = hooks.normalizeKind?.(args?.kind);

  const results: any[] = [];

  const runOnce = async (i: number) => {
    ctx['index'] = i;
    const interpolatedArgs = { ...interpolateForTool(toolArgs, ctx, tool, hooks.pathOpts), flowId, __workflowToolCall: true };
    results.push(await hooks.execTool(tool, interpolatedArgs, kind));
  };

  if (mode === 'each') {
    for (let i = 0; i < items.length; i++) {
      ctx[itemVar] = items[i];
      await runOnce(i);
    }
  } else if (mode === 'times') {
    for (let i = 0; i < count; i++) {
      await runOnce(i);
    }
  }

  return { ok: true, results };
}
