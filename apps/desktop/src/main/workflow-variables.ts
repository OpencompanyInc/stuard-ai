import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export type VariableValue = boolean | string | number | any[];
export type VariableType = 'boolean' | 'string' | 'number' | 'list';

export interface VariableEntry {
  value: VariableValue;
  type: VariableType;
  updatedAt: string;
  flowId?: string;
}

/** Type from workflow JSON - includes 'json' which maps to 'string' in storage */
export type WorkflowVariableType = VariableType | 'json';

/** Definition of a workflow variable (from workflow JSON) */
export interface WorkflowVariableDefinition {
  name: string;
  type: WorkflowVariableType;
  /** Scope: 'workflow' = shared across all stuard files, 'local' = scoped to a single stuard file. Default: 'workflow' */
  scope?: 'workflow' | 'local';
  defaultValue: any;
  description?: string;
  persistState?: boolean;
}

/** Registry of workflow variable definitions by flowId */
const variableDefinitions = new Map<string, Map<string, WorkflowVariableDefinition>>();

/**
 * Per-workflow variable store.
 *
 * Storage key format:
 *   - Scoped (workflow.* or local.*) variables: `${flowId}::${scope}.${name}`
 *     so different workflows can have variables of the same name without colliding.
 *   - Unprefixed/legacy names: stored as-is (no flowId namespace).
 *
 * The `${flowId}::` prefix is invisible to tool callers and templates — they
 * refer to variables by their scoped name (e.g. `workflow.counter`) and the
 * runtime composes the storage key using the executing workflow's flowId.
 */
export const variableStore = new Map<string, VariableEntry>();
const VARIABLES_FILE = path.join(app.getPath('userData'), 'workflow-variables.json');

const KEY_SEPARATOR = '::';

/** Is this a scoped variable name (`workflow.x` or `local.x`)? */
function isScopedName(name: string): boolean {
  return name.startsWith('workflow.') || name.startsWith('local.');
}

/** Is this the project-wide (global) scope? `workflow.*` is shared across all
 * stuard files in a project (workspace); `local.*` is per-file. */
function isWorkflowScopedName(name: string): boolean {
  return name.startsWith('workflow.');
}

// ── Project (workspace) scoping ──────────────────────────────────────────────
// A project = the workspace dir (`<mainFlowId>/main.stuard` + its other .stuard
// files). `workflow.*` variables are shared across ALL stuard files in that
// project, so they must key off the PROJECT id, not the per-execution flowId.
// call_workspace_function runs each sub-.stuard under a fresh execId; without
// this map its globals would land in a separate namespace and never be seen by
// main.stuard or sibling files. `local.*` stays keyed by the execution flowId.
//
// Default is identity (a flow is its own project), so single-file workflows and
// intra-spec call_function — which never register a mapping — are unchanged.
const projectRootByFlow = new Map<string, string>();

/** Map an execution flowId to its owning project (workspace) id. */
export function registerFlowProject(flowId: string, projectId: string): void {
  if (flowId && projectId && flowId !== projectId) {
    projectRootByFlow.set(flowId, projectId);
  }
}

/** Drop a flow→project mapping once its run finishes. */
export function unregisterFlowProject(flowId: string): void {
  if (flowId) projectRootByFlow.delete(flowId);
}

/** Resolve a flowId to its project id (transitively); identity if unmapped. */
export function resolveProjectId(flowId: string | undefined): string | undefined {
  if (!flowId) return flowId;
  // Walk the chain (sub→…→main) with a guard against accidental cycles.
  let cur = flowId;
  for (let i = 0; i < 16; i++) {
    const next = projectRootByFlow.get(cur);
    if (!next || next === cur) break;
    cur = next;
  }
  return cur;
}

/**
 * Compose a storage key from a flowId and a scoped variable name.
 * If the name isn't scoped, or no flowId is given, returns the name unchanged.
 * `workflow.*` (global) names key off the resolved PROJECT id so they're shared
 * across every stuard file in the project; `local.*` keys off the flowId as-is.
 */
export function composeStorageKey(flowId: string | undefined, name: string): string {
  if (!flowId || !isScopedName(name)) return name;
  const keyFlowId = isWorkflowScopedName(name) ? (resolveProjectId(flowId) || flowId) : flowId;
  return `${keyFlowId}${KEY_SEPARATOR}${name}`;
}

/** Parse a storage key back to its components. */
export function parseStorageKey(key: string): { flowId?: string; scopedName: string } {
  const idx = key.indexOf(KEY_SEPARATOR);
  if (idx === -1) return { scopedName: key };
  const flowId = key.slice(0, idx);
  const scopedName = key.slice(idx + KEY_SEPARATOR.length);
  if (!isScopedName(scopedName)) return { scopedName: key };
  return { flowId, scopedName };
}


/** Callback fired after a variable changes */
export type VariableChangeCallback = (name: string, entry: VariableEntry, previousValue: any) => void;

const variableChangeListeners = new Set<VariableChangeCallback>();

/** Register a listener that fires whenever any variable is set/changed */
export function onVariableChange(cb: VariableChangeCallback): () => void {
  variableChangeListeners.add(cb);
  return () => { variableChangeListeners.delete(cb); };
}

/** Notify all listeners of a variable change */
function notifyListeners(name: string, entry: VariableEntry, previousValue: any): void {
  for (const cb of variableChangeListeners) {
    try {
      cb(name, entry, previousValue);
    } catch (e) {
      console.error('[VARS] Error in variable change listener:', e);
    }
  }
}

export function loadVariables(): void {
  try {
    if (fs.existsSync(VARIABLES_FILE)) {
      const data = JSON.parse(fs.readFileSync(VARIABLES_FILE, 'utf8'));
      for (const [key, entry] of Object.entries(data)) {
        variableStore.set(key, entry as VariableEntry);
      }
    }
  } catch (e) {
    console.error('Failed to load workflow variables:', e);
  }
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 500;

export function saveVariables(): void {
  // Debounce disk writes — critical for streaming scenarios where
  // set_variable is called at 15-30fps with large base64 values.
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_flushSaveVariables, SAVE_DEBOUNCE_MS);
}

export function saveVariablesSync(): void {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  _flushSaveVariables();
}

function _flushSaveVariables(): void {
  _saveTimer = null;
  try {
    const data: Record<string, VariableEntry> = {};
    for (const [key, entry] of variableStore.entries()) {
      data[key] = entry;
    }
    fs.writeFileSync(VARIABLES_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save workflow variables:', e);
  }
}


function inferType(value: any): VariableType {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'list';
  return 'string';
}

function coerceValue(value: any, type: VariableType): VariableValue {
  switch (type) {
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
      return !!value;
    case 'number':
      if (typeof value === 'number') return value;
      const num = parseFloat(String(value));
      return isNaN(num) ? 0 : num;
    case 'list':
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return [value];
        }
      }
      return [value];
    case 'string':
    default:
      if (typeof value === 'string') return value;
      if (value == null) return '';
      return JSON.stringify(value);
  }
}

export function getVariable(name: string, defaultValue?: VariableValue, flowId?: string): VariableValue | undefined {
  // Prefer the flow-scoped key when both flowId and a scoped name are given.
  if (flowId && isScopedName(name)) {
    const scoped = variableStore.get(composeStorageKey(flowId, name));
    if (scoped) return scoped.value;
    // Fall through to legacy unscoped lookup so persistState values written
    // before flow-scoping shipped remain visible until the next initializer
    // claims them.
  }
  const entry = variableStore.get(name);
  return entry ? entry.value : defaultValue;
}

export function setVariable(name: string, value: VariableValue, type?: VariableType, flowId?: string, silent?: boolean): VariableEntry {
  const storageKey = composeStorageKey(flowId, name);
  const previousEntry = variableStore.get(storageKey);
  const previousValue = previousEntry?.value;
  const actualType = type || inferType(value);
  const coerced = coerceValue(value, actualType);
  const entry: VariableEntry = {
    value: coerced,
    type: actualType,
    updatedAt: new Date().toISOString(),
    flowId,
  };
  variableStore.set(storageKey, entry);
  // Notify listeners FIRST so custom_ui gets updates instantly,
  // then debounce the disk write (which is slow for large values like base64 frames).
  if (!silent) {
    notifyListeners(storageKey, entry, previousValue);
  }
  saveVariables();
  return entry;
}

/**
 * Register workflow variable definitions for a workflow.
 * This tracks what variables are defined for a workflow so we can validate get/set operations.
 */
export function registerWorkflowVariables(flowId: string, variables: WorkflowVariableDefinition[]): void {
  const defs = new Map<string, WorkflowVariableDefinition>();
  for (const v of variables) {
    if (v.name) {
      // Normalize type - 'json' is treated as 'string' in storage
      const storageType: VariableType = v.type === 'json' ? 'string' : (v.type as VariableType) || 'string';
      defs.set(v.name, { ...v, type: storageType });
    }
  }
  variableDefinitions.set(flowId, defs);
  console.log(`[VARS] Registered ${defs.size} variable definition(s) for workflow: ${flowId}`);
}

/**
 * Unregister workflow variable definitions when workflow is stopped/undeployed.
 */
export function unregisterWorkflowVariables(flowId: string): void {
  variableDefinitions.delete(flowId);
  console.log(`[VARS] Unregistered variable definitions for workflow: ${flowId}`);
}

/**
 * Check if a workflow variable is defined for a given workflow.
 */
export function isWorkflowVariableDefined(flowId: string, varName: string): boolean {
  const defs = variableDefinitions.get(flowId);
  return defs ? defs.has(varName) : false;
}

/**
 * Get the definition of a workflow variable.
 */
export function getWorkflowVariableDefinition(flowId: string, varName: string): WorkflowVariableDefinition | undefined {
  const defs = variableDefinitions.get(flowId);
  return defs?.get(varName);
}

/**
 * Get all workflow variable definitions for a workflow.
 */
export function getWorkflowVariableDefinitions(flowId: string): WorkflowVariableDefinition[] {
  const defs = variableDefinitions.get(flowId);
  return defs ? Array.from(defs.values()) : [];
}

/**
 * Initialize workflow variables for a workflow.
 * This is called when a workflow is deployed or started.
 * 
 * Scoping model:
 * - workflow.* = shared across all stuard files in the current workflow
 * - local.* = scoped to a single stuard file (managed at runtime, not initialized here)
 * 
 * @param flowId - The workflow ID
 * @param variables - Array of variable definitions from the workflow JSON
 * @param forceReset - If true, always reset to default values. If false, respects persistState option.
 */
export function initializeWorkflowVariables(
  flowId: string,
  variables: WorkflowVariableDefinition[],
  forceReset: boolean = false
): void {
  if (!Array.isArray(variables) || variables.length === 0) {
    console.log(`[VARS] No variables to initialize for workflow: ${flowId}`);
    return;
  }

  // First, register the variable definitions
  registerWorkflowVariables(flowId, variables);

  console.log(`[VARS] Initializing ${variables.length} variable(s) for workflow: ${flowId} (forceReset: ${forceReset})`);

  for (const v of variables) {
    if (!v.name) continue;

    const scope = v.scope || 'workflow';
    const fullName = `${scope}.${v.name}`;
    const storageKey = composeStorageKey(flowId, fullName);
    let existingEntry = variableStore.get(storageKey);
    const storageType: VariableType = v.type === 'json' ? 'string' : (v.type as VariableType) || 'string';

    // One-time migration: if this workflow declares persistState and the
    // flow-scoped key is empty, claim a legacy unscoped entry (`workflow.x`)
    // written before flow-scoping shipped. First workflow to claim wins —
    // that's acceptable since the legacy behavior was already a collision.
    if (!existingEntry && v.persistState && flowId) {
      const legacy = variableStore.get(fullName);
      if (legacy) {
        variableStore.set(storageKey, { ...legacy, flowId });
        variableStore.delete(fullName);
        existingEntry = variableStore.get(storageKey);
        console.log(`[VARS]   Migrated legacy ${fullName} → ${storageKey}`);
      }
    }

    // Determine if we should initialize this variable
    // - If forceReset is true, always reset to default
    // - If persistState is true and variable already exists, keep existing value
    // - Otherwise, initialize to default value
    const shouldReset = forceReset || !v.persistState || !existingEntry;

    if (shouldReset) {
      const value = v.defaultValue;
      setVariable(fullName, value, storageType, flowId);
      console.log(`[VARS]   Initialized ${storageKey} = ${JSON.stringify(value)} (${storageType})`);
    } else {
      console.log(`[VARS]   Preserved ${storageKey} = ${JSON.stringify(existingEntry?.value)} (persistState: true)`);
    }
  }
}

/**
 * Cleanup workflow variables when a workflow is stopped/undeployed.
 * Only removes variables that don't have persistState set.
 * Also removes all local.* variables for this workflow since they are file-scoped.
 */
export function cleanupWorkflowVariables(flowId: string): void {
  const defs = variableDefinitions.get(flowId);
  if (!defs) return;

  for (const [name, def] of defs) {
    const scope = def.scope || 'workflow';
    const fullName = `${scope}.${name}`;
    if (!def.persistState) {
      const storageKey = composeStorageKey(flowId, fullName);
      variableStore.delete(storageKey);
      console.log(`[VARS] Cleaned up non-persistent variable: ${storageKey}`);
    }
  }

  // Clean up all local.* variables associated with this workflow's flow.
  // local.* entries are flow-scoped, so their storage keys are prefixed
  // with `${flowId}::`.
  const localPrefix = `${flowId}${KEY_SEPARATOR}local.`;
  for (const [name, entry] of variableStore.entries()) {
    if (name.startsWith(localPrefix) || (name.startsWith('local.') && entry.flowId === flowId)) {
      variableStore.delete(name);
      console.log(`[VARS] Cleaned up local variable: ${name} (flowId: ${flowId})`);
    }
  }

  unregisterWorkflowVariables(flowId);
  saveVariables();
}

/**
 * Clear a flow's ephemeral `local.*` variables (keyed `${flowId}::local.*`).
 * Used when a workspace sub-function run finishes: its locals are scoped to that
 * one execId and would otherwise accumulate in the store/disk across repeated
 * calls. Deliberately never touches `workflow.*` (project-scoped) keys, which
 * are shared and outlive the sub-run.
 */
export function clearFlowLocalVariables(flowId: string): void {
  if (!flowId) return;
  const localPrefix = `${flowId}${KEY_SEPARATOR}local.`;
  let removed = 0;
  for (const [key, entry] of variableStore.entries()) {
    if (key.startsWith(localPrefix) || (entry.flowId === flowId && parseStorageKey(key).scopedName.startsWith('local.'))) {
      variableStore.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[VARS] Cleared ${removed} local variable(s) for sub-run ${flowId}`);
    saveVariables();
  }
}

