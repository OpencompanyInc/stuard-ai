/**
 * Unified Tool Router - FACADE
 * 
 * This file has been refactored. Implementation is now in ./tools/
 * This file remains for backward compatibility.
 */

import { VariableValue, VariableType } from './workflow-variables';

export { VariableValue, VariableType };
export { getVariable, setVariable } from './workflow-variables';

export * from './tools/index';
