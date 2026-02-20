/**
 * Workspace Function Tools
 * - call_workspace_function: Execute a .stuard sub-workflow from within the same workspace
 * - list_workspace_functions: Discover callable .stuard files in the workspace
 */
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { getWorkspaceDir, readWorkflowModel, designerModelToStuardSpec, safeFlowId } from '../../workflows/workflows';
import { runStuardEngine, EngineContext } from '../../engine';
import { stuards_save } from '../../stuards';
import { RouterContext } from '../types';

/** Info about a callable .stuard sub-workflow in a workspace */
export interface WorkspaceFunction {
  /** Relative path within workspace (e.g. "helpers/send-email.stuard") */
  path: string;
  /** Display name from the workflow model */
  name: string;
  /** Description if available */
  description?: string;
  /** Input parameters from function trigger's inputParams */
  inputParams?: Array<{ name: string; type?: string; required?: boolean; default?: any; description?: string }>;
  /** Output schema if defined */
  outputSchema?: Array<{ name: string; type?: string; description?: string }>;
  /** Trigger types available */
  triggers?: string[];
  /** Has a 'function' trigger */
  isFunction: boolean;
}

/**
 * Discover all .stuard files in a workspace (excluding main.stuard)
 * These are callable as sub-workflows / workspace functions.
 */
export function discoverWorkspaceFunctions(flowId: string): WorkspaceFunction[] {
  const safe = safeFlowId(flowId);
  if (!safe) return [];

  const wsDir = getWorkspaceDir(safe);
  if (!wsDir) return [];

  const functions: WorkspaceFunction[] = [];

  const walkDir = (dir: string, prefix: string) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          walkDir(fullPath, relPath);
        } else if (entry.name.endsWith('.stuard') && entry.name !== 'main.stuard') {
          // Found a sub-workflow
          try {
            const raw = fs.readFileSync(fullPath, 'utf-8');
            const model = JSON.parse(raw || '{}');

            const triggers = Array.isArray(model?.triggers)
              ? model.triggers.map((t: any) => String(t?.type || ''))
              : [];
            const functionTrigger = model?.triggers?.find((t: any) => t.type === 'function');
            const inputParams = functionTrigger?.inputParams || functionTrigger?.args?.inputParams;
            const outputSchema = model?.outputSchema;

            functions.push({
              path: relPath,
              name: model?.name || entry.name.replace('.stuard', ''),
              description: model?.description || '',
              inputParams: Array.isArray(inputParams) ? inputParams : undefined,
              outputSchema: Array.isArray(outputSchema) ? outputSchema : undefined,
              triggers: triggers.filter(Boolean),
              isFunction: triggers.includes('function'),
            });
          } catch {
            // Can't parse — still list it
            functions.push({
              path: relPath,
              name: entry.name.replace('.stuard', ''),
              isFunction: false,
            });
          }
        }
      }
    } catch { /* skip unreadable dirs */ }
  };

  walkDir(wsDir, '');
  return functions;
}

/**
 * Read a .stuard sub-workflow model from within a workspace
 */
function readWorkspaceSubModel(flowId: string, subPath: string): any {
  const safe = safeFlowId(flowId);
  if (!safe) return null;

  const wsDir = getWorkspaceDir(safe);
  if (!wsDir) return null;

  // Sanitize path to prevent traversal
  const parts = subPath.split(/[/\\]/).filter(Boolean);
  const target = path.join(wsDir, ...parts);
  if (!target.startsWith(wsDir)) return null;
  if (!fs.existsSync(target)) return null;

  try {
    const raw = fs.readFileSync(target, 'utf-8');
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

/**
 * Execute a .stuard sub-workflow from within the same workspace.
 * This is like call_workflow but resolves files relative to the workspace.
 *
 * Args:
 *   flowId: string       - The parent workflow ID (set by engine automatically)
 *   path: string         - Relative path to the .stuard file (e.g. "helpers/send-email.stuard")
 *   inputs: object       - Input parameters to pass
 *   triggerId?: string   - Specific trigger ID to execute (defaults to first 'function' trigger)
 */
export async function execCallWorkspaceFunction(args: any, ctx: RouterContext): Promise<any> {
  try {
    const parentFlowId = String(args?.flowId || '').trim();
    const subPath = String(args?.path || args?.file || '').trim();
    const inputs = args?.inputs || args?.args || {};
    const triggerId = args?.triggerId;

    if (!parentFlowId) return { ok: false, error: 'missing flowId (parent workflow)' };
    if (!subPath) return { ok: false, error: 'missing path to .stuard file' };

    // Ensure path ends with .stuard
    const resolvedPath = subPath.endsWith('.stuard') ? subPath : `${subPath}.stuard`;

    // Read the sub-workflow model
    const model = readWorkspaceSubModel(parentFlowId, resolvedPath);
    if (!model) return { ok: false, error: `workspace function not found: ${resolvedPath}` };

    // Generate a unique execution ID for this sub-workflow run
    const execId = `${parentFlowId}_sub_${Date.now().toString(36)}`;

    // Convert to StuardSpec
    const spec = designerModelToStuardSpec(model, triggerId);
    spec.id = execId;
    spec.autostart = false;

    // If a specific trigger is requested, find its start node
    if (triggerId) {
      const trigger = spec.triggers?.find((t: any) => t.id === triggerId);
      if (!trigger) return { ok: false, error: `trigger not found: ${triggerId}` };
      const triggerAny = trigger as any;
      if (triggerAny.start) spec.start = triggerAny.start;
    }

    // Save spec temporarily for execution
    const stuardsDir = path.join(app.getPath('userData'), 'stuards');
    const saveRes = stuards_save({ id: execId, content: JSON.stringify(spec, null, 2) });
    if (!saveRes?.ok) return { ok: false, error: saveRes?.error || 'failed to prepare sub-workflow' };

    const engineCtx: EngineContext = {
      stuardsDir,
      agentWsUrl: ctx.agentWsUrl,
      cloudAiUrl: ctx.cloudAiUrl,
      logFn: ctx.logFn,
      accessToken: ctx.accessToken,
    };

    // Build payload with inputs
    const payload = { args: inputs, input: inputs };

    ctx.logFn(`📂 Calling workspace function: ${resolvedPath}`);

    try {
      const runRes: any = await runStuardEngine(execId, payload, engineCtx);
      // Clean up temp stuard file
      try {
        const tempPath = path.join(stuardsDir, `${execId}.json`);
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch { }

      return {
        ok: true,
        functionPath: resolvedPath,
        result: runRes?.returnValue,
      };
    } catch (e: any) {
      return { ok: false, functionPath: resolvedPath, error: e?.message || 'execution failed' };
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'call_workspace_function failed' };
  }
}

/**
 * List all callable functions in the current workspace
 */
export async function execListWorkspaceFunctions(args: any, ctx: RouterContext): Promise<any> {
  try {
    const flowId = String(args?.flowId || '').trim();
    if (!flowId) return { ok: false, error: 'missing flowId', functions: [] };

    const functions = discoverWorkspaceFunctions(flowId);
    return { ok: true, functions };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'list_workspace_functions failed', functions: [] };
  }
}
