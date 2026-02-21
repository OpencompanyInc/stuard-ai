import { variableStore, saveVariables, setVariable, VariableEntry } from '../../workflow-variables';
import { RouterContext } from '../types';

/**
 * Resolve a variable name, auto-prepending 'workflow.' if needed.
 * 
 * Scoping model:
 * - workflow.* = shared across all stuard files in the current workflow
 * - local.* = scoped to the current stuard file only
 * - No prefix = defaults to workflow scope
 * 
 * Resolution order:
 * 1. If name already starts with 'workflow.' or 'local.', use as-is
 * 2. If exact name exists in store, use it
 * 3. Try with 'workflow.' prefix (default scope)
 * 4. Fall back to original name
 */
function resolveVariableName(name: string, flowId?: string): string {
  // Already has prefix
  if (name.startsWith('workflow.') || name.startsWith('local.')) {
    return name;
  }

  // Check if exact name exists
  if (variableStore.has(name)) {
    return name;
  }

  // Try with workflow prefix (workflow-scoped is the default)
  const workflowName = `workflow.${name}`;
  if (variableStore.has(workflowName)) {
    console.log(`[VARS] Auto-resolved '${name}' → '${workflowName}'`);
    return workflowName;
  }

  // Fall back to original (will use default value)
  return name;
}

/**
 * Resolve variable name for SET operations.
 * For SET, we auto-add 'workflow.' prefix if the variable doesn't exist
 * and there's no explicit prefix — defaults to workflow scope (shared across stuard files).
 * 
 * Scoping:
 * - workflow.* = shared across all stuard files in the current workflow
 * - local.* = scoped to the current stuard file only
 */
function resolveVariableNameForSet(name: string, scope?: string): string {
  // Already has explicit prefix
  if (name.startsWith('workflow.') || name.startsWith('local.')) {
    return name;
  }

  // Check if exact name exists
  if (variableStore.has(name)) {
    return name;
  }

  // Check if workflow version exists
  const workflowName = `workflow.${name}`;
  if (variableStore.has(workflowName)) {
    console.log(`[VARS] Auto-resolved '${name}' → '${workflowName}' for SET`);
    return workflowName;
  }

  // For new variables, use the specified scope (default: workflow)
  const effectiveScope = scope === 'local' ? 'local' : 'workflow';
  const prefixed = `${effectiveScope}.${name}`;
  console.log(`[VARS] New variable '${name}' created with ${effectiveScope} scope → '${prefixed}'`);
  return prefixed;
}

function _truncateForLog(value: any, maxLen = 120): string {
  const str = JSON.stringify(value);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `… (${str.length} chars)`;
}

export async function execSetVariable(args: any, ctx: RouterContext): Promise<any> {
  const rawName = String(args?.name || '').trim();
  if (!rawName) return { ok: false, error: 'missing_variable_name' };
  const scope = args?.scope as string | undefined;
  const name = resolveVariableNameForSet(rawName, scope);
  const silent = args?.notifyUi === false;
  const entry = setVariable(name, args?.value, args?.type, args?.flowId, silent);
  const logVal = _truncateForLog(entry.value);
  ctx.logFn(`📝 Set ${name} = ${logVal} (${entry.type})`);
  console.log(`[VARS] SET ${name} = ${logVal}`);
  return { ok: true, name, ...entry };
}

export async function execGetVariable(args: any, ctx: RouterContext): Promise<any> {
  const rawName = String(args?.name || '').trim();
  if (!rawName) return { ok: false, error: 'missing_variable_name' };
  const name = resolveVariableName(rawName, args?.flowId);
  const entry = variableStore.get(name);
  if (!entry) {
    const defaultVal = args?.default;
    // IMPORTANT: When a default is provided, initialize the variable in the store
    // This ensures guards can properly evaluate the variable value
    if (defaultVal !== undefined) {
      const inferredType = typeof defaultVal === 'boolean' ? 'boolean'
        : typeof defaultVal === 'number' ? 'number'
        : Array.isArray(defaultVal) ? 'list' : 'string';
      setVariable(name, defaultVal, inferredType as any, args?.flowId);
      ctx.logFn(`📖 Get ${rawName} = ${JSON.stringify(defaultVal)} (initialized with default)`);
      console.log(`[VARS] GET ${rawName} = ${JSON.stringify(defaultVal)} (initialized with default)`);
      return { ok: true, name, value: defaultVal, type: inferredType, exists: false, initialized: true };
    }
    ctx.logFn(`📖 Get ${rawName} = undefined (not found, no default)`);
    console.log(`[VARS] GET ${rawName} = undefined (not found)`);
    return { ok: true, name: rawName, value: undefined, exists: false };
  }
  ctx.logFn(`📖 Get ${name} = ${JSON.stringify(entry.value)} (exists)`);
  console.log(`[VARS] GET ${name} = ${JSON.stringify(entry.value)} (exists)`);
  return { ok: true, name, ...entry, exists: true };
}

export async function execToggleVariable(args: any, ctx: RouterContext): Promise<any> {
  const rawName = String(args?.name || '').trim();
  if (!rawName) return { ok: false, error: 'missing_variable_name' };
  const name = resolveVariableName(rawName, args?.flowId);
  const current = variableStore.get(name);
  const currentVal = current?.value;
  // If not a boolean, treat falsy as false
  const asBool = typeof currentVal === 'boolean' ? currentVal : !!currentVal;
  const newVal = !asBool;
  const silent = args?.notifyUi === false;
  const entry = setVariable(name, newVal, 'boolean', args?.flowId, silent);
  ctx.logFn(`🔄 Toggle ${name}: ${asBool} → ${newVal}`);
  console.log(`[VARS] TOGGLE ${name}: ${asBool} → ${newVal}`);
  return { ok: true, name, previousValue: currentVal, ...entry };
}

export async function execIncrementVariable(args: any, ctx: RouterContext): Promise<any> {
  const rawName = String(args?.name || '').trim();
  if (!rawName) return { ok: false, error: 'missing_variable_name' };
  const name = resolveVariableName(rawName, args?.flowId);
  const amount = Number(args?.amount ?? args?.by ?? 1);
  const current = variableStore.get(name);
  const currentNum = typeof current?.value === 'number' ? current.value : 0;
  const newVal = currentNum + amount;
  const silent = args?.notifyUi === false;
  const entry = setVariable(name, newVal, 'number', args?.flowId, silent);
  ctx.logFn(`➕ Increment ${name}: ${currentNum} → ${newVal}`);
  return { ok: true, name, previousValue: currentNum, ...entry };
}

export async function execAppendToList(args: any, ctx: RouterContext): Promise<any> {
  const rawName = String(args?.name || '').trim();
  if (!rawName) return { ok: false, error: 'missing_variable_name' };
  const name = resolveVariableName(rawName, args?.flowId);
  const current = variableStore.get(name);
  const currentList = Array.isArray(current?.value) ? current.value : [];
  const item = args?.item ?? args?.value;
  const newList = [...currentList, item];
  const silent = args?.notifyUi === false;
  const entry = setVariable(name, newList, 'list', args?.flowId, silent);
  ctx.logFn(`📋 Append to ${name}: [${currentList.length} items] → [${newList.length} items]`);
  return { ok: true, name, previousLength: currentList.length, ...entry };
}

export async function execListVariables(args: any, ctx: RouterContext): Promise<any> {
  const prefix = String(args?.prefix || '').trim();
  const flowId = args?.flowId;
  const variables: Array<{ name: string } & VariableEntry> = [];
  for (const [name, entry] of variableStore.entries()) {
    if (prefix && !name.startsWith(prefix)) continue;
    if (flowId && entry.flowId !== flowId) continue;
    variables.push({ name, ...entry });
  }
  return { ok: true, count: variables.length, variables };
}

export async function execDeleteVariable(args: any, ctx: RouterContext): Promise<any> {
  const rawName = String(args?.name || '').trim();
  if (!rawName) return { ok: false, error: 'missing_variable_name' };
  const name = resolveVariableName(rawName, args?.flowId);
  const existed = variableStore.has(name);
  variableStore.delete(name);
  saveVariables();
  ctx.logFn(`🗑️ Deleted variable: ${name} (existed: ${existed})`);
  return { ok: true, name, deleted: existed };
}


