/**
 * Shared per-step executor skeleton for the workflow engines.
 *
 * Owns the platform-agnostic part of running one step: interpolate args (with
 * AI arg-patches), dispatch the tool (HOST-specific — injected), store the
 * result, apply terminate/return handling, then pick the next edges via the
 * shared decideNext and derive the legacy nextId/loop fields the desktop loop
 * chain consumes.
 *
 * The host injects `dispatchTool`, which owns ALL tool routing — orchestration
 * tools, call_function/custom_ui (desktop), execTool with deployDir/kind (VM),
 * and noop. That keeps every platform difference behind one hook while the step
 * lifecycle stays single-sourced.
 *
 * Terminate semantics are canonicalized on the desktop engine: `return_value`
 * (or a result with action:'return') records ctx.__return but does NOT set
 * ctx.__terminated; only a result with `terminated` (or the `end` tool) sets it
 * and ends the branch. (This corrects the VM, which previously set __terminated
 * on return_value.)
 */

import type { PathResolveOptions } from './helpers';
import { interpolateForTool, deepMerge } from './helpers';
import { decideNext, type AiRouteResult } from './decide';
import type { StuardSpec, StuardStep, StuardEdge, LoopConfig, StreamWireConfig } from './types';

export interface ExecuteStepResult {
  edges: StuardEdge[];
  ctx: any;
  ok: boolean;
  error?: string;
  // Legacy fields derived from edges — consumed by the desktop loop chain.
  nextId?: string;
  nextIds?: string[];
  loop?: LoopConfig;
  loopBreak?: boolean;
  stream?: StreamWireConfig;
}

export interface ExecuteStepHooks {
  logFn: (msg: string) => void;
  pathOpts?: PathResolveOptions;
  aiDecideNext: (
    spec: StuardSpec,
    step: StuardStep,
    ctx: any,
    options: Array<{ to: string; label?: string }>,
    aiCfg: any,
  ) => Promise<AiRouteResult>;
  /** Route + execute the tool. Receives interpolated args. Owns orchestration,
   *  call_function/custom_ui, execTool(+deployDir/kind), and noop. */
  dispatchTool: (
    spec: StuardSpec,
    step: StuardStep,
    mergedArgs: any,
    ctx: any,
    toolName: string,
  ) => Promise<any>;
}

export async function executeStep(
  spec: StuardSpec,
  step: StuardStep,
  ctx: any,
  hooks: ExecuteStepHooks,
): Promise<ExecuteStepResult> {
  try {
    const toolName = step.tool || 'noop';
    const patchForThis = ctx?.__argsPatch?.[step.id];
    const mergedArgs = interpolateForTool(
      deepMerge(step.args || {}, patchForThis || {}),
      ctx,
      toolName,
      hooks.pathOpts,
    );

    const result = await hooks.dispatchTool(spec, step, mergedArgs, ctx, toolName);

    // Store result in context
    ctx[step.id] = result;

    // Capture structured return values (does NOT terminate — desktop semantics).
    if (toolName === 'return_value' || result?.action === 'return') {
      (ctx as any).__return =
        result && typeof result === 'object' && 'value' in result ? result.value : result;
    }

    // Only an explicit `terminated` result (or the `end` tool) stops the branch.
    if (result?.terminated) {
      (ctx as any).__terminated = true;
    }
    if (toolName === 'end' || result?.terminated) {
      return { ok: true, ctx, edges: [] };
    }

    // Check for failure — custom_ui timeout/closed is not a failure for blocking UIs.
    if (!result?.ok) {
      const isBlockingUiNonError =
        toolName === 'custom_ui' && (result?.action === 'timeout' || result?.action === 'closed');
      if (!isBlockingUiNonError) {
        return { ok: false, error: String(result?.error || `${toolName}_failed`), ctx, edges: [] };
      }
    }

    // Decide next edges (shared)
    const decideResult = await decideNext(spec, step, ctx, {
      logFn: hooks.logFn,
      pathOpts: hooks.pathOpts,
      aiDecideNext: hooks.aiDecideNext,
    });

    // Derive legacy fields from edges for backward compat (desktop loop chain).
    const flowEdges = decideResult.edges.filter(e => !e.stream);
    const streamEdges = decideResult.edges.filter(e => e.stream);

    let nextId: string | undefined;
    let nextIds: string[] | undefined;
    let loop: LoopConfig | undefined;
    let loopBreak: boolean | undefined;
    let stream: StreamWireConfig | undefined;

    if (flowEdges.length === 1) {
      const edge = flowEdges[0];
      nextId = edge.to;
      loop = edge.loop;
      loopBreak = edge.loopBreak;
    } else if (flowEdges.length > 1) {
      const loopEdge = flowEdges.find(e => e.loop?.type);
      if (loopEdge) {
        nextId = loopEdge.to;
        loop = loopEdge.loop;
      } else {
        nextIds = flowEdges.map(e => e.to);
      }
    }

    if (streamEdges.length > 0) {
      stream = streamEdges[0].stream;
      if (!nextId && !nextIds) nextId = streamEdges[0].to;
    }

    return { ...decideResult, nextId, nextIds, loop, loopBreak, stream };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'step_failed'), ctx, edges: [] };
  }
}
