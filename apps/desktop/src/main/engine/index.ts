import * as fs from 'fs';
import * as path from 'path';
import { EngineContext, StuardSpec, StuardStep } from './types';
import { emitStepEvent, emitFlowEvent } from './events';
import { safeStuardId, summarizeOutput } from './utils';
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

      engineCtx.logFn(`[${current.id}] → Next: ${out.nextId}`);
      current = next;
    }
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
