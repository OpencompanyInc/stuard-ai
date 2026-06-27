import { variableStore, saveVariables, setVariable, VariableEntry, composeStorageKey, parseStorageKey } from '../../workflow-variables';
import { RouterContext } from '../types';

/**
 * Resolve a variable name to its public (scoped) form for the calling flow.
 *
 * Scoping model:
 * - workflow.* = shared across the calling workflow's flow (flow-scoped)
 * - local.*    = scoped to the calling workflow's flow
 * - No prefix  = defaults to workflow scope
 *
 * Note: this returns the *public* scoped name (e.g. `workflow.counter`).
 * The variableStore uses a `${flowId}::${scoped}` key internally; that
 * composition happens inside get/setVariable.
 *
 * Resolution order:
 * 1. If name already starts with 'workflow.' or 'local.', use as-is.
 * 2. If exact unprefixed key exists in store (legacy global var), use as-is.
 * 3. Default to 'workflow.<name>'.
 */
function resolveVariableName(name: string, flowId?: string): string {
  if (name.startsWith('workflow.') || name.startsWith('local.')) {
    return name;
  }

  // Legacy unprefixed global key.
  if (variableStore.has(name)) {
    return name;
  }

  // Default to workflow scope.
  const workflowName = `workflow.${name}`;
  if (flowId && variableStore.has(composeStorageKey(flowId, workflowName))) {
    console.log(`[VARS] Auto-resolved '${name}' → '${workflowName}' (flow ${flowId})`);
  }
  return workflowName;
}

/**
 * Resolve variable name for SET operations.
 * Same rules as resolveVariableName, but honors an explicit `scope` arg
 * for brand-new variables.
 */
function resolveVariableNameForSet(name: string, scope?: string, flowId?: string): string {
  if (name.startsWith('workflow.') || name.startsWith('local.')) {
    return name;
  }

  if (variableStore.has(name)) {
    return name;
  }

  const effectiveScope = scope === 'local' ? 'local' : 'workflow';
  const prefixed = `${effectiveScope}.${name}`;
  if (flowId && !variableStore.has(composeStorageKey(flowId, prefixed))) {
    console.log(`[VARS] New variable '${name}' created with ${effectiveScope} scope → '${prefixed}' (flow ${flowId})`);
  }
  return prefixed;
}

function _truncateForLog(value: any, maxLen = 120): string {
  const str = JSON.stringify(value);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `… (${str.length} chars)`;
}

/** Look up an entry honoring flow-scoped storage with a legacy unscoped fallback. */
function readEntry(name: string, flowId?: string): VariableEntry | undefined {
  if (flowId && (name.startsWith('workflow.') || name.startsWith('local.'))) {
    const scoped = variableStore.get(composeStorageKey(flowId, name));
    if (scoped) return scoped;
  }
  return variableStore.get(name);
}

export async function execSetVariable(args: any, ctx: RouterContext): Promise<any> {
  const rawName = String(args?.name || '').trim();
  if (!rawName) return { ok: false, error: 'missing_variable_name' };
  const flowId = args?.flowId as string | undefined;
  const scope = args?.scope as string | undefined;
  const name = resolveVariableNameForSet(rawName, scope, flowId);
  const silent = args?.notifyUi === false;
  const entry = setVariable(name, args?.value, args?.type, flowId, silent);
  const logVal = _truncateForLog(entry.value);
  ctx.logFn(`📝 Set ${name} = ${logVal} (${entry.type})`);
  console.log(`[VARS] SET ${name} = ${logVal} (flow ${flowId || '∅'})`);
  return { ok: true, name, ...entry };
}

export async function execGetVariable(args: any, ctx: RouterContext): Promise<any> {
  const rawName = String(args?.name || '').trim();
  if (!rawName) return { ok: false, error: 'missing_variable_name' };
  const flowId = args?.flowId as string | undefined;
  const name = resolveVariableName(rawName, flowId);
  const entry = readEntry(name, flowId);
  if (!entry) {
    const defaultVal = args?.default;
    // IMPORTANT: When a default is provided, initialize the variable in the store
    // This ensures guards can properly evaluate the variable value
    if (defaultVal !== undefined) {
      const inferredType = typeof defaultVal === 'boolean' ? 'boolean'
        : typeof defaultVal === 'number' ? 'number'
        : Array.isArray(defaultVal) ? 'list' : 'string';
      setVariable(name, defaultVal, inferredType as any, flowId);
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
  const flowId = args?.flowId as string | undefined;
  const name = resolveVariableName(rawName, flowId);
  const current = readEntry(name, flowId);
  const currentVal = current?.value;
  // If not a boolean, treat falsy as false
  const asBool = typeof currentVal === 'boolean' ? currentVal : !!currentVal;
  const newVal = !asBool;
  const silent = args?.notifyUi === false;
  const entry = setVariable(name, newVal, 'boolean', flowId, silent);
  ctx.logFn(`🔄 Toggle ${name}: ${asBool} → ${newVal}`);
  console.log(`[VARS] TOGGLE ${name}: ${asBool} → ${newVal}`);
  return { ok: true, name, previousValue: currentVal, ...entry };
}

export async function execIncrementVariable(args: any, ctx: RouterContext): Promise<any> {
  const rawName = String(args?.name || '').trim();
  if (!rawName) return { ok: false, error: 'missing_variable_name' };
  const flowId = args?.flowId as string | undefined;
  const name = resolveVariableName(rawName, flowId);
  const amount = Number(args?.amount ?? args?.by ?? 1);
  const current = readEntry(name, flowId);
  const currentNum = typeof current?.value === 'number' ? current.value : 0;
  const newVal = currentNum + amount;
  const silent = args?.notifyUi === false;
  const entry = setVariable(name, newVal, 'number', flowId, silent);
  ctx.logFn(`➕ Increment ${name}: ${currentNum} → ${newVal}`);
  return { ok: true, name, previousValue: currentNum, ...entry };
}

export async function execAppendToList(args: any, ctx: RouterContext): Promise<any> {
  const rawName = String(args?.name || '').trim();
  if (!rawName) return { ok: false, error: 'missing_variable_name' };
  const flowId = args?.flowId as string | undefined;
  const name = resolveVariableName(rawName, flowId);
  const current = readEntry(name, flowId);
  const currentList = Array.isArray(current?.value) ? current.value : [];
  const item = args?.item ?? args?.value;
  const newList = [...currentList, item];
  const silent = args?.notifyUi === false;
  const entry = setVariable(name, newList, 'list', flowId, silent);
  ctx.logFn(`📋 Append to ${name}: [${currentList.length} items] → [${newList.length} items]`);
  return { ok: true, name, previousLength: currentList.length, ...entry };
}

export async function execListVariables(args: any, ctx: RouterContext): Promise<any> {
  const prefix = String(args?.prefix || '').trim();
  const flowId = args?.flowId as string | undefined;
  const variables: Array<{ name: string } & VariableEntry> = [];
  for (const [key, entry] of variableStore.entries()) {
    const { flowId: keyFlowId, scopedName } = parseStorageKey(key);
    // Filter to entries that belong to the calling flow when one is given.
    // Legacy unscoped keys (no `${flowId}::` prefix) are still returned, since
    // we can't tell which flow they belong to and the caller may legitimately
    // be reading global state.
    if (flowId && keyFlowId && keyFlowId !== flowId) continue;
    if (flowId && !keyFlowId && entry.flowId && entry.flowId !== flowId) continue;
    if (prefix && !scopedName.startsWith(prefix)) continue;
    variables.push({ name: scopedName, ...entry });
  }
  return { ok: true, count: variables.length, variables };
}

export async function execDeleteVariable(args: any, ctx: RouterContext): Promise<any> {
  const rawName = String(args?.name || '').trim();
  if (!rawName) return { ok: false, error: 'missing_variable_name' };
  const flowId = args?.flowId as string | undefined;
  const name = resolveVariableName(rawName, flowId);
  const storageKey = composeStorageKey(flowId, name);
  const existed = variableStore.has(storageKey) || variableStore.has(name);
  variableStore.delete(storageKey);
  if (storageKey !== name) variableStore.delete(name);
  saveVariables();
  ctx.logFn(`🗑️ Deleted variable: ${name} (existed: ${existed})`);
  return { ok: true, name, deleted: existed };
}


