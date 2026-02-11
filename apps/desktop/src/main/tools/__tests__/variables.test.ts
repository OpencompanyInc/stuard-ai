import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSetVariable, execGetVariable, execToggleVariable, execIncrementVariable } from '../handlers/variables';
import { variableStore } from '../../workflow-variables';

// Mock workflow-variables
vi.mock('../../workflow-variables', () => {
  const store = new Map();
  return {
    variableStore: store,
    saveVariables: vi.fn(),
    setVariable: vi.fn((name, value, type, flowId) => {
      const entry = {
        value,
        type: type || 'string',
        updatedAt: new Date().toISOString(),
        flowId
      };
      store.set(name, entry);
      return entry;
    }),
    getVariable: vi.fn((name) => store.get(name)?.value),
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

  it('execSetVariable should set a variable', async () => {
    const res = await execSetVariable({ name: 'test', value: 123, type: 'number' }, mockCtx);
    expect(res.ok).toBe(true);
    expect(res.name).toBe('test');
    expect(res.value).toBe(123);
    expect(variableStore.get('test')).toBeDefined();
  });

  it('execGetVariable should return existing variable', async () => {
    variableStore.set('existing', { value: 'hello', type: 'string', updatedAt: '' });
    const res = await execGetVariable({ name: 'existing' }, mockCtx);
    expect(res.ok).toBe(true);
    expect(res.value).toBe('hello');
    expect(res.exists).toBe(true);
  });

  it('execGetVariable should return default if missing', async () => {
    const res = await execGetVariable({ name: 'missing', default: 'fallback' }, mockCtx);
    expect(res.ok).toBe(true);
    expect(res.value).toBe('fallback');
    expect(res.exists).toBe(false);
  });

  it('execToggleVariable should toggle boolean', async () => {
    variableStore.set('flag', { value: false, type: 'boolean', updatedAt: '' });
    const res = await execToggleVariable({ name: 'flag' }, mockCtx);
    expect(res.ok).toBe(true);
    expect(res.value).toBe(true);
    
    const res2 = await execToggleVariable({ name: 'flag' }, mockCtx);
    expect(res2.value).toBe(false);
  });

  it('execIncrementVariable should increment number', async () => {
    variableStore.set('counter', { value: 10, type: 'number', updatedAt: '' });
    const res = await execIncrementVariable({ name: 'counter', amount: 5 }, mockCtx);
    expect(res.ok).toBe(true);
    expect(res.value).toBe(15);
  });
});

