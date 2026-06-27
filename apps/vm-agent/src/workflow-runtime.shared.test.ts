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
  designerModelToStuardSpec,
  sanitizeGuard,
  executeLoop,
  executeStep,
  type StuardStep,
  type StuardSpec,
  type RunChainResult,
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

describe('sanitizeGuard', () => {
  it('strips LLM double-quoting from operator keys, recursively', () => {
    expect(sanitizeGuard({ '"=="': [{ '"var"': 'x' }, 1] })).toEqual({ '==': [{ var: 'x' }, 1] });
  });
  it('passes through "always" and primitives', () => {
    expect(sanitizeGuard('always')).toBe('always');
    expect(sanitizeGuard(5 as any)).toBe(5);
  });
});

describe('designerModelToStuardSpec', () => {
  it('converts nodes+wires to steps with normalized guards', () => {
    const model = {
      id: 'wf1', name: 'Test', version: '2',
      nodes: [
        { id: 'a', tool: 'log', args: { msg: 'hi' } },
        { id: 'b', tool: 'noop' },
      ],
      wires: [
        { from: 'a', to: 'b' }, // no guard → 'always'
      ],
      triggers: [],
    };
    const spec = designerModelToStuardSpec(model);
    expect(spec.id).toBe('wf1');
    expect(spec.version).toBe('2');
    expect(spec.steps?.find(s => s.id === 'a')?.next?.[0]).toEqual({ to: 'b', guard: 'always' });
    // no inbound wire → 'a' is the start
    expect(spec.start).toBe('a');
  });

  it('wraps raw JSONLogic guards in {if} and treats {===:[true,true]} as always', () => {
    const model = {
      id: 'g', nodes: [{ id: 'a', tool: 'noop' }, { id: 'b', tool: 'noop' }, { id: 'c', tool: 'noop' }],
      wires: [
        { from: 'a', to: 'b', guard: { '==': [{ var: 'x' }, 1] } },
        { from: 'a', to: 'c', guard: { '===': [true, true] } },
      ],
      triggers: [],
    };
    const a = designerModelToStuardSpec(model).steps!.find(s => s.id === 'a')!;
    expect(a.next!.find(e => e.to === 'b')!.guard).toEqual({ if: { '==': [{ var: 'x' }, 1] } });
    expect(a.next!.find(e => e.to === 'c')!.guard).toBe('always');
  });

  it('carries loop, loopBreak, and stream edge config through', () => {
    const model = {
      id: 'l', nodes: [{ id: 'a', tool: 'noop' }, { id: 'b', tool: 'noop' }],
      wires: [{ from: 'a', to: 'b', loop: { type: 'forEach', items: '{{xs}}' }, loopBreak: true, stream: { sourceField: 'sid' } }],
      triggers: [],
    };
    const e = designerModelToStuardSpec(model).steps!.find(s => s.id === 'a')!.next![0];
    expect(e.loop).toMatchObject({ type: 'forEach', items: '{{xs}}', itemVar: 'item', maxIterations: 100 });
    expect(e.loopBreak).toBe(true);
    expect(e.stream).toMatchObject({ sourceField: 'sid', mode: 'reactive' });
  });

  it('creates a synthetic parallel start when a trigger fans out', () => {
    const model = {
      id: 't',
      nodes: [{ id: 'x', tool: 'noop' }, { id: 'y', tool: 'noop' }],
      wires: [{ from: 'trig1', to: 'x' }, { from: 'trig1', to: 'y' }],
      triggers: [{ id: 'trig1', type: 'manual' }],
    };
    const spec = designerModelToStuardSpec(model, { triggerId: 'trig1' });
    expect(spec.start).toBe('_trigger_parallel_start');
    const synth = spec.steps!.find(s => s.id === '_trigger_parallel_start')!;
    expect(synth.next!.map(e => e.to).sort()).toEqual(['x', 'y']);
  });

  it('desktop mode respects model.autostart and adds no kind', () => {
    const model = { id: 'k', nodes: [{ id: 'a', tool: 'web_search', type: 'cloud.tool' }], wires: [], triggers: [], autostart: true };
    const spec = designerModelToStuardSpec(model);
    expect(spec.autostart).toBe(true);
    expect((spec.steps![0] as any).kind).toBeUndefined();
    expect((spec.steps![0] as any).designerType).toBeUndefined();
  });

  it('VM mode injects normalizeKind + forces autostart false', () => {
    const model = { id: 'k', nodes: [{ id: 'a', tool: 'web_search', type: 'cloud.tool' }], wires: [], triggers: [], autostart: true };
    const spec = designerModelToStuardSpec(model, {
      normalizeKind: (v: any) => (v === 'cloud.tool' ? 'cloud' : undefined),
      autostart: false,
    });
    expect(spec.autostart).toBe(false);
    expect((spec.steps![0] as any).kind).toBe('cloud');
    expect((spec.steps![0] as any).designerType).toBe('cloud.tool');
  });
});

describe('executeLoop (shared driver — desktop semantics)', () => {
  const body: StuardStep = { id: 'body', tool: 'noop', next: [] };
  const loopHooks = (runChain: (s: StuardStep, c: any) => Promise<RunChainResult>) => ({
    logFn: () => {},
    isAborted: () => false,
    runChain,
  });

  it('forEach iterates over every resolved item and sets loop context', async () => {
    const seen: Array<{ item: any; index: any }> = [];
    const ctx: any = { src: { list: ['a', 'b', 'c'] } };
    await executeLoop(
      body, ctx,
      { type: 'forEach', items: '{{src.list}}' },
      new Map(), 'prev',
      loopHooks(async (_s, c) => { seen.push({ item: c.loop.item, index: c.loop.index }); c[body.id] = c.loop.item; return { ok: true }; }),
    );
    expect(seen).toEqual([{ item: 'a', index: 0 }, { item: 'b', index: 1 }, { item: 'c', index: 2 }]);
    // loop context cleaned up; last item exposed as the step's value
    expect(ctx.loop).toBeUndefined();
    expect(ctx.body).toBe('c');
    expect(ctx.body_loop_results).toEqual(['a', 'b', 'c']);
  });

  it('does NOT expose top-level item/index/$loop (desktop shape only)', async () => {
    const ctx: any = {};
    let snapshot: any = {};
    await executeLoop(
      body, ctx, { type: 'forEach', items: '["x"]' }, new Map(), 'p',
      loopHooks(async (_s, c) => { snapshot = { item: c.item, index: c.index, $loop: c.$loop, loopItem: c.loop.item }; return { ok: true }; }),
    );
    expect(snapshot.loopItem).toBe('x');     // ctx.loop.item present
    expect(snapshot.item).toBeUndefined();   // no top-level item
    expect(snapshot.index).toBeUndefined();  // no top-level index
    expect(snapshot.$loop).toBeUndefined();  // no $loop
  });

  it('repeat runs N times and exposes only index', async () => {
    const indices: any[] = [];
    await executeLoop(
      body, {}, { type: 'repeat', count: 3 }, new Map(), 'p',
      loopHooks(async (_s, c) => { indices.push(c.loop.index); expect(c.loop.item).toBeUndefined(); return { ok: true }; }),
    );
    expect(indices).toEqual([0, 1, 2]);
  });

  it('while runs until the condition goes false', async () => {
    const ctx: any = { n: 0 };
    let calls = 0;
    await executeLoop(
      body, ctx, { type: 'while', conditionText: 'n < 3' }, new Map(), 'p',
      loopHooks(async (_s, c) => { calls++; c.n = c.n + 1; return { ok: true }; }),
    );
    expect(calls).toBe(3);
    expect(ctx.n).toBe(3);
  });

  it('honors maxIterations as a safety cap', async () => {
    let calls = 0;
    await executeLoop(
      body, {}, { type: 'while', conditionText: 'true', maxIterations: 5 }, new Map(), 'p',
      loopHooks(async () => { calls++; return { ok: true }; }),
    );
    expect(calls).toBe(5);
  });

  it('a mid-body loopBreak is the post-loop continuation, NOT an early exit (desktop semantics)', async () => {
    let calls = 0;
    const res = await executeLoop(
      body, {}, { type: 'forEach', items: '[1,2,3]' }, new Map(), 'p',
      loopHooks(async () => { calls++; return { ok: true, breakEdge: { to: 'after' } }; }),
    );
    expect(calls).toBe(3);                 // ran ALL iterations (no early exit)
    expect(res.breakEdge).toEqual({ to: 'after' }); // continuation captured
  });

  it('source-step loopBreak edge is used as continuation even with zero iterations', async () => {
    const map = new Map<string, StuardStep>([
      ['prev', { id: 'prev', tool: 'noop', next: [{ to: 'body' }, { to: 'after', loopBreak: true }] }],
    ]);
    const res = await executeLoop(
      body, {}, { type: 'forEach', items: '[]' }, map, 'prev',
      loopHooks(async () => ({ ok: true })),
    );
    expect(res.breakEdge).toEqual({ to: 'after' });
  });

  it('stops iterating when an iteration fails', async () => {
    let calls = 0;
    await executeLoop(
      body, {}, { type: 'forEach', items: '[1,2,3]' }, new Map(), 'p',
      loopHooks(async () => { calls++; return calls === 2 ? { ok: false, error: 'boom' } : { ok: true }; }),
    );
    expect(calls).toBe(2); // stopped after the failing iteration
  });
});

describe('executeStep (shared skeleton — desktop terminate semantics)', () => {
  const stepHooks = (dispatchTool: (sp: any, st: any, a: any, c: any, t: string) => Promise<any>) => ({
    logFn: () => {},
    dispatchTool,
    aiDecideNext: async () => ({ ok: false, error: 'no_ai' }),
  });
  const mkStep = (over: Partial<StuardStep> = {}): StuardStep => ({ id: 's', tool: 'noop', next: [], ...over });

  it('interpolates args before dispatch and stores the result in ctx[stepId]', async () => {
    let receivedArgs: any;
    const ctx: any = { src: { name: 'Ada' } };
    const step = mkStep({ id: 'greet', tool: 'log', args: { msg: 'hi {{src.name}}' }, next: [] });
    await executeStep(SPEC, step, ctx, stepHooks(async (_sp, _st, args) => { receivedArgs = args; return { ok: true, echoed: args.msg }; }));
    expect(receivedArgs.msg).toBe('hi Ada');
    expect(ctx.greet).toEqual({ ok: true, echoed: 'hi Ada' });
  });

  it('return_value records ctx.__return but does NOT set ctx.__terminated (desktop semantics)', async () => {
    const ctx: any = {};
    const step = mkStep({ id: 'r', tool: 'return_value', next: [] });
    const out = await executeStep(SPEC, step, ctx, stepHooks(async () => ({ ok: true, action: 'return', value: 42 })));
    expect(ctx.__return).toBe(42);
    expect(ctx.__terminated).toBeUndefined();
    expect(out.ok).toBe(true);
  });

  it('a result with terminated (or the end tool) sets __terminated and ends the branch', async () => {
    const ctx: any = {};
    const out = await executeStep(SPEC, mkStep({ tool: 'end' }), ctx, stepHooks(async () => ({ ok: true, terminated: true })));
    expect(ctx.__terminated).toBe(true);
    expect(out.edges).toEqual([]);
  });

  it('propagates dispatch failure', async () => {
    const out = await executeStep(SPEC, mkStep({ tool: 'http_request' }), {}, stepHooks(async () => ({ ok: false, error: 'network' })));
    expect(out.ok).toBe(false);
    expect(out.error).toBe('network');
  });

  it('custom_ui timeout/closed is NOT treated as a failure', async () => {
    const out = await executeStep(SPEC, mkStep({ tool: 'custom_ui' }), {}, stepHooks(async () => ({ ok: false, action: 'timeout' })));
    expect(out.ok).toBe(true);
  });

  it('derives legacy nextId/loop fields from the chosen edges', async () => {
    const step = mkStep({ id: 'a', tool: 'noop', next: [{ to: 'b' }] });
    const out = await executeStep(SPEC, step, {}, stepHooks(async () => ({ ok: true })));
    expect(out.edges.map(e => e.to)).toEqual(['b']);
    expect(out.nextId).toBe('b');
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
