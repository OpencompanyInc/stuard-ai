import * as fs from 'fs';
import * as path from 'path';
import { EngineContext, StuardSpec, StuardStep, LoopConfig } from './types';
import { emitStepEvent, emitFlowEvent } from './events';
import { safeStuardId, summarizeOutput, interpolateForTool, getAtPath } from './utils';
import { getVariable } from '../tool-router';
import { executeStep } from './execution';

export * from './types';
export * from './events';

const activeRunControllers = new Map<string, Set<AbortController>>();

// Convergence tracking for waitForAll nodes
interface ConvergenceState {
  pendingBranches: Map<string, Set<string>>; // stepId -> set of pending source branch IDs
  completedBranches: Map<string, Map<string, any>>; // stepId -> map of (branchId -> result)
  resolvers: Map<string, () => void>; // stepId -> resolver function for waiting
}

function getRunSet(flowId: string): Set<AbortController> {
  const safe = safeStuardId(flowId);
  let set = activeRunControllers.get(safe);
  if (!set) {
    set = new Set<AbortController>();
    activeRunControllers.set(safe, set);
  }
  return set;
}

export function isStuardEngineRunning(flowId: string): boolean {
  try {
    const safe = safeStuardId(flowId);
    const set = activeRunControllers.get(safe);
    return !!set && set.size > 0;
  } catch {
    return false;
  }
}

export function stopStuardEngineRuns(flowId: string): { ok: boolean; stopped?: number; error?: string } {
  try {
    const safe = safeStuardId(flowId);
    const set = activeRunControllers.get(safe);
    if (!set || set.size === 0) return { ok: false, error: 'not_running' };
    const controllers = Array.from(set.values());
    for (const c of controllers) {
      try { c.abort(); } catch { }
    }
    return { ok: true, stopped: controllers.length };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

function pickStartStep(spec: StuardSpec): StuardStep | null {
  const steps = Array.isArray(spec.steps) ? spec.steps : [];
  if (!steps.length) return null;
  if (spec.start) return steps.find(s => s.id === spec.start) || steps[0];
  return steps[0];
}

export function getStuardPathById(id: string, dir: string) {
  return path.join(dir, `${id}.json`);
}

export async function runStuardEngine(id: string, payload: any, engineCtx: EngineContext) {
  const safe = safeStuardId(id);
  const p = getStuardPathById(safe, engineCtx.stuardsDir);

  if (!fs.existsSync(p)) throw new Error('not_found');

  const spec: StuardSpec = JSON.parse(fs.readFileSync(p, 'utf-8'));
  engineCtx.logFn('Run started');

  const controller = new AbortController();
  const runSet = getRunSet(safe);
  runSet.add(controller);

  const steps = Array.isArray(spec.steps) ? spec.steps : [];
  const map = new Map<string, StuardStep>();
  for (const s of steps) map.set(s.id, s);

  let current = pickStartStep(spec);
  const ctx: any = {};
  let hasReturn = false;
  let returnValue: any = undefined;

  const varsProxy: any = new Proxy({}, {
    get(_t, prop: any) {
      if (typeof prop !== 'string') return undefined;
      const direct = getVariable(prop, undefined);
      if (direct !== undefined) return direct;
      const wf = getVariable(`workflow.${prop}`, undefined);
      return wf;
    },
  });

  const workflowProxy: any = new Proxy({}, {
    get(_t, prop: any) {
      if (typeof prop !== 'string') return undefined;
      return getVariable(`workflow.${prop}`, undefined);
    },
  });

  // Make workflow variables accessible in both styles:
  // - workflow.foo
  // - $vars.foo (auto-falls back to workflow.foo)
  ctx.workflow = workflowProxy;
  ctx.$vars = varsProxy;

  // Initialize payload
  if (payload !== undefined) {
    try {
      if (payload && typeof payload === 'object' && ('input' in payload || 'webhook' in payload)) {
        if (payload.input !== undefined) ctx.input = payload.input;
        if (payload.webhook !== undefined) ctx.webhook = payload.webhook;
        if (payload.args !== undefined) ctx.args = payload.args;
      } else {
        ctx.input = payload;
        ctx.webhook = payload;
      }
    } catch { }
  }

  // Build incoming edges map for convergence detection
  const incomingEdges = new Map<string, string[]>();
  for (const step of steps) {
    for (const edge of step.next || []) {
      if (edge.to) {
        const existing = incomingEdges.get(edge.to) || [];
        existing.push(step.id);
        incomingEdges.set(edge.to, existing);
      }
    }
  }

  // Convergence state for waitForAll nodes
  const convergence: ConvergenceState = {
    pendingBranches: new Map(),
    completedBranches: new Map(),
    resolvers: new Map(),
  };

  // Initialize convergence tracking for waitForAll nodes
  for (const step of steps) {
    if (step.waitForAll) {
      const sources = incomingEdges.get(step.id) || [];
      if (sources.length > 1) {
        convergence.pendingBranches.set(step.id, new Set(sources));
        convergence.completedBranches.set(step.id, new Map());
        engineCtx.logFn(`[${step.id}] WaitForAll: expecting ${sources.length} branches: ${sources.join(', ')}`);
      }
    }
  }

  // Emit flow started
  emitFlowEvent(safe, true);

  // Helper to check and handle convergence for a step
  async function handleConvergence(stepId: string, branchSourceId: string, branchCtx: any): Promise<boolean> {
    const step = map.get(stepId);
    if (!step?.waitForAll) return true; // Not a waitForAll node, proceed immediately

    const pending = convergence.pendingBranches.get(stepId);
    const completed = convergence.completedBranches.get(stepId);

    if (!pending || !completed) return true; // No convergence tracking, proceed

    // Mark this branch as completed
    pending.delete(branchSourceId);
    completed.set(branchSourceId, { ...branchCtx });

    engineCtx.logFn(`[${stepId}] WaitForAll: branch '${branchSourceId}' arrived (${pending.size} remaining)`);

    // Check if all branches have arrived
    if (pending.size === 0) {
      engineCtx.logFn(`[${stepId}] WaitForAll: all branches arrived, proceeding`);

      // Merge all branch contexts
      for (const [, branchResult] of completed) {
        Object.assign(branchCtx, branchResult);
      }

      // Wake up any waiting resolver
      const resolver = convergence.resolvers.get(stepId);
      if (resolver) {
        resolver();
        convergence.resolvers.delete(stepId);
      }

      return true; // Proceed with execution
    }

    return false; // Still waiting for other branches
  }

  // Helper to run a single branch from a starting step
  async function runBranch(startStep: StuardStep, branchCtx: any, prevId?: string): Promise<void> {
    let current: StuardStep | undefined = startStep;
    let prevStepId = prevId;
    let guard = 0;

    while (current && guard < 500) {
      guard++;

      if (controller.signal.aborted) break;

      // Check convergence for waitForAll nodes
      if (current.waitForAll && prevStepId) {
        const shouldProceed = await handleConvergence(current.id, prevStepId, branchCtx);
        if (!shouldProceed) {
          engineCtx.logFn(`[${current.id}] WaitForAll: branch '${prevStepId}' waiting for others`);
          // This branch is done - it merged its context into the convergence point
          // Another branch (the last one) will continue from here
          return;
        }
      }

      const stepTool = current.tool || 'unknown';
      engineCtx.logFn(`[${current.id}] Starting (tool: ${stepTool})`);

      emitStepEvent(safe, current.id, 'running', { wireFromId: prevStepId });

      const startTime = Date.now();
      const out = await executeStep(spec, current, branchCtx, engineCtx);
      const duration = Date.now() - startTime;

      if (controller.signal.aborted) break;

      if (!out.ok) {
        emitStepEvent(safe, current.id, 'error', { error: out.error });
        engineCtx.logFn(`[${current.id}] ❌ Failed (${duration}ms): ${out.error || 'unknown error'}`);
        break;
      }

      const outputSummary = summarizeOutput(out.ctx?.[current.id]);
      engineCtx.logFn(`[${current.id}] ✓ Completed (${duration}ms)${outputSummary ? ': ' + outputSummary : ''}`);
      emitStepEvent(safe, current.id, 'completed', { result: out.ctx?.[current.id] });
      prevStepId = current.id;

      if (out.ctx && (out.ctx as any).__terminated) {
        if ((out.ctx as any).__return !== undefined && !hasReturn) {
          hasReturn = true;
          returnValue = (out.ctx as any).__return;
        }
        try { controller.abort(); } catch { }
        break;
      }

      // Handle parallel branches (multiple nextIds)
      if (out.nextIds && out.nextIds.length > 1) {
        engineCtx.logFn(`[${current.id}] ⚡ Executing ${out.nextIds.length} parallel branches`);
        const parallelSteps = out.nextIds.map(id => map.get(id)).filter(Boolean) as StuardStep[];

        // Run all parallel branches concurrently
        await Promise.all(parallelSteps.map(step =>
          runBranch(step, { ...branchCtx }, current!.id)
        ));
        break; // All branches handled
      }

      // Single next step
      if (!out.nextId) {
        engineCtx.logFn(`[${current.id}] End of flow (no next step)`);
        break;
      }

      const next = map.get(out.nextId);
      if (!next) {
        engineCtx.logFn(`Next step not found: ${out.nextId}`);
        break;
      }

      // Handle loop execution if edge has loop configuration
      if ((out as any).loop && (out as any).loop.type) {
        const loopResult = await executeLoop(spec, next, branchCtx, (out as any).loop, engineCtx, map, current.id);
        
        // After loop completes, continue to the break edge target (or end)
        if (loopResult.breakEdge && loopResult.breakEdge.to) {
          engineCtx.logFn(`[${next.id}] 🔄 Loop done → continuing to: ${loopResult.breakEdge.to}`);
          current = map.get(loopResult.breakEdge.to);
        } else {
          engineCtx.logFn(`[${next.id}] 🔄 Loop done → end of flow`);
          current = undefined;
        }
        if (!current) break;
        continue;
      }

      engineCtx.logFn(`[${current.id}] → Next: ${out.nextId}`);
      current = next;
    }
  }

  // Execute a chain of steps within a loop iteration, stopping at loopBreak edge or loop back edge
  async function executeLoopChain(
    spec: StuardSpec,
    startStep: StuardStep,
    ctx: any,
    engineCtx: EngineContext,
    map: Map<string, StuardStep>,
    loopStartStepId?: string
  ): Promise<{ ok: boolean; error?: string; breakEdge?: { to: string } }> {
    let current: StuardStep | undefined = startStep;
    const visitedInIteration = new Set<string>();
    
    while (current) {
      if (controller.signal.aborted) return { ok: false, error: 'aborted' };
      
      // Prevent infinite loops within a single iteration
      if (visitedInIteration.has(current.id)) {
        engineCtx.logFn(`[${current.id}] 🔄 Iteration complete (back to start)`);
        return { ok: true };
      }
      visitedInIteration.add(current.id);
      
      // Execute current step - this calls decideNext which properly evaluates guards
      const out = await executeStep(spec, current, ctx, engineCtx);
      if (!out.ok) {
        return { ok: false, error: out.error };
      }
      
      // Use the result from executeStep (which uses decideNext) for consistent edge selection
      // No next step - end of loop chain
      if (!out.nextId) {
        return { ok: true };
      }
      
      // Check if this edge is a loopBreak (from decideNext result)
      if ((out as any).loopBreak) {
        engineCtx.logFn(`[${current.id}] 🔄 Hit loop break → ${out.nextId}`);
        return { ok: true, breakEdge: { to: out.nextId } };
      }
      
      // Check if this edge has a loop config - indicates end of loop body for this iteration
      // The loop config on the edge means "this is a loop-back edge", not "start a new loop"
      if ((out as any).loop && (out as any).loop.type) {
        engineCtx.logFn(`[${current.id}] 🔄 End of loop body (loop edge detected)`);
        return { ok: true };
      }
      
      // Check if we're going back to the loop start (self-loop or cycle)
      if (loopStartStepId && out.nextId === loopStartStepId) {
        engineCtx.logFn(`[${current.id}] 🔄 End of iteration (back to loop start)`);
        return { ok: true };
      }
      
      // Continue to next step in chain
      const nextStep = map.get(out.nextId);
      if (!nextStep) {
        return { ok: true };
      }
      
      engineCtx.logFn(`[${current.id}] 🔄 → ${nextStep.id} (in loop)`);
      current = nextStep;
    }
    
    return { ok: true };
  }

  // Execute a loop on a step
  async function executeLoop(
    spec: StuardSpec,
    step: StuardStep,
    ctx: any,
    loop: LoopConfig,
    engineCtx: EngineContext,
    map: Map<string, StuardStep>,
    prevStepId: string
  ): Promise<{ breakEdge?: { to: string } }> {
    const { type, items, itemVar = 'item', indexVar = 'index', count, conditionText, maxIterations = 100, delayMs = 0 } = loop;
    
    engineCtx.logFn(`[${step.id}] 🔄 Starting ${type} loop (max: ${maxIterations})`);
    
    let iterations = 0;
    const results: any[] = [];
    let breakEdge: { to: string } | undefined;
    
    // Initialize loop context
    ctx.loop = ctx.loop || {};
    
    if (type === 'forEach') {
      // Resolve items - could be a template like {{step.result}}
      let itemsArray: any[] = [];
      if (items) {
        const resolved = interpolateForTool({ items }, ctx, 'loop');
        const resolvedItems = resolved.items;
        
        if (Array.isArray(resolvedItems)) {
          itemsArray = resolvedItems;
        } else if (typeof resolvedItems === 'string') {
          // Try to parse as JSON array
          try {
            const parsed = JSON.parse(resolvedItems);
            itemsArray = Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            itemsArray = [resolvedItems];
          }
        } else if (resolvedItems !== null && resolvedItems !== undefined) {
          itemsArray = [resolvedItems];
        }
      }
      
      engineCtx.logFn(`[${step.id}] 🔄 forEach: ${itemsArray.length} items`);
      
      for (let i = 0; i < Math.min(itemsArray.length, maxIterations); i++) {
        if (controller.signal.aborted) break;
        
        // Set loop context variables
        ctx.loop[itemVar] = itemsArray[i];
        ctx.loop[indexVar] = i;
        ctx.loop.item = itemsArray[i]; // Always set as 'item' too for convenience
        ctx.loop.index = i;
        
        engineCtx.logFn(`[${step.id}] 🔄 Iteration ${i + 1}/${itemsArray.length}`);
        
        // Execute chain of steps until loopBreak or back to start
        const chainOut = await executeLoopChain(spec, step, ctx, engineCtx, map, step.id);
        
        if (!chainOut.ok) {
          engineCtx.logFn(`[${step.id}] 🔄 Iteration ${i + 1} failed: ${chainOut.error}`);
          break;
        }
        
        // Capture breakEdge from first iteration (all should be same)
        if (chainOut.breakEdge && !breakEdge) {
          breakEdge = chainOut.breakEdge;
        }
        
        results.push(ctx[step.id]);
        engineCtx.logFn(`[${step.id}] 🔄 Iteration ${i + 1} completed`);
        
        if (delayMs > 0 && i < itemsArray.length - 1) {
          await new Promise(r => setTimeout(r, delayMs));
        }
        
        iterations++;
      }
    } else if (type === 'repeat') {
      const repeatCount = Math.min(count || 1, maxIterations);
      engineCtx.logFn(`[${step.id}] 🔄 repeat: ${repeatCount} times`);
      
      for (let i = 0; i < repeatCount; i++) {
        if (controller.signal.aborted) break;
        
        ctx.loop[indexVar] = i;
        ctx.loop.index = i;
        
        engineCtx.logFn(`[${step.id}] 🔄 Iteration ${i + 1}/${repeatCount}`);
        
        const chainOut = await executeLoopChain(spec, step, ctx, engineCtx, map, step.id);
        
        if (!chainOut.ok) {
          engineCtx.logFn(`[${step.id}] 🔄 Iteration ${i + 1} failed: ${chainOut.error}`);
          break;
        }
        
        if (chainOut.breakEdge && !breakEdge) {
          breakEdge = chainOut.breakEdge;
        }
        
        results.push(ctx[step.id]);
        engineCtx.logFn(`[${step.id}] 🔄 Iteration ${i + 1} completed`);
        
        if (delayMs > 0 && i < repeatCount - 1) {
          await new Promise(r => setTimeout(r, delayMs));
        }
        
        iterations++;
      }
    } else if (type === 'while') {
      engineCtx.logFn(`[${step.id}] 🔄 while loop`);
      
      while (iterations < maxIterations) {
        if (controller.signal.aborted) break;
        
        // Check condition
        if (conditionText) {
          const resolved = interpolateForTool({ cond: conditionText }, ctx, 'loop');
          const condValue = resolved.cond;
          // Evaluate condition - simple truthy check
          if (!condValue || condValue === 'false' || condValue === '0') {
            engineCtx.logFn(`[${step.id}] 🔄 while condition false, stopping`);
            break;
          }
        }
        
        ctx.loop[indexVar] = iterations;
        ctx.loop.index = iterations;
        
        engineCtx.logFn(`[${step.id}] 🔄 Iteration ${iterations + 1}`);
        
        const chainOut = await executeLoopChain(spec, step, ctx, engineCtx, map, step.id);
        
        if (!chainOut.ok) {
          engineCtx.logFn(`[${step.id}] 🔄 Iteration ${iterations + 1} failed: ${chainOut.error}`);
          break;
        }
        
        if (chainOut.breakEdge && !breakEdge) {
          breakEdge = chainOut.breakEdge;
        }
        
        results.push(ctx[step.id]);
        engineCtx.logFn(`[${step.id}] 🔄 Iteration ${iterations + 1} completed`);
        
        if (delayMs > 0) {
          await new Promise(r => setTimeout(r, delayMs));
        }
        
        iterations++;
      }
    }
    
    // Store loop results
    ctx[`${step.id}_loop_results`] = results;
    ctx[step.id] = results.length > 0 ? results[results.length - 1] : ctx[step.id];
    
    // Clear loop context after loop completes
    delete ctx.loop;
    
    engineCtx.logFn(`[${step.id}] 🔄 Loop completed: ${iterations} iterations`);
    emitStepEvent(spec.id, step.id, 'completed', { result: { iterations, results } } as any);
    
    return { breakEdge };
  }

  try {
    // Start the main branch
    await runBranch(current!, ctx, undefined);
    return hasReturn ? { ok: true, returnValue } : { ok: true };
  } finally {
    try {
      const set = activeRunControllers.get(safe);
      if (set) {
        set.delete(controller);
        if (set.size === 0) activeRunControllers.delete(safe);
      }
    } catch { }

    // Emit flow completed
    emitFlowEvent(safe, false);
    engineCtx.logFn(controller.signal.aborted ? 'Run aborted' : 'Run completed');
  }
}
