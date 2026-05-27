import { describe, it, expect } from 'vitest';
import {
  evaluateSafe,
  getAtPath,
  interpolateForTool,
  jsonLogic,
  evalIfGuard,
  deepMerge,
} from '@stuardai/workflow-core/runtime';

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
