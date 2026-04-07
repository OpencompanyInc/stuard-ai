/**
 * Execution Tools Bootstrap
 *
 * Ensures the orchestrator resolver is wired to the Stuard execution tool
 * universe without re-introducing a top-level circular import.
 */

import { hasExecutionToolsRegistered, registerExecutionTools } from './execution-tools-resolver';

let registrationPromise: Promise<void> | null = null;

export async function ensureExecutionToolsRegistered(): Promise<void> {
  if (hasExecutionToolsRegistered()) return;

  if (!registrationPromise) {
    registrationPromise = import('../agents/stuard/tools')
      .then(({ getExecutionTools }) => {
        registerExecutionTools(getExecutionTools);
      })
      .finally(() => {
        registrationPromise = null;
      });
  }

  await registrationPromise;
}
