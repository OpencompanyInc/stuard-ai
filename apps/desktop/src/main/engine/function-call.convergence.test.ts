import { describe, expect, it } from 'vitest';
import { executeFromTrigger } from '@stuardai/workflow-core/runtime';

/**
 * Regression test for the call_function executor's waitForAll convergence.
 *
 * Reproduces the calorie-tracker topology that fanned a single step out to N
 * dashboard queries and joined them at a waitForAll render node. Before the fix
 * the join (and everything downstream, e.g. open_file) fired once PER incoming
 * wire — N times instead of once. We drive the SHARED core executor with a stub
 * step runner so the test covers both the desktop and VM engines.
 */

type Step = { id: string; tool?: string; waitForAll?: boolean; next?: Array<{ to: string; guard?: any }> };

function makeSpec(fanOut: number): { steps: Step[]; triggers: any[]; id: string } {
  const queries = Array.from({ length: fanOut }, (_, i) => `q${i + 1}`);
  const steps: Step[] = [
    { id: 'fan', tool: 'noop', next: queries.map(to => ({ to, guard: 'always' })) },
    ...queries.map<Step>(id => ({ id, tool: 'db_query', next: [{ to: 'join', guard: 'always' }] })),
    { id: 'join', tool: 'render', waitForAll: true, next: [{ to: 'open', guard: 'always' }] },
    { id: 'open', tool: 'open_file', next: [] },
  ];
  return {
    id: 'flow_test',
    steps,
    triggers: [{ id: 'trig', type: 'function', start: 'fan' }],
  };
}

/** Stub executeStep: count each run and route via the step's own edges. */
function stubRunner() {
  const runs = new Map<string, number>();
  const executeStep = async (spec: any, step: Step, ctx: any) => {
    runs.set(step.id, (runs.get(step.id) || 0) + 1);
    ctx[step.id] = { ok: true };
    return { ok: true, ctx, edges: step.next || [] } as any;
  };
  return { runs, executeStep };
}

describe('executeFromTrigger — waitForAll convergence', () => {
  it('runs a 6-way join (and its downstream) exactly once', async () => {
    const spec = makeSpec(6);
    const { runs, executeStep } = stubRunner();

    const out = await executeFromTrigger(spec as any, 'trig', { x: 1 }, {}, {
      logFn: () => {},
      executeStep,
    });

    expect(out.ok).toBe(true);
    // Every fan-out branch ran once.
    for (let i = 1; i <= 6; i++) expect(runs.get(`q${i}`)).toBe(1);
    // The join and everything past it ran ONCE, not once per incoming wire.
    expect(runs.get('join')).toBe(1);
    expect(runs.get('open')).toBe(1);
  });

  it('still joins correctly for a 2-way fan-in', async () => {
    const spec = makeSpec(2);
    const { runs, executeStep } = stubRunner();

    const out = await executeFromTrigger(spec as any, 'trig', {}, {}, {
      logFn: () => {},
      executeStep,
    });

    expect(out.ok).toBe(true);
    expect(runs.get('join')).toBe(1);
    expect(runs.get('open')).toBe(1);
  });

  it('does not gate a node with a single incoming wire', async () => {
    // A waitForAll node with only ONE incoming wire should run normally (no
    // convergence set is created for it), not be silently skipped.
    const steps: Step[] = [
      { id: 'a', tool: 'noop', next: [{ to: 'b', guard: 'always' }] },
      { id: 'b', tool: 'render', waitForAll: true, next: [] },
    ];
    const spec = { id: 'flow_single', steps, triggers: [{ id: 'trig', type: 'function', start: 'a' }] };
    const { runs, executeStep } = stubRunner();

    const out = await executeFromTrigger(spec as any, 'trig', {}, {}, {
      logFn: () => {},
      executeStep,
    });

    expect(out.ok).toBe(true);
    expect(runs.get('a')).toBe(1);
    expect(runs.get('b')).toBe(1);
  });
});
