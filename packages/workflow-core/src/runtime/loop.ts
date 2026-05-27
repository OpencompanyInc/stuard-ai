/**
 * Shared loop driver (forEach / repeat / while) for the workflow engines.
 *
 * Owns the iteration algorithm — item resolution, loop-context variable
 * injection, max-iteration/delay handling, break-edge resolution, result
 * accumulation. It does NOT execute steps or traverse the body graph; the host
 * injects one iteration of the body via `runChain`, plus abort/log hooks. This
 * keeps platform concerns (events, deployDir, escape-branch spawning, tool
 * transports) in each engine while loop semantics stay single-sourced.
 *
 * Semantics are canonicalized on the desktop engine, which matches the
 * designer's documented meaning of a `loopBreak` wire ("nodes after this wire
 * run outside the loop" — i.e. the post-loop CONTINUATION, not an imperative
 * break). Therefore the loop runs all its iterations and the breakEdge is only
 * the target to continue to afterwards; a mid-body loopBreak does NOT exit the
 * loop early. (This corrects the VM, which previously early-exited on it.)
 */

import type { PathResolveOptions } from './helpers';
import { interpolateForTool, evalIfGuard } from './helpers';
import type { StuardStep, StuardEdge, LoopConfig } from './types';

export interface RunChainResult {
  ok: boolean;
  error?: string;
  breakEdge?: { to: string } | StuardEdge;
}

export interface LoopHooks {
  logFn: (msg: string) => void;
  isAborted: () => boolean;
  /** Threaded into interpolation + while-condition evaluation so `$vars`
   *  resolves the same way the host engine resolves it elsewhere. */
  pathOpts?: PathResolveOptions;
  /** Execute one iteration of the loop body, starting at `bodyStep`. The host
   *  decides how to traverse / dispatch; returns ok + an optional break edge. */
  runChain: (bodyStep: StuardStep, ctx: any) => Promise<RunChainResult>;
  /** Optional: fired once after the loop completes (desktop emits a step
   *  event here; the VM omits it). */
  onComplete?: (stepId: string, iterations: number, results: any[]) => void;
}

export async function executeLoop(
  bodyStep: StuardStep,
  ctx: any,
  loop: LoopConfig,
  map: Map<string, StuardStep>,
  prevStepId: string,
  hooks: LoopHooks,
): Promise<{ breakEdge?: { to: string } }> {
  const { logFn, isAborted, pathOpts, runChain } = hooks;
  const {
    type,
    items,
    itemVar = 'item',
    indexVar = 'index',
    count,
    conditionText,
    maxIterations = 100,
    delayMs = 0,
  } = loop;

  logFn(`[${bodyStep.id}] 🔄 Starting ${type} loop (max: ${maxIterations})`);

  let iterations = 0;
  const results: any[] = [];
  let breakEdge: { to: string } | undefined;

  // A loopBreak edge on the SOURCE step is the post-loop continuation target —
  // captured up front so it's used even when zero iterations run (empty forEach).
  const sourceStep = map.get(prevStepId);
  if (sourceStep && Array.isArray(sourceStep.next)) {
    const loopBreakEdge = sourceStep.next.find((e: any) => e.loopBreak === true);
    if (loopBreakEdge) {
      breakEdge = { to: loopBreakEdge.to };
      logFn(`[${bodyStep.id}] 🔄 Found loopBreak edge → ${loopBreakEdge.to} (after loop)`);
    }
  }

  // Loop-context injection — desktop shape exactly: only `ctx.loop.*`, with the
  // item set for forEach (hasItem) and just the index for repeat/while. No
  // top-level item/index or $loop vars (the VM's extra vars are discarded so
  // both engines expose the same {{loop.item}} / {{loop.index}} surface).
  const setLoopContext = (i: number, item: any, hasItem: boolean) => {
    ctx.loop = ctx.loop || {};
    if (hasItem) {
      ctx.loop[itemVar] = item;
      ctx.loop.item = item;
    }
    ctx.loop[indexVar] = i;
    ctx.loop.index = i;
  };

  // Run one iteration; returns false on failure (caller breaks the loop).
  // NOTE (desktop semantics): a breakEdge returned by the body is recorded as
  // the post-loop continuation but does NOT terminate the loop early.
  const runIteration = async (i: number, item: any, hasItem: boolean, length: number): Promise<boolean> => {
    setLoopContext(i, item, hasItem);
    logFn(`[${bodyStep.id}] 🔄 Iteration ${i + 1}${length ? `/${length}` : ''}`);
    const chainOut = await runChain(bodyStep, ctx);
    if (!chainOut.ok) {
      logFn(`[${bodyStep.id}] 🔄 Iteration ${i + 1} failed: ${chainOut.error}`);
      return false;
    }
    if (chainOut.breakEdge && !breakEdge) {
      breakEdge = { to: (chainOut.breakEdge as any).to };
    }
    results.push(ctx[bodyStep.id]);
    return true;
  };

  if (type === 'forEach') {
    let itemsArray: any[] = [];
    if (items) {
      const resolved = interpolateForTool({ items }, ctx, 'loop', pathOpts).items;
      if (Array.isArray(resolved)) {
        itemsArray = resolved;
      } else if (typeof resolved === 'string') {
        try {
          const parsed = JSON.parse(resolved);
          itemsArray = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          itemsArray = resolved ? [resolved] : [];
        }
      } else if (resolved !== null && resolved !== undefined) {
        itemsArray = [resolved];
      }
    }

    logFn(`[${bodyStep.id}] 🔄 forEach: ${itemsArray.length} items`);
    const limit = Math.min(itemsArray.length, maxIterations);
    for (let i = 0; i < limit; i++) {
      if (isAborted()) break;
      const ok = await runIteration(i, itemsArray[i], true, itemsArray.length);
      if (!ok) break;
      iterations++;
      if (delayMs > 0 && i < limit - 1) await new Promise(r => setTimeout(r, delayMs));
    }
  } else if (type === 'repeat') {
    const repeatCount = Math.min(count || 1, maxIterations);
    logFn(`[${bodyStep.id}] 🔄 repeat: ${repeatCount} times`);
    for (let i = 0; i < repeatCount; i++) {
      if (isAborted()) break;
      const ok = await runIteration(i, null, false, repeatCount);
      if (!ok) break;
      iterations++;
      if (delayMs > 0 && i < repeatCount - 1) await new Promise(r => setTimeout(r, delayMs));
    }
  } else if (type === 'while') {
    logFn(`[${bodyStep.id}] 🔄 while loop`);
    while (iterations < maxIterations) {
      if (isAborted()) break;
      if (conditionText) {
        const expr = conditionText.trim().replace(/^\{\{/, '').replace(/\}\}$/, '').trim();
        let condResult = false;
        try {
          condResult = evalIfGuard(expr, ctx, pathOpts);
        } catch {
          const resolved = interpolateForTool({ cond: conditionText }, ctx, 'loop', pathOpts).cond;
          condResult = !!resolved && resolved !== 'false' && resolved !== '0';
        }
        if (!condResult) {
          logFn(`[${bodyStep.id}] 🔄 while condition false (${expr}), stopping`);
          break;
        }
      }
      const ok = await runIteration(iterations, null, false, 0);
      if (!ok) break;
      iterations++;
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }
  }

  // Store loop results + expose the last iteration's body output as the loop
  // step's value (so downstream {{bodyStep}} reads the final result).
  ctx[`${bodyStep.id}_loop_results`] = results;
  if (results.length > 0) ctx[bodyStep.id] = results[results.length - 1];

  delete ctx.loop;

  logFn(`[${bodyStep.id}] 🔄 Loop completed: ${iterations} iteration(s)`);
  hooks.onComplete?.(bodyStep.id, iterations, results);

  return { breakEdge };
}
