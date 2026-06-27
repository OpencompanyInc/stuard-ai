import { describe, it, expect, beforeEach } from 'vitest';
import { workflowModifyTool, setSessionWorkflow, clearSessionWorkflow } from './workflow';
import { serializeWorkflow, parseWorkflow } from '@stuardai/workflow-core/dsl';

// A small flow: trigger → list → process, plus a "process → after" continuation
// that we'll turn into a loop body with a loopBreak exit. Exercises the two
// reliable wire-property paths the studio edit-mode depends on:
//   1. modify_workflow add_wire/update_wire (structured)
//   2. the DSL serialize→parse round-trip (edit_workflow)
function baseWorkflow() {
  return {
    id: 'flow_wires',
    name: 'Wire Flow',
    version: '1',
    triggers: [{ id: 'trig_0', type: 'manual', label: 'Manual', args: {}, position: { x: 50, y: 50 } }],
    nodes: [
      { id: 'get_list', tool: 'sql_query', label: 'List', args: {}, position: { x: 200, y: 50 } },
      { id: 'process', tool: 'log', label: 'Process', args: { message: '{{loop.item}}' }, position: { x: 400, y: 50 } },
      { id: 'after', tool: 'log', label: 'After', args: { message: 'done' }, position: { x: 600, y: 50 } },
    ],
    wires: [
      { from: 'trig_0', to: 'get_list' },
      { from: 'get_list', to: 'process' },
      { from: 'process', to: 'after' },
    ],
  };
}

async function run(input: any): Promise<any> {
  return (workflowModifyTool as any).execute(input, {});
}

const wireOf = (wf: any, from: string, to: string) =>
  wf.wires.find((w: any) => w.from === from && w.to === to);

describe('modify_workflow wire properties (loops/guards/loopBreak)', () => {
  beforeEach(() => {
    clearSessionWorkflow();
    setSessionWorkflow(baseWorkflow());
  });

  it('add_wire can create a wire WITH a forEach loop in one shot', async () => {
    // remove the plain wire first, then re-add it as a loop
    await run({ op: 'remove_wire', from: 'get_list', to: 'process' });
    const res = await run({
      op: 'add_wire',
      from: 'get_list',
      to: 'process',
      loop: { type: 'forEach', items: '{{get_list.rows}}', itemVar: 'item' },
    });
    expect(res.ok).toBe(true);
    const wire = wireOf(res.workflow, 'get_list', 'process');
    expect(wire.loop).toEqual({ type: 'forEach', items: '{{get_list.rows}}', itemVar: 'item' });
  });

  it('update_wire sets a loop on an existing wire IN PLACE', async () => {
    const res = await run({
      op: 'update_wire',
      from: 'get_list',
      to: 'process',
      loop: { type: 'forEach', items: '{{get_list.rows}}' },
    });
    expect(res.ok).toBe(true);
    expect(wireOf(res.workflow, 'get_list', 'process').loop).toEqual({ type: 'forEach', items: '{{get_list.rows}}' });
  });

  it('update_wire sets a jsonlogic guard', async () => {
    const guard = { if: { '==': [{ var: 'process.ok' }, true] } };
    const res = await run({ op: 'update_wire', from: 'process', to: 'after', guard });
    expect(res.ok).toBe(true);
    expect(wireOf(res.workflow, 'process', 'after').guard).toEqual(guard);
  });

  it('update_wire sets loopBreak + guard for a post-loop continuation', async () => {
    const res = await run({
      op: 'update_wire',
      from: 'process',
      to: 'after',
      loopBreak: true,
      guard: { if: { '==': [{ var: 'process.done' }, true] } },
    });
    expect(res.ok).toBe(true);
    const wire = wireOf(res.workflow, 'process', 'after');
    expect(wire.loopBreak).toBe(true);
    expect(wire.guard).toBeTruthy();
  });

  it('update_wire clears a property with null (loop) and leaves others untouched', async () => {
    await run({ op: 'update_wire', from: 'get_list', to: 'process', loop: { type: 'repeat', count: 3 }, label: 'keep' });
    const res = await run({ op: 'update_wire', from: 'get_list', to: 'process', loop: null });
    expect(res.ok).toBe(true);
    const wire = wireOf(res.workflow, 'get_list', 'process');
    expect(wire.loop).toBeUndefined();
    expect(wire.label).toBe('keep'); // untouched (undefined = leave alone)
  });

  it('update_wire upserts a wire that does not exist yet', async () => {
    const res = await run({
      op: 'update_wire',
      from: 'trig_0',
      to: 'after',
      guard: 'always',
    });
    expect(res.ok).toBe(true);
    expect(wireOf(res.workflow, 'trig_0', 'after')).toBeTruthy();
  });

  it('update_wire errors when no property is supplied', async () => {
    const res = await run({ op: 'update_wire', from: 'get_list', to: 'process' });
    expect(res.ok).toBe(false);
    expect(String(res.error)).toContain('at least one');
  });

  it('DSL round-trips a wire with forEach loop + guard + loopBreak losslessly (edit_workflow path)', () => {
    const wf = baseWorkflow();
    wf.wires = [
      { from: 'trig_0', to: 'get_list' },
      { from: 'get_list', to: 'process', loop: { type: 'forEach', items: '{{get_list.rows}}', itemVar: 'item', indexVar: 'index' } },
      { from: 'process', to: 'after', loopBreak: true, guard: { if: { '==': [{ var: 'process.done' }, true] } } } as any,
    ];
    const dsl = serializeWorkflow(wf, { mode: 'full' });
    // The wire properties must be visible in the DSL the model edits.
    expect(dsl).toContain('@loop');
    expect(dsl).toContain('@loopBreak');
    expect(dsl).toContain('@guard');

    const { model, errors } = parseWorkflow(dsl, wf);
    expect(errors).toEqual([]);
    const looped = wireOf(model, 'get_list', 'process');
    expect(looped.loop).toEqual({ type: 'forEach', items: '{{get_list.rows}}', itemVar: 'item', indexVar: 'index' });
    const exit = wireOf(model, 'process', 'after');
    expect(exit.loopBreak).toBe(true);
    expect(exit.guard).toEqual({ if: { '==': [{ var: 'process.done' }, true] } });
  });
});
