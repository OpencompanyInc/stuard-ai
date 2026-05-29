/**
 * Orchestration tools (desktop adapter).
 *
 * The run_sequential / run_parallel / loop_executor runners live in
 * @stuardai/workflow-core/runtime so the desktop and VM engines behave
 * identically. This file injects the desktop host hooks (its per-step executor
 * and direct tool dispatch); desktop routes by tool name, so no kind normalizer.
 */
import { execTool } from '../tool-router';
import { EngineContext, StuardSpec, StuardStep } from './types';
import { executeStep } from './execution';
import {
  execRunSequential as coreExecRunSequential,
  execRunParallel as coreExecRunParallel,
  execLoopExecutor as coreExecLoopExecutor,
  type OrchestrationHooks,
} from '@stuardai/workflow-core/runtime';

const hooksFor = (engineCtx: EngineContext): OrchestrationHooks => ({
  logFn: engineCtx.logFn,
  executeStep: (sp, st, c) => executeStep(sp, st, c, engineCtx),
  execTool: (toolName, args) => execTool(toolName, args, engineCtx),
});

export function execRunSequential(spec: StuardSpec, parentStep: StuardStep, args: any, ctx: any, engineCtx: EngineContext): Promise<any> {
  return coreExecRunSequential(spec, parentStep, args, ctx, hooksFor(engineCtx));
}

export function execRunParallel(flowId: string, args: any, ctx: any, engineCtx: EngineContext): Promise<any> {
  return coreExecRunParallel(flowId, args, ctx, hooksFor(engineCtx));
}

export function execLoopExecutor(flowId: string, args: any, ctx: any, engineCtx: EngineContext): Promise<any> {
  return coreExecLoopExecutor(flowId, args, ctx, hooksFor(engineCtx));
}
