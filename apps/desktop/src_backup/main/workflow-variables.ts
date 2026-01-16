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
  defaultValue: any;
  description?: string;
  persistState?: boolean;
}

/** Registry of workflow variable definitions by flowId */
const variableDefinitions = new Map<string, Map<string, WorkflowVariableDefinition>>();

export const variableStore = new Map<string, VariableEntry>();
const VARIABLES_FILE = path.join(app.getPath('userData'), 'workflow-variables.json');

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

export function saveVariables(): void {
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

export function getVariable(name: string, defaultValue?: VariableValue): VariableValue | undefined {
  const entry = variableStore.get(name);
  return entry ? entry.value : defaultValue;
}

export function setVariable(name: string, value: VariableValue, type?: VariableType, flowId?: string): VariableEntry {
  const actualType = type || inferType(value);
  const coerced = coerceValue(value, actualType);
  const entry: VariableEntry = {
    value: coerced,
    type: actualType,
    updatedAt: new Date().toISOString(),
    flowId,
  };
  variableStore.set(name, entry);
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

    const fullName = `workflow.${v.name}`;
    const existingEntry = variableStore.get(fullName);
    const storageType: VariableType = v.type === 'json' ? 'string' : (v.type as VariableType) || 'string';

    // Determine if we should initialize this variable
    // - If forceReset is true, always reset to default
    // - If persistState is true and variable already exists, keep existing value
    // - Otherwise, initialize to default value
    const shouldReset = forceReset || !v.persistState || !existingEntry;

    if (shouldReset) {
      const value = v.defaultValue;
      setVariable(fullName, value, storageType, flowId);
      console.log(`[VARS]   Initialized ${fullName} = ${JSON.stringify(value)} (${storageType})`);
    } else {
      console.log(`[VARS]   Preserved ${fullName} = ${JSON.stringify(existingEntry?.value)} (persistState: true)`);
    }
  }
}

/**
 * Cleanup workflow variables when a workflow is stopped/undeployed.
 * Only removes variables that don't have persistState set.
 */
export function cleanupWorkflowVariables(flowId: string): void {
  const defs = variableDefinitions.get(flowId);
  if (!defs) return;

  for (const [name, def] of defs) {
    const fullName = `workflow.${name}`;
    if (!def.persistState) {
      variableStore.delete(fullName);
      console.log(`[VARS] Cleaned up non-persistent variable: ${fullName}`);
    }
  }

  unregisterWorkflowVariables(flowId);
  saveVariables();
}

