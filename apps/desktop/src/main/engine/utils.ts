/**
 * Engine utilities — path resolution, interpolation, JSONLogic + guard eval.
 *
 * The implementations now live in @stuardai/workflow-core/runtime so the desktop
 * and VM engines share one codebase. This module is a thin binding layer that
 * injects the desktop's variable-store-backed `$vars` resolver and preserves the
 * existing export surface (`getAtPath`, `interpolateForTool`, `jsonLogic`,
 * `evalIfGuard`, `safeEval`, `deepMerge`, `summarizeOutput`, `safeStuardId`).
 */
import { getVariable } from '../tool-router';
import {
  getAtPath as coreGetAtPath,
  interpolateForTool as coreInterpolateForTool,
  jsonLogic as coreJsonLogic,
  evalIfGuard as coreEvalIfGuard,
  evaluateSafe,
  deepMerge,
  summarizeOutput,
  safeStuardId,
  type PathResolveOptions,
} from '@stuardai/workflow-core/runtime';

export { deepMerge, summarizeOutput, safeStuardId };

// Desktop resolves `$vars.NAME` from its global variable store, scoped to the
// executing flow (flowId is read from ctx.$flowId by the shared resolver).
const resolveVar = (name: string, flowId: string | undefined): any =>
  getVariable(name, undefined, flowId);

/** Desktop's `$vars` resolver, exported so the shared edge-selection
 *  (decideNext) and any other shared runtime can resolve variables the same
 *  way the desktop engine does. */
export const pathResolveOptions: PathResolveOptions = { resolveVar };
const PATH_OPTS = pathResolveOptions;

export function getAtPath(obj: any, pathStr: string, defaultVal?: any): any {
  return coreGetAtPath(obj, pathStr, defaultVal, PATH_OPTS);
}

export function safeEval(expr: string, ctx: any): any {
  return evaluateSafe(expr, ctx);
}

export function interpolateForTool(input: any, ctx: any, toolName: string): any {
  return coreInterpolateForTool(input, ctx, toolName, PATH_OPTS);
}

export function jsonLogic(logic: any, data: any): any {
  return coreJsonLogic(logic, data, PATH_OPTS);
}

export function evalIfGuard(logic: any, ctx: any): boolean {
  return coreEvalIfGuard(logic, ctx, PATH_OPTS);
}
