import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSetVariable, execGetVariable, execToggleVariable, execIncrementVariable } from '../handlers/variables';
import { variableStore } from '../../workflow-variables';

// Mock workflow-variables — re-implement the flow-scoped key composition so
// tests exercise the same isolation logic as production without pulling in
// Electron's `app` module.
vi.mock('../../workflow-variables', () => {
  const store = new Map();
  const isScoped = (n: string) => n.startsWith('workflow.') || n.startsWith('local.');
  const compose = (flowId: string | undefined, name: string) =>
    flowId && isScoped(name) ? `${flowId}::${name}` : name;
  const parse = (key: string) => {
    const idx = key.indexOf('::');
    if (idx === -1) return { scopedName: key };
    const flowId = key.slice(0, idx);
    const scopedName = key.slice(idx + 2);
    if (!isScoped(scopedName)) return { scopedName: key };
    return { flowId, scopedName };
  };
  return {
    variableStore: store,
    composeStorageKey: compose,
    parseStorageKey: parse,
    saveVariables: vi.fn(),
    setVariable: vi.fn((name: string, value: any, type: any, flowId: string | undefined) => {
      const key = compose(flowId, name);
      const entry = {
        value,
        type: type || 'string',
        updatedAt: new Date().toISOString(),
        flowId,
      };
      store.set(key, entry);
      return entry;
    }),
    getVariable: vi.fn((name: string, _def: any, flowId: string | undefined) => {
      if (flowId && isScoped(name)) {
        const scoped = store.get(compose(flowId, name));
        if (scoped) return scoped.value;
      }
      return store.get(name)?.value;
    }),
  };
});

describe('Variable Tools', () => {
  const mockCtx = {
    agentWsUrl: '',
    cloudAiUrl: '',
    logFn: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    variableStore.clear();
  });

  it('execSetVariable should set a variable under the workflow scope', async () => {
    const res = await execSetVariable({ name: 'test', value: 123, type: 'number', flowId: 'flowA' }, mockCtx);
    expect(res.ok).toBe(true);
    expect(res.name).toBe('workflow.test');
    expect(res.value).toBe(123);
    // Internal storage key is flow-scoped to prevent cross-workflow collisions.
    expect(variableStore.get('flowA::workflow.test')).toBeDefined();
  });

  it('execGetVariable should return existing variable scoped to flow', async () => {
    await execSetVariable({ name: 'existing', value: 'hello', type: 'string', flowId: 'flowA' }, mockCtx);
    const res = await execGetVariable({ name: 'existing', flowId: 'flowA' }, mockCtx);
    expect(res.ok).toBe(true);
    expect(res.value).toBe('hello');
    expect(res.exists).toBe(true);
  });

  it('execGetVariable should return default if missing', async () => {
    const res = await execGetVariable({ name: 'missing', default: 'fallback', flowId: 'flowA' }, mockCtx);
    expect(res.ok).toBe(true);
    expect(res.value).toBe('fallback');
    expect(res.exists).toBe(false);
  });

  it('execToggleVariable should toggle boolean', async () => {
    await execSetVariable({ name: 'flag', value: false, type: 'boolean', flowId: 'flowA' }, mockCtx);
    const res = await execToggleVariable({ name: 'flag', flowId: 'flowA' }, mockCtx);
    expect(res.ok).toBe(true);
    expect(res.value).toBe(true);

    const res2 = await execToggleVariable({ name: 'flag', flowId: 'flowA' }, mockCtx);
    expect(res2.value).toBe(false);
  });

  it('execIncrementVariable should increment number', async () => {
    await execSetVariable({ name: 'counter', value: 10, type: 'number', flowId: 'flowA' }, mockCtx);
    const res = await execIncrementVariable({ name: 'counter', amount: 5, flowId: 'flowA' }, mockCtx);
    expect(res.ok).toBe(true);
    expect(res.value).toBe(15);
  });

  // Regression: two workflows defining the same variable name must not collide.
  it('variables of the same name in different workflows are isolated', async () => {
    await execSetVariable({ name: 'counter', value: 10, type: 'number', flowId: 'flowA' }, mockCtx);
    await execSetVariable({ name: 'counter', value: 99, type: 'number', flowId: 'flowB' }, mockCtx);

    const a = await execGetVariable({ name: 'counter', flowId: 'flowA' }, mockCtx);
    const b = await execGetVariable({ name: 'counter', flowId: 'flowB' }, mockCtx);

    expect(a.value).toBe(10);
    expect(b.value).toBe(99);

    // Incrementing one must not affect the other.
    await execIncrementVariable({ name: 'counter', amount: 1, flowId: 'flowA' }, mockCtx);
    const a2 = await execGetVariable({ name: 'counter', flowId: 'flowA' }, mockCtx);
    const b2 = await execGetVariable({ name: 'counter', flowId: 'flowB' }, mockCtx);
    expect(a2.value).toBe(11);
    expect(b2.value).toBe(99);
  });
});
