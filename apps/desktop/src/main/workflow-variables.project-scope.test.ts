import { beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the REAL project-scoping logic. Only stub Electron's `app` and fs
// writes so the module loads without a desktop runtime.
vi.mock('electron', () => ({ app: { getPath: () => 'C:/tmp' } }));
vi.mock('fs', () => ({
  existsSync: () => false,
  readFileSync: () => '{}',
  writeFileSync: vi.fn(),
}));

import {
  composeStorageKey,
  registerFlowProject,
  unregisterFlowProject,
  resolveProjectId,
  clearFlowLocalVariables,
  setVariable,
  getVariable,
  variableStore,
} from './workflow-variables';

const MAIN = 'flow_project';     // the workspace / project id (main.stuard)
const SUB = 'flow_project_sub_a'; // a sibling .stuard run under a fresh execId
const SUB2 = 'flow_project_sub_b';

describe('workspace-wide (global) variable scoping', () => {
  beforeEach(() => {
    variableStore.clear();
    unregisterFlowProject(SUB);
    unregisterFlowProject(SUB2);
  });

  describe('composeStorageKey', () => {
    it('is identity-scoped with no project mapping (single-file workflow unchanged)', () => {
      expect(composeStorageKey(MAIN, 'workflow.x')).toBe('flow_project::workflow.x');
      expect(composeStorageKey(MAIN, 'local.x')).toBe('flow_project::local.x');
    });

    it('keys workflow.* off the PROJECT id once a sub-run is registered', () => {
      registerFlowProject(SUB, MAIN);
      // global → shared project namespace
      expect(composeStorageKey(SUB, 'workflow.x')).toBe('flow_project::workflow.x');
      // local → stays scoped to the sub-run's own flowId
      expect(composeStorageKey(SUB, 'local.x')).toBe('flow_project_sub_a::local.x');
    });

    it('leaves unscoped/legacy names untouched', () => {
      registerFlowProject(SUB, MAIN);
      expect(composeStorageKey(SUB, 'plain')).toBe('plain');
    });
  });

  describe('resolveProjectId', () => {
    it('returns the flow itself when unmapped (identity default)', () => {
      expect(resolveProjectId(MAIN)).toBe(MAIN);
    });

    it('resolves a registered sub-run to its project', () => {
      registerFlowProject(SUB, MAIN);
      expect(resolveProjectId(SUB)).toBe(MAIN);
    });

    it('resolves nested sub-runs transitively to the root project', () => {
      registerFlowProject(SUB, MAIN);
      registerFlowProject(SUB2, SUB); // sub-of-a-sub
      expect(resolveProjectId(SUB2)).toBe(MAIN);
    });

    it('reverts to identity after unregister', () => {
      registerFlowProject(SUB, MAIN);
      unregisterFlowProject(SUB);
      expect(resolveProjectId(SUB)).toBe(SUB);
    });
  });

  describe('end-to-end sharing across a project', () => {
    it('a sub-run reads/writes the SAME workflow.* value as main', () => {
      // main writes a global
      setVariable('workflow.counter', 10, 'number', MAIN);
      // sibling .stuard runs under its own execId, bound to the project
      registerFlowProject(SUB, MAIN);

      // sub sees main's value
      expect(getVariable('workflow.counter', undefined, SUB)).toBe(10);

      // sub updates it → main observes the change
      setVariable('workflow.counter', 42, 'number', SUB);
      expect(getVariable('workflow.counter', undefined, MAIN)).toBe(42);
    });

    it('local.* stays isolated per stuard file', () => {
      setVariable('local.tmp', 'main-only', 'string', MAIN);
      registerFlowProject(SUB, MAIN);

      // the sub does NOT see main's local var
      expect(getVariable('local.tmp', undefined, SUB)).toBeUndefined();

      // and its own local var doesn't leak back to main
      setVariable('local.tmp', 'sub-only', 'string', SUB);
      expect(getVariable('local.tmp', undefined, MAIN)).toBe('main-only');
    });

    it('two unrelated projects do not share globals', () => {
      setVariable('workflow.shared', 'A', 'string', 'project_A');
      setVariable('workflow.shared', 'B', 'string', 'project_B');
      expect(getVariable('workflow.shared', undefined, 'project_A')).toBe('A');
      expect(getVariable('workflow.shared', undefined, 'project_B')).toBe('B');
    });
  });

  describe('clearFlowLocalVariables', () => {
    it("drops a sub-run's local.* vars but preserves project workflow.* vars", () => {
      setVariable('workflow.keep', 'persist', 'string', MAIN);
      registerFlowProject(SUB, MAIN);
      setVariable('workflow.keep', 'updated', 'string', SUB); // writes to project key
      setVariable('local.scratch', 'ephemeral', 'string', SUB);

      expect(variableStore.has('flow_project_sub_a::local.scratch')).toBe(true);

      clearFlowLocalVariables(SUB);

      // local gone, shared global survives with the sub's update
      expect(variableStore.has('flow_project_sub_a::local.scratch')).toBe(false);
      expect(getVariable('workflow.keep', undefined, MAIN)).toBe('updated');
    });
  });
});
