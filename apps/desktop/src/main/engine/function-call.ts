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

    // Find edges from this trigger to determine the start step
    const steps = Array.isArray(spec.steps) ? spec.steps : [];
    const specAny = spec as any;
    
    // In StuardSpec, triggers have a 'start' property pointing to the first step
    // Or we need to find it from the edges array
    let startStepId: string | undefined;
    
    // Method 1: Check if trigger has a 'start' property
    const triggerAnyStart = trigger as any;
    if (triggerAnyStart.start) {
      startStepId = triggerAnyStart.start;
    }
    
    // Method 2: Check edges array in spec (from designerModelToStuardSpec)
    if (!startStepId && Array.isArray(specAny.edges)) {
      const edge = specAny.edges.find((e: any) => e.from === triggerId);
      if (edge) startStepId = edge.to;
    }
    
    // Method 3: Check step.next edges that reference this trigger
    if (!startStepId) {
      for (const step of steps) {
        const nextEdges = Array.isArray(step.next) ? step.next : [];
        for (const edge of nextEdges) {
          const edgeAny = edge as any;
          if (edgeAny.from === triggerId) {
            startStepId = edgeAny.to || edge.to;
            break;
          }
        }
        if (startStepId) break;
      }
    }
    
    // Method 4: Check if any step has this trigger as source
    if (!startStepId) {
      for (const step of steps) {
        const stepAny = step as any;
        if (stepAny.triggerId === triggerId || stepAny.trigger === triggerId) {
          startStepId = step.id;
          break;
        }
      }
    }

    if (!startStepId) {
      return { ok: false, error: `no_start_step_for_trigger: ${triggerId}` };
    }

    const startStep = steps.find(s => s.id === startStepId);
    if (!startStep) {
      return { ok: false, error: `start_step_not_found: ${startStepId}` };
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
    const triggerAny = trigger as any;
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

    engineCtx.logFn(`📞 Calling function trigger: ${triggerId}`);

    // Execute the chain starting from startStep
    const map = new Map<string, StuardStep>();
    for (const s of steps) map.set(s.id, s);

    let currentStep: StuardStep | undefined = startStep;
    let iterationCount = 0;
    const maxIterations = 1000; // Safety limit

    while (currentStep && iterationCount < maxIterations) {
      iterationCount++;

      // Check for termination
      if (functionCtx.__terminated) {
        break;
      }

      // Emit 'running' event so UI highlights this step
      emitStepEvent(spec.id, currentStep.id, 'running');

      const stepResult = await executeStep(spec, currentStep, functionCtx, engineCtx);
      
      if (!stepResult.ok) {
        // Emit 'error' event
        emitStepEvent(spec.id, currentStep.id, 'error', { error: stepResult.error });
        return { ok: false, error: stepResult.error || 'function_step_failed' };
      }

      // Emit 'completed' event
      emitStepEvent(spec.id, currentStep.id, 'completed', { result: functionCtx[currentStep.id] });

      // Check if this step returned a value (terminated the function)
      if (functionCtx.__terminated || functionCtx.__return !== undefined) {
        break;
      }

      // Move to next step
      if (stepResult.nextId) {
        currentStep = map.get(stepResult.nextId);
      } else if (stepResult.nextIds && stepResult.nextIds.length > 0) {
        // For simplicity, take the first branch (functions should be linear)
        currentStep = map.get(stepResult.nextIds[0]);
      } else {
        currentStep = undefined;
      }
    }

    // Return the function result
    const result = functionCtx.__return;
    engineCtx.logFn(`✅ Function ${triggerId} completed`);

    return { ok: true, result };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'function_call_failed' };
  }
}
