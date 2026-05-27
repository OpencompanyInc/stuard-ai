import { describe, it, expect } from 'vitest';
import {
  evaluateSafe,
  getAtPath,
  interpolateForTool,
  jsonLogic,
  evalIfGuard,
  deepMerge,
  decideNext,
  isCatchAllGuard,
  type StuardStep,
  type StuardSpec,
} from '@stuardai/workflow-core/runtime';

const SPEC: StuardSpec = { id: 'wf', steps: [] };
const noAi = async () => ({ ok: false, error: 'no_ai' });
const hooks = (over: Partial<Parameters<typeof decideNext>[3]> = {}) => ({
  logFn: () => {},
  aiDecideNext: noAi,
  ...over,
});
const step = (next: any[]): StuardStep => ({ id: 's', tool: 'noop', next });

/**
 * Locks the behavior of the shared workflow runtime that the VM engine now
 * consumes (previously hand-ported inline). These also encode the parity
 * contract with the desktop engine — both import the same module.
 */

describe('evaluateSafe (recursive-descent parser)', () => {
  it('honors arithmetic precedence', () => {
    expect(evaluateSafe('2 + 3 * 4', {})).toBe(14);
  });
  it('honors parentheses', () => {
    expect(evaluateSafe('(2 + 3) * 4', {})).toBe(20);
  });
  it('evaluates comparisons + logical ops', () => {
    expect(evaluateSafe('5 > 3 && 1 < 2', {})).toBe(true);
    expect(evaluateSafe('5 < 3 || 2 == 2', {})).toBe(true);
  });
  it('resolves variables and $vars proxy', () => {
    expect(evaluateSafe('a == 1', { a: 1 })).toBe(true);
    expect(evaluateSafe('$vars.x > 4', { $vars: { x: 5 } })).toBe(true);
  });
});

describe('getAtPath', () => {
  it('resolves nested + bracket paths', () => {
    expect(getAtPath({ a: { b: [10, 20] } }, 'a.b[1]')).toBe(20);
  });
  it('supports array first/last/count accessors', () => {
    expect(getAtPath({ a: { b: [10, 20] } }, 'a.b.first')).toBe(10);
    expect(getAtPath({ a: { b: [10, 20] } }, 'a.b.last')).toBe(20);
    expect(getAtPath({ a: { b: [10, 20] } }, 'a.b.count')).toBe(2);
  });
  it('matches step IDs that contain dots', () => {
    expect(getAtPath({ 'local.t1': { ok: true } }, 'local.t1.ok')).toBe(true);
  });
  it('reads $vars from the ctx proxy (VM mode — no resolver)', () => {
    expect(getAtPath({ $vars: { count: 7 } }, '$vars.count')).toBe(7);
  });
  it('auto-parses JSON-string fields during traversal', () => {
    expect(getAtPath({ step: { stdout: '{"k":42}' } }, 'step.stdout.k')).toBe(42);
  });
  it('returns the default when missing', () => {
    expect(getAtPath({}, 'a.b.c', 'fallback')).toBe('fallback');
  });
});

describe('jsonLogic (richer desktop semantics)', () => {
  it('evaluates var/comparison', () => {
    expect(jsonLogic({ '==': [{ var: 'a' }, 1] }, { a: 1 })).toBe(true);
    expect(jsonLogic({ '>': [{ var: 'n' }, 5] }, { n: 10 })).toBe(true);
  });
  it('supports empty / not_empty', () => {
    expect(jsonLogic({ empty: [{ var: 'x' }] }, {})).toBe(true);
    expect(jsonLogic({ not_empty: [{ var: 's' }] }, { s: '' })).toBe(false);
    expect(jsonLogic({ not_empty: [{ var: 's' }] }, { s: 'hi' })).toBe(true);
  });
  it('coerces null/undefined against booleans', () => {
    expect(jsonLogic({ '==': [{ var: 'missing' }, false] }, {})).toBe(true);
    expect(jsonLogic({ '==': [{ var: 'missing' }, true] }, {})).toBe(false);
  });
  it('supports in for strings and arrays', () => {
    expect(jsonLogic({ in: ['b', ['a', 'b']] }, {})).toBe(true);
    expect(jsonLogic({ in: ['ell', 'hello'] }, {})).toBe(true);
  });
});

describe('interpolateForTool', () => {
  it('preserves type for a whole-string single expression', () => {
    expect(interpolateForTool('{{a.b}}', { a: { b: { x: 1 } } }, 'log')).toEqual({ x: 1 });
  });
  it('stringifies inline interpolation', () => {
    expect(interpolateForTool('val={{n}}', { n: 3 }, 'log')).toBe('val=3');
  });
  it('renders Python literals for run_python_script code', () => {
    const out = interpolateForTool({ code: 'flag = {{f}}\nval = {{n}}' }, { f: true, n: null }, 'run_python_script');
    expect(out.code).toBe('flag = True\nval = None');
  });
  it('preserves a whole-string unresolved template for any tool (passthrough)', () => {
    expect(interpolateForTool('{{missing}}', {}, 'log')).toBe('{{missing}}');
  });
  it('preserves embedded unmatched tags for custom_ui but blanks them elsewhere', () => {
    expect(interpolateForTool('x={{missing}}', {}, 'custom_ui')).toBe('x={{missing}}');
    expect(interpolateForTool('x={{missing}}', {}, 'log')).toBe('x=');
  });
});

describe('evalIfGuard', () => {
  it('evaluates string expressions', () => {
    expect(evalIfGuard('a == 1', { a: 1 })).toBe(true);
    expect(evalIfGuard('{{ok}}', { ok: true })).toBe(true);
  });
  it('evaluates JSONLogic objects', () => {
    expect(evalIfGuard({ '>': [{ var: 'n' }, 5] }, { n: 10 })).toBe(true);
    expect(evalIfGuard({ '>': [{ var: 'n' }, 5] }, { n: 1 })).toBe(false);
  });
});

describe('deepMerge', () => {
  it('merges nested objects and replaces arrays', () => {
    expect(deepMerge({ a: { x: 1 }, list: [1, 2] }, { a: { y: 2 }, list: [9] }))
      .toEqual({ a: { x: 1, y: 2 }, list: [9] });
  });
});

describe('decideNext (shared edge-selection — canonical desktop semantics)', () => {
  const tos = (r: { edges: Array<{ to: string }> }) => r.edges.map(e => e.to);

  it('classifies catch-all guards', () => {
    expect(isCatchAllGuard(undefined)).toBe(true);
    expect(isCatchAllGuard('always')).toBe(true);
    expect(isCatchAllGuard({ if: true })).toBe(true);
    expect(isCatchAllGuard({ if: { '==': [1, 1] } })).toBe(false);
  });

  it('always includes stream edges in parallel with flow edges', async () => {
    const r = await decideNext(SPEC, step([
      { to: 'consumer', stream: { sourceField: 'out' } },
      { to: 'next' },
    ]), {}, hooks());
    expect(tos(r).sort()).toEqual(['consumer', 'next']);
  });

  it('is first-match-wins for conditionals, and always-edges still fire', async () => {
    const r = await decideNext(SPEC, step([
      { to: 'a', guard: { if: { '==': [{ var: 'x' }, 1] } } },
      { to: 'b', guard: { if: { '==': [{ var: 'x' }, 1] } } }, // also true, but skipped (first wins)
      { to: 'sideEffect' }, // always — fires regardless
    ]), { x: 1 }, hooks());
    expect(tos(r)).toEqual(['a', 'sideEffect']);
  });

  it('prioritizes a loop edge among multiple unconditional edges', async () => {
    const r = await decideNext(SPEC, step([
      { to: 'body', loop: { type: 'forEach', items: '{{items}}' } },
      { to: 'after', loopBreak: true },
    ]), {}, hooks());
    expect(tos(r)).toEqual(['body']);
  });

  it('runs multiple plain unconditional edges in parallel', async () => {
    const r = await decideNext(SPEC, step([{ to: 'a' }, { to: 'b' }]), {}, hooks());
    expect(tos(r).sort()).toEqual(['a', 'b']);
  });

  it('falls back to step.fallback when nothing matches', async () => {
    const s = { ...step([{ to: 'a', guard: { if: { '==': [{ var: 'x' }, 99] } } }]), fallback: { to: 'fb' } };
    const r = await decideNext(SPEC, s, { x: 1 }, hooks());
    expect(tos(r)).toEqual(['fb']);
  });

  it('AI routing picks one target and applies argsPatch', async () => {
    const ctx: any = {};
    const r = await decideNext(SPEC, step([
      { to: 'a', guard: { ai: { instruction: 'pick' } } },
      { to: 'b', guard: { ai: { instruction: 'pick' } } },
    ]), ctx, hooks({
      aiDecideNext: async () => ({ ok: true, next: 'b', argsPatch: { tone: 'warm' } }),
    }));
    expect(tos(r)).toEqual(['b']);
    expect(ctx.__argsPatch.b).toEqual({ tone: 'warm' });
  });

  it('AI routing failure uses fallback when present', async () => {
    const s = { ...step([{ to: 'a', guard: { ai: {} } }]), fallback: { to: 'fb' } };
    const r = await decideNext(SPEC, s, {}, hooks({ aiDecideNext: async () => ({ ok: false, error: 'boom' }) }));
    expect(r.ok).toBe(true);
    expect(tos(r)).toEqual(['fb']);
  });

  it('AI routing failure with no fallback returns ok:false', async () => {
    const r = await decideNext(SPEC, step([{ to: 'a', guard: { ai: {} } }]), {}, hooks({
      aiDecideNext: async () => ({ ok: false, error: 'boom' }),
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('boom');
  });
});
