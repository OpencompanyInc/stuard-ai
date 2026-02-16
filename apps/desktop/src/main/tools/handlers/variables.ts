import { variableStore, saveVariables, setVariable, VariableEntry } from '../../workflow-variables';
import { RouterContext } from '../types';

/**
 * Resolve a variable name, auto-prepending 'workflow.' if needed.
 * This allows users to use either 'var1' or 'workflow.var1' for workflow variables.
 * 
 * Resolution order:
 * 1. If name already starts with 'workflow.', use as-is
 * 2. If exact name exists in store, use it
 * 3. Try with 'workflow.' prefix
 * 4. Fall back to original name
 */
function resolveVariableName(name: string): string {
  // Already has workflow prefix
  if (name.startsWith('workflow.')) {
    return name;
  }

  // Check if exact name exists
  if (variableStore.has(name)) {
    return name;
  }

  // Try with workflow prefix
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
 * and there's no explicit prefix, assuming it's a workflow variable.
 */
function resolveVariableNameForSet(name: string): string {
  // Already has workflow prefix
  if (name.startsWith('workflow.')) {
    return name;
  }

  // Check if exact name exists (user may have created a global var)
  if (variableStore.has(name)) {
    return name;
  }

  // Check if workflow version exists
  const workflowName = `workflow.${name}`;
  if (variableStore.has(workflowName)) {
    console.log(`[VARS] Auto-resolved '${name}' → '${workflowName}' for SET`);
    return workflowName;
  }

  // For new variables without prefix, use original name (global scope)
  // Users should use 'workflow.varName' for workflow-scoped vars
  return name;
}

function _truncateForLog(value: any, maxLen = 120): string {
  const str = JSON.stringify(value);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `… (${str.length} chars)`;
}

export async function execSetVariable(args: any, ctx: RouterContext): Promise<any> {
  const rawName = String(args?.name || '').trim();
  if (!rawName) return { ok: false, error: 'missing_variable_name' };
  const name = resolveVariableNameForSet(rawName);
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
  const name = resolveVariableName(rawName);
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
  const name = resolveVariableName(rawName);
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
  const name = resolveVariableName(rawName);
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
  const name = resolveVariableName(rawName);
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
  const name = resolveVariableName(rawName);
  const existed = variableStore.has(name);
  variableStore.delete(name);
  saveVariables();
  ctx.logFn(`🗑️ Deleted variable: ${name} (existed: ${existed})`);
  return { ok: true, name, deleted: existed };
}


