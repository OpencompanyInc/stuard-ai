import { describe, it, expect, beforeEach } from 'vitest';
import { workflowModifyTool, setSessionWorkflow, clearSessionWorkflow } from './workflow';

const COMPONENT = "function App() {\n  const [count] = useVar('count', 0);\n  return <h1 className='p-6'>Count: {count}</h1>;\n}";

function baseWorkflow() {
  return {
    id: 'flow_test',
    name: 'Test Flow',
    version: '1',
    triggers: [{ id: 'trig_0', type: 'manual', label: 'Manual', args: {}, position: { x: 50, y: 50 } }],
    nodes: [
      {
        id: 'ui',
        tool: 'custom_ui',
        label: 'UI',
        args: { id: 'win', title: 'Hello', component: COMPONENT },
        position: { x: 200, y: 50 },
      },
      {
        id: 'log_1',
        tool: 'log',
        label: 'Log',
        args: { message: 'Count: starting' },
        position: { x: 400, y: 50 },
      },
    ],
    wires: [{ from: 'trig_0', to: 'ui' }, { from: 'ui', to: 'log_1' }],
  };
}

async function run(input: any): Promise<any> {
  return (workflowModifyTool as any).execute(input, {});
}

describe('modify_workflow edit_node_text', () => {
  beforeEach(() => {
    clearSessionWorkflow();
    setSessionWorkflow(baseWorkflow());
  });

  it('replaces a unique string without an explicit path', async () => {
    const res = await run({
      op: 'edit_node_text',
      nodeId: 'ui',
      old_string: "<h1 className='p-6'>Count: {count}</h1>",
      new_string: "<h2 className='p-4'>Total: {count}</h2>",
    });
    expect(res.ok).toBe(true);
    const node = res.workflow.nodes.find((n: any) => n.id === 'ui');
    expect(node.args.component).toContain("<h2 className='p-4'>Total: {count}</h2>");
    expect(node.args.component).not.toContain('<h1');
    // Rest of the component is untouched.
    expect(node.args.component).toContain("useVar('count', 0)");
  });

  it('errors when old_string matches multiple fields and no path is given', async () => {
    // "Count: " appears in ui.args.component? No — scope is per node, so use
    // a node where two of its own fields match.
    setSessionWorkflow({
      ...baseWorkflow(),
      nodes: [{
        id: 'dup', tool: 'log', label: 'Dup',
        args: { message: 'hello world', title: 'hello there' },
        position: { x: 1, y: 1 },
      }],
      wires: [],
    });
    const res = await run({ op: 'edit_node_text', nodeId: 'dup', old_string: 'hello', new_string: 'hi' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('multiple fields');
    expect(res.error).toContain('args.message');
    expect(res.error).toContain('args.title');
  });

  it('disambiguates with an explicit path', async () => {
    setSessionWorkflow({
      ...baseWorkflow(),
      nodes: [{
        id: 'dup', tool: 'log', label: 'Dup',
        args: { message: 'hello world', title: 'hello there' },
        position: { x: 1, y: 1 },
      }],
      wires: [],
    });
    const res = await run({ op: 'edit_node_text', nodeId: 'dup', path: 'args.title', old_string: 'hello', new_string: 'hi' });
    expect(res.ok).toBe(true);
    const node = res.workflow.nodes.find((n: any) => n.id === 'dup');
    expect(node.args.title).toBe('hi there');
    expect(node.args.message).toBe('hello world');
  });

  it('errors on multiple occurrences unless replace_all', async () => {
    const failing = await run({ op: 'edit_node_text', nodeId: 'ui', old_string: 'count', new_string: 'total' });
    expect(failing.ok).toBe(false);
    expect(failing.error).toContain('replace_all');

    setSessionWorkflow(baseWorkflow());
    const res = await run({ op: 'edit_node_text', nodeId: 'ui', old_string: 'count', new_string: 'total', replace_all: true });
    expect(res.ok).toBe(true);
    const node = res.workflow.nodes.find((n: any) => n.id === 'ui');
    expect(node.args.component).not.toContain('count');
  });

  it('errors clearly when old_string is not found', async () => {
    const res = await run({ op: 'edit_node_text', nodeId: 'ui', old_string: 'no-such-text', new_string: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('not found');
  });

  it('normalizes bare paths under args', async () => {
    const res = await run({ op: 'edit_node_text', nodeId: 'log_1', path: 'message', old_string: 'starting', new_string: 'done' });
    expect(res.ok).toBe(true);
    const node = res.workflow.nodes.find((n: any) => n.id === 'log_1');
    expect(node.args.message).toBe('Count: done');
  });

  it('omits the model diagram for arg-only edits but includes it for structural ones', async () => {
    const argEdit = await run({ op: 'edit_node_text', nodeId: 'log_1', old_string: 'starting', new_string: 'done' });
    expect(argEdit.ok).toBe(true);
    expect(argEdit.diagram).toBeUndefined();

    const structural = await run({ op: 'add_node', tool: 'log', args: { message: 'new' }, connectFrom: 'log_1' });
    expect(structural.ok).toBe(true);
    expect(typeof structural.diagram).toBe('string');
    expect(structural.diagram).toContain('WORKFLOW SCHEMATIC');
  });
});
