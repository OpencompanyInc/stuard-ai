/**
 * Shared call_function executor for the workflow engines.
 *
 * Runs a workflow subgraph starting from a trigger (the call_function tool, used
 * by workflows-as-functions and by builder test harness nodes). Owns:
 *   - start-step resolution (trigger.start / startNodes / spec.edges / step refs)
 *   - the function-scoped context (inputs → args/input/trigger.data)
 *   - parallel sub-branch fan-out, and
 *   - waitForAll CONVERGENCE so a join node fed by N branches runs once, not N
 *     times. (Without this a render→open chain fires once per incoming wire.)
 *
 * Step execution + event emission are HOST-injected: the desktop and VM engines
 * differ in tool transports (deployDir/kind) and event channels (BrowserWindow
 * broadcast vs the VM's `emit('step')`). This keeps call_function semantics
 * single-sourced so a workflow behaves identically wherever it runs.
 */

import type { StuardSpec, StuardStep } from './types';
import type { ExecuteStepResult } from './step';

export interface FunctionCallHooks {
  logFn: (msg: string) => void;
  /** Run one step with the host's tool dispatch; returns edges + ok/error. */
  executeStep: (spec: StuardSpec, step: StuardStep, ctx: any) => Promise<ExecuteStepResult>;
  /** Optional step lifecycle event (desktop → emitStepEvent, VM omits — its
   *  deploy UI polls separately). Best-effort UI only; never affects control. */
  emitStep?: (
    stepId: string,
    status: 'running' | 'completed' | 'error',
    opts?: { error?: string; result?: any },
  ) => void;
  /** Optional cooperative abort check. */
  isAborted?: () => boolean;
}

export async function executeFromTrigger(
  spec: StuardSpec,
  triggerId: string,
  inputs: Record<string, any>,
  parentCtx: any,
  hooks: FunctionCallHooks,
): Promise<{ ok: boolean; result?: any; error?: string }> {
  const { logFn, executeStep, isAborted } = hooks;
  const emitStep = hooks.emitStep || (() => { });

  try {
    // Find the trigger in the spec
    const trigger = spec.triggers?.find((t: any) => t.id === triggerId);
    if (!trigger) {
      return { ok: false, error: `trigger_not_found: ${triggerId}` };
    }

    const triggerAny = trigger as any;
    if (triggerAny.type !== 'function') {
      logFn(`Warning: Trigger ${triggerId} is not a 'function' trigger (type: ${triggerAny.type})`);
    }

    // Resolve ALL start step IDs from this trigger (supports parallel branches).
    const steps = Array.isArray(spec.steps) ? spec.steps : [];
    const specAny = spec as any;
    let startStepIds: string[] = [];

    // Method 1: trigger.startNodes (array) or trigger.start (single)
    if (Array.isArray(triggerAny.startNodes) && triggerAny.startNodes.length > 0) {
      startStepIds = [...triggerAny.startNodes];
    } else if (triggerAny.start) {
      startStepIds = [triggerAny.start];
    }

    // Method 2: spec.edges array
    if (startStepIds.length === 0 && Array.isArray(specAny.edges)) {
      startStepIds = specAny.edges
        .filter((e: any) => e.from === triggerId)
        .map((e: any) => String(e.to))
        .filter(Boolean);
    }

    // Method 3: step.next edges that reference this trigger as source
    if (startStepIds.length === 0) {
      for (const step of steps) {
        for (const edge of (Array.isArray(step.next) ? step.next : [])) {
          const edgeAny = edge as any;
          if (edgeAny.from === triggerId && (edgeAny.to || edge.to)) {
            startStepIds.push(String(edgeAny.to || edge.to));
          }
        }
      }
    }

    // Method 4: a step naming this trigger as its source
    if (startStepIds.length === 0) {
      for (const step of steps) {
        const stepAny = step as any;
        if (stepAny.triggerId === triggerId || stepAny.trigger === triggerId) {
          startStepIds.push(step.id);
        }
      }
    }

    startStepIds = [...new Set(startStepIds)];
    if (startStepIds.length === 0) {
      return { ok: false, error: `no_start_step_for_trigger: ${triggerId}` };
    }

    const map = new Map<string, StuardStep>();
    for (const s of steps) map.set(s.id, s);

    const validStartSteps = startStepIds.map(id => map.get(id)).filter(Boolean) as StuardStep[];
    if (validStartSteps.length === 0) {
      return { ok: false, error: `start_steps_not_found: ${startStepIds.join(', ')}` };
    }

    // Convergence tracking for waitForAll join nodes — mirrors the main engine
    // (runBranch). Seed a pending set with every incoming source; each branch
    // deletes itself on arrival and the last one to arrive runs the node once.
    const incomingEdges = new Map<string, string[]>();
    for (const step of steps) {
      for (const edge of step.next || []) {
        if (edge.to) {
          const arr = incomingEdges.get(edge.to) || [];
          arr.push(step.id);
          incomingEdges.set(edge.to, arr);
        }
      }
    }
    const convergencePending = new Map<string, Set<string>>();
    for (const step of steps) {
      if (step.waitForAll) {
        const sources = incomingEdges.get(step.id) || [];
        if (sources.length > 1) convergencePending.set(step.id, new Set(sources));
      }
    }

    // Build function context with inputs. Inherit from parent but isolate scope.
    const functionCtx: any = {
      ...parentCtx,
      args: inputs,
      input: inputs,
      __return: undefined,
      __terminated: false,
    };

    // Map declared input params for {{args.NAME}} dotted lookups.
    if (Array.isArray(triggerAny.inputParams)) {
      for (const param of triggerAny.inputParams) {
        const paramName = param?.name;
        if (paramName && inputs[paramName] !== undefined) {
          functionCtx[`args.${paramName}`] = inputs[paramName];
        }
      }
    }

    // Ensure trigger context is available for templates ({{trigger.data.X}}).
    functionCtx.trigger = { data: inputs || {} };

    logFn(`📞 Calling function trigger: ${triggerId} (${validStartSteps.length} branch${validStartSteps.length > 1 ? 'es' : ''})`);

    // Run a single chain from a start step. `prevStepId` is the node that routed
    // into `startStep` (undefined for a branch root) and drives convergence.
    async function runChain(startStep: StuardStep, ctx: any, prevStepId?: string): Promise<{ ok: boolean; error?: string }> {
      let currentStep: StuardStep | undefined = startStep;
      let iterationCount = 0;
      const maxIterations = 1000;

      while (currentStep && iterationCount < maxIterations) {
        iterationCount++;

        if (isAborted?.()) break;
        if (ctx.__terminated) break;

        // Convergence gate: a waitForAll node runs only after every incoming
        // branch has arrived. Non-final branches return here; the last one to
        // arrive falls through and executes the node exactly once. Sub-branches
        // share `ctx`, so every upstream result is already present by then.
        if (currentStep.waitForAll && prevStepId) {
          const pending = convergencePending.get(currentStep.id);
          if (pending) {
            pending.delete(prevStepId);
            logFn(`[fn-chain] ${currentStep.id} waitForAll: '${prevStepId}' arrived (${pending.size} remaining)`);
            if (pending.size > 0) return { ok: true };
          }
        }

        emitStep(currentStep.id, 'running');

        const stepResult = await executeStep(spec, currentStep, ctx);

        if (!stepResult.ok) {
          logFn(`[fn-chain] ${currentStep.id} (${currentStep.tool}) FAILED: ${stepResult.error}`);
          emitStep(currentStep.id, 'error', { error: stepResult.error });
          return { ok: false, error: stepResult.error || 'function_step_failed' };
        }

        emitStep(currentStep.id, 'completed', { result: ctx[currentStep.id] });

        if (ctx.__terminated || ctx.__return !== undefined) break;

        // Edge-based routing from executeStep results.
        const flowEdges = (stepResult.edges || []).filter(e => !e.stream);

        if (flowEdges.length === 0) {
          break; // End of chain
        } else if (flowEdges.length === 1) {
          prevStepId = currentStep.id;
          currentStep = map.get(flowEdges[0].to);
          if (!currentStep) {
            logFn(`[fn-chain] WARNING: next step ${flowEdges[0].to} not found in step map`);
          }
        } else {
          // Multiple flow edges — run sub-branches in parallel, sharing ctx so a
          // downstream waitForAll join can observe every branch's output.
          const subBranches = flowEdges.map(e => map.get(e.to)).filter(Boolean) as StuardStep[];
          const fromId = currentStep.id;
          const results = await Promise.all(subBranches.map(s => runChain(s, ctx, fromId)));
          const failed = results.find(r => !r.ok);
          if (failed) return failed;
          break;
        }
      }
      return { ok: true };
    }

    // Execute branches
    if (validStartSteps.length === 1) {
      const chainResult = await runChain(validStartSteps[0], functionCtx);
      if (!chainResult.ok) return chainResult;
    } else {
      logFn(`⚡ Function ${triggerId}: executing ${validStartSteps.length} parallel branches`);
      const results = await Promise.all(validStartSteps.map(step => runChain(step, functionCtx)));
      const failed = results.find(r => !r.ok);
      if (failed) return failed;
    }

    logFn(`✅ Function ${triggerId} completed`);
    return { ok: true, result: functionCtx.__return };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'function_call_failed' };
  }
}
