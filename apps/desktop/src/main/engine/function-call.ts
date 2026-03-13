/**
 * Function call execution - handles call_function tool
 * Executes a function trigger within the same workflow
 */
import { EngineContext, StuardSpec, StuardStep } from './types';
import { executeStep } from './execution';
import { emitStepEvent } from './events';

/**
 * Execute workflow chain starting from a function trigger
 * @param spec The current workflow spec
 * @param triggerId The ID of the function trigger to execute
 * @param inputs The inputs to pass to the function (available as ctx.args)
 * @param parentCtx The parent context (for variable inheritance)
 * @param engineCtx The engine context
 */
export async function executeFromTrigger(
  spec: StuardSpec,
  triggerId: string,
  inputs: Record<string, any>,
  parentCtx: any,
  engineCtx: EngineContext
): Promise<{ ok: boolean; result?: any; error?: string }> {
  try {
    // Find the trigger in the spec
    const trigger = spec.triggers?.find((t: any) => t.id === triggerId);
    if (!trigger) {
      return { ok: false, error: `trigger_not_found: ${triggerId}` };
    }

    // Check if it's a function trigger
    if (trigger.type !== 'function') {
      engineCtx.logFn(`Warning: Trigger ${triggerId} is not a 'function' trigger (type: ${trigger.type})`);
    }

    // Find ALL start step IDs from this trigger (supports parallel branches)
    const steps = Array.isArray(spec.steps) ? spec.steps : [];
    const specAny = spec as any;
    const triggerAny = trigger as any;
    let startStepIds: string[] = [];

    // Method 1: Check trigger.startNodes (array) or trigger.start (single)
    if (Array.isArray(triggerAny.startNodes) && triggerAny.startNodes.length > 0) {
      startStepIds = [...triggerAny.startNodes];
    } else if (triggerAny.start) {
      startStepIds = [triggerAny.start];
    }

    // Method 2: Check edges array in spec
    if (startStepIds.length === 0 && Array.isArray(specAny.edges)) {
      startStepIds = specAny.edges
        .filter((e: any) => e.from === triggerId)
        .map((e: any) => String(e.to))
        .filter(Boolean);
    }

    // Method 3: Check step.next edges that reference this trigger
    if (startStepIds.length === 0) {
      for (const step of steps) {
        const nextEdges = Array.isArray(step.next) ? step.next : [];
        for (const edge of nextEdges) {
          const edgeAny = edge as any;
          if (edgeAny.from === triggerId && (edgeAny.to || edge.to)) {
            startStepIds.push(String(edgeAny.to || edge.to));
          }
        }
      }
    }

    // Method 4: Check if any step has this trigger as source
    if (startStepIds.length === 0) {
      for (const step of steps) {
        const stepAny = step as any;
        if (stepAny.triggerId === triggerId || stepAny.trigger === triggerId) {
          startStepIds.push(step.id);
        }
      }
    }

    // Deduplicate
    startStepIds = [...new Set(startStepIds)];

    if (startStepIds.length === 0) {
      return { ok: false, error: `no_start_step_for_trigger: ${triggerId}` };
    }

    // Verify all start steps exist
    const map = new Map<string, StuardStep>();
    for (const s of steps) map.set(s.id, s);

    const validStartSteps = startStepIds.map(id => map.get(id)).filter(Boolean) as StuardStep[];
    if (validStartSteps.length === 0) {
      return { ok: false, error: `start_steps_not_found: ${startStepIds.join(', ')}` };
    }

    // Build function context with inputs
    // Inherit from parent context but create isolated scope for this function call
    const functionCtx: any = {
      ...parentCtx,
      args: inputs,
      input: inputs,
      // Clear return value for this function scope
      __return: undefined,
      __terminated: false,
    };

    // Map input params if trigger has inputParams defined
    if (triggerAny.inputParams && Array.isArray(triggerAny.inputParams)) {
      for (const param of triggerAny.inputParams) {
        const paramName = param.name;
        if (paramName && inputs[paramName] !== undefined) {
          functionCtx[`args.${paramName}`] = inputs[paramName];
        }
      }
    }

    // Ensure trigger context is available for templates (fixes {{trigger.data.X}})
    functionCtx.trigger = {
      data: inputs || {}
    };

    engineCtx.logFn(`📞 Calling function trigger: ${triggerId} (${validStartSteps.length} branch${validStartSteps.length > 1 ? 'es' : ''})`);

    // Helper: run a single linear chain from a start step
    async function runChain(startStep: StuardStep, ctx: any): Promise<{ ok: boolean; error?: string }> {
      let currentStep: StuardStep | undefined = startStep;
      let iterationCount = 0;
      const maxIterations = 1000;

      while (currentStep && iterationCount < maxIterations) {
        iterationCount++;

        if (ctx.__terminated) break;

        emitStepEvent(spec.id, currentStep.id, 'running');

        const stepResult = await executeStep(spec, currentStep, ctx, engineCtx);

        if (!stepResult.ok) {
          engineCtx.logFn(`[fn-chain] ${currentStep.id} (${currentStep.tool}) FAILED: ${stepResult.error}`);
          emitStepEvent(spec.id, currentStep.id, 'error', { error: stepResult.error });
          return { ok: false, error: stepResult.error || 'function_step_failed' };
        }

        emitStepEvent(spec.id, currentStep.id, 'completed', { result: ctx[currentStep.id] });

        if (ctx.__terminated || ctx.__return !== undefined) break;

        // Use edge-based routing from executeStep results
        const flowEdges = (stepResult.edges || []).filter(e => !e.stream);

        if (flowEdges.length === 0) {
          // End of chain
          break;
        } else if (flowEdges.length === 1) {
          currentStep = map.get(flowEdges[0].to);
          if (!currentStep) {
            engineCtx.logFn(`[fn-chain] WARNING: next step ${flowEdges[0].to} not found in step map`);
          }
        } else {
          // Multiple flow edges within a function branch — run sub-branches in parallel
          const subBranches = flowEdges.map(e => map.get(e.to)).filter(Boolean) as StuardStep[];
          const results = await Promise.all(subBranches.map(s => runChain(s, ctx)));
          const failed = results.find(r => !r.ok);
          if (failed) return failed;
          break;
        }
      }
      return { ok: true };
    }

    // Execute branches
    if (validStartSteps.length === 1) {
      // Single branch — run sequentially
      const chainResult = await runChain(validStartSteps[0], functionCtx);
      if (!chainResult.ok) return chainResult;
    } else {
      // Multiple branches — run in parallel (shared context for variable updates)
      engineCtx.logFn(`⚡ Function ${triggerId}: executing ${validStartSteps.length} parallel branches`);
      const results = await Promise.all(
        validStartSteps.map(step => runChain(step, functionCtx))
      );
      const failed = results.find(r => !r.ok);
      if (failed) return failed;
    }

    // Return the function result
    const result = functionCtx.__return;
    engineCtx.logFn(`✅ Function ${triggerId} completed`);

    return { ok: true, result };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'function_call_failed' };
  }
}
