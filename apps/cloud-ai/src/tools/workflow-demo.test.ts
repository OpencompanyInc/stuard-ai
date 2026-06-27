/**
 * End-to-end workflow tooling tests built around REALISTIC demo workflows.
 *
 * Exercises the full agent-facing surface against a fake desktop bridge:
 *  - create_workflow (one-shot spec + persistence via import_workflow)
 *  - modify_workflow: batch ops, every op type, edit_node_text, partial
 *    failure, nodeIssues validation, slim model-facing results
 *  - inspect_workflow: overview / node_flow / trigger_flow / wire
 *  - sub-workflow (.stuard) targeting: inspect + modify + write-back,
 *    main-session isolation, and every error path
 *  - load_workflow / execute_step plumbing
 *
 * The bridge mock is a partial mock: only hasClientBridge/execLocalTool are
 * faked (an in-memory "desktop" with a workspace file system); everything
 * else in bridge.ts stays real so session/ALS behavior matches production.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const fakeDesktop = vi.hoisted(() => {
  const state = {
    connected: true,
    /** workspace-relative path → file content (workspace_read_file) */
    workspaceFiles: new Map<string, string>(),
    /** absolute path → content written via write_file */
    writes: new Map<string, string>(),
    /** workflowId → saved workflow (read_local_workflow) */
    savedWorkflows: new Map<string, any>(),
    /** specs persisted via import_workflow */
    imported: [] as any[],
    /** every execLocalTool invocation, for plumbing assertions */
    calls: [] as Array<{ tool: string; args: any }>,
  };

  const exec = async (tool: string, args: any) => {
    state.calls.push({ tool, args });
    switch (tool) {
      case 'workspace_read_file': {
        const content = state.workspaceFiles.get(String(args?.path || ''));
        return content !== undefined
          ? { ok: true, content }
          : { ok: false, error: `File not found: ${args?.path}` };
      }
      case 'write_file': {
        state.writes.set(String(args?.path || ''), String(args?.content ?? ''));
        return { ok: true };
      }
      case 'import_workflow': {
        state.imported.push(args?.definition);
        return { ok: true };
      }
      case 'read_local_workflow': {
        const model = state.savedWorkflows.get(String(args?.workflowId || ''));
        return model ? { ok: true, model } : { ok: false, error: `Workflow not found: ${args?.workflowId}` };
      }
      default:
        return { ok: true, tool, echo: args };
    }
  };

  return { state, exec };
});

vi.mock('./bridge', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    hasClientBridge: () => fakeDesktop.state.connected,
    execLocalTool: (tool: string, args: any) => fakeDesktop.exec(tool, args),
  };
});

import {
  workflowModifyTool,
  setSessionWorkflow,
  getSessionWorkflow,
  clearSessionWorkflow,
  setWorkflowWorkspacePath,
} from './workflow';
import { createWorkflowTool } from './workflow-system';
import { inspectWorkflow, loadWorkflow, executeStep } from '../agents/workflow-agent/tools';

const WORKSPACE = 'C:/ws/flow_morning_brief';
const SUB_FILE = 'helpers/send-email.stuard';

const UI_COMPONENT =
  "function App() {\n" +
  "  const [brief] = useVar('brief', '');\n" +
  "  const [status] = useVar('status', 'Loading…');\n" +
  "  return (\n" +
  "    <div className='p-6 space-y-4'>\n" +
  "      <h1 className='text-xl font-bold'>Morning Brief</h1>\n" +
  "      <div>{status}</div>\n" +
  "      <Markdown remarkPlugins={[remarkGfm]}>{brief}</Markdown>\n" +
  "      <button onClick={() => stuard.submit({ read: true })}>Done</button>\n" +
  "    </div>\n" +
  "  );\n" +
  "}";

/** Demo sub-workflow: a reusable send-email function with a typed return. */
function sendEmailSubWorkflow() {
  return {
    id: 'flow_send_email',
    name: 'Send Email Helper',
    version: '1',
    triggers: [
      {
        id: 'fn_trig',
        type: 'function',
        label: 'Send Email Fn',
        args: { inputParams: [
          { name: 'to', type: 'string', required: true },
          { name: 'body', type: 'string', required: true },
        ] },
        position: { x: 50, y: 50 },
      },
    ],
    nodes: [
      {
        id: 'compose',
        tool: 'ai_inference',
        label: 'Compose',
        args: { prompt: 'Write a short professional email saying: {{args.body}}', model: 'fast' },
        position: { x: 250, y: 50 },
      },
      {
        id: 'ret',
        tool: 'call_function',
        label: 'Return',
        args: { triggerId: 'noop', inputs: {} },
        position: { x: 450, y: 50 },
      },
    ],
    wires: [
      { from: 'fn_trig', to: 'compose' },
      { from: 'compose', to: 'ret' },
    ],
  };
}

async function modify(input: any): Promise<any> {
  return (workflowModifyTool as any).execute(input, {});
}
async function inspect(input: any): Promise<any> {
  return (inspectWorkflow as any).execute(
    { nodeId: null, triggerId: null, from: null, to: null, index: null, stuardFile: null, ...input },
    {},
  );
}

beforeEach(() => {
  clearSessionWorkflow();
  fakeDesktop.state.connected = true;
  fakeDesktop.state.workspaceFiles.clear();
  fakeDesktop.state.writes.clear();
  fakeDesktop.state.savedWorkflows.clear();
  fakeDesktop.state.imported.length = 0;
  fakeDesktop.state.calls.length = 0;
});

// ─────────────────────────────────────────────────────────────────────────────
// Sub-workflow error paths FIRST — the workspace-path registry is module-level
// and append-only, so the "no workspace registered" case must run before any
// test registers one.
// ─────────────────────────────────────────────────────────────────────────────

describe('sub-workflow (.stuard) error paths', () => {
  it('fails cleanly when no workspace path is registered for the session', async () => {
    setSessionWorkflow({ id: 'flow_unregistered', name: 'X', triggers: [], nodes: [], wires: [] });
    const res = await modify({ op: 'rename', name: 'Y', stuardFile: SUB_FILE });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Workspace path unknown');
    // Main workflow untouched.
    expect(getSessionWorkflow()?.name).toBe('X');
  });

  it('rejects path traversal in stuardFile', async () => {
    setWorkflowWorkspacePath('flow_morning_brief', WORKSPACE);
    setSessionWorkflow({ id: 'flow_morning_brief', name: 'Brief', triggers: [], nodes: [], wires: [] });
    const res = await modify({ op: 'rename', name: 'Y', stuardFile: '../outside/evil.stuard' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('relative path inside the workflow workspace');
  });

  it('fails cleanly when the sub-workflow file does not exist', async () => {
    setWorkflowWorkspacePath('flow_morning_brief', WORKSPACE);
    setSessionWorkflow({ id: 'flow_morning_brief', name: 'Brief', triggers: [], nodes: [], wires: [] });
    const res = await modify({ op: 'rename', name: 'Y', stuardFile: 'helpers/missing.stuard' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Could not read sub-workflow');
  });

  it('fails cleanly when the sub-workflow file is not valid JSON', async () => {
    setWorkflowWorkspacePath('flow_morning_brief', WORKSPACE);
    setSessionWorkflow({ id: 'flow_morning_brief', name: 'Brief', triggers: [], nodes: [], wires: [] });
    fakeDesktop.state.workspaceFiles.set('helpers/broken.stuard', '{ not json');
    const res = await modify({ op: 'rename', name: 'Y', stuardFile: 'helpers/broken.stuard' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('not valid workflow JSON');
  });

  it('fails cleanly when the desktop bridge is gone', async () => {
    setWorkflowWorkspacePath('flow_morning_brief', WORKSPACE);
    setSessionWorkflow({ id: 'flow_morning_brief', name: 'Brief', triggers: [], nodes: [], wires: [] });
    fakeDesktop.state.connected = false;
    const res = await modify({ op: 'rename', name: 'Y', stuardFile: SUB_FILE });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('desktop');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Demo 1: "Morning Brief" — built one-shot, then evolved via batch edits.
// ─────────────────────────────────────────────────────────────────────────────

describe('demo: Morning Brief (create → batch build → inspect → surgical edits)', () => {
  async function createMorningBrief() {
    return (createWorkflowTool as any).execute({
      spec: {
        id: 'flow_morning_brief',
        name: 'Morning Brief',
        version: '1',
        triggers: [
          { id: 'trig_cron', type: 'schedule.cron', label: 'Every weekday 9am', args: { cron: '0 9 * * 1-5' }, position: { x: 50, y: 50 } },
          { id: 'trig_manual', type: 'manual', label: 'Run now', args: {}, position: { x: 50, y: 200 },
            inputParams: [{ name: 'focus', type: 'string', required: false, description: 'Topic to focus on' }] },
        ],
        nodes: [],
        wires: [],
      },
    }, {});
  }

  it('creates the workflow one-shot, seeds the session, and persists to the desktop', async () => {
    const res = await createMorningBrief();
    expect(res.ok).toBe(true);
    expect(res.persisted).toBe(true);
    expect(fakeDesktop.state.imported).toHaveLength(1);
    expect(fakeDesktop.state.imported[0].id).toBe('flow_morning_brief');
    expect(getSessionWorkflow()?.id).toBe('flow_morning_brief');
  });

  it('builds the full graph in ONE batch: parallel fetches, waitForAll join, guard branch, UI', async () => {
    await createMorningBrief();

    const res = await modify({
      ops: [
        { op: 'add_node', id: 'fetch_news', tool: 'http_request', label: 'Fetch News',
          args: { url: 'https://news.example.com/api/top', method: 'GET' }, connectFrom: 'trig_cron' },
        { op: 'add_node', id: 'fetch_todos', tool: 'get_variable', label: 'Fetch Todos',
          args: { name: 'todos', default: [] }, connectFrom: 'trig_cron' },
        { op: 'add_node', id: 'brief', tool: 'ai_inference', label: 'Summarize',
          args: { prompt: 'Create a morning brief from news: {{fetch_news.body}} and todos: {{fetch_todos.value}}', mode: 'text' } },
        { op: 'add_node', id: 'show', tool: 'custom_ui', label: 'Show Brief',
          args: { id: 'brief_win', title: 'Morning Brief', blocking: false,
            data: { brief: '{{brief.text}}', status: 'Ready' }, component: UI_COMPONENT } },
        { op: 'add_node', id: 'log_fail', tool: 'log', label: 'Log Failure',
          args: { message: 'Brief failed: {{brief.error}}' } },
        // Fan-in: brief waits for BOTH fetches.
        { op: 'add_wire', from: 'fetch_news', to: 'brief' },
        { op: 'add_wire', from: 'fetch_todos', to: 'brief' },
        { op: 'set_path', path: 'nodes[2].waitForAll', value: true },
        // Guarded branch: success → UI, failure → log.
        { op: 'add_wire', from: 'brief', to: 'show',
          guard: { if: { '==': [{ var: 'brief.ok' }, true] } } },
        { op: 'add_wire', from: 'brief', to: 'log_fail',
          guard: { if: { '==': [{ var: 'brief.ok' }, false] } } },
        // Manual trigger also feeds the news fetch.
        { op: 'add_wire', from: 'trig_manual', to: 'fetch_news' },
        { op: 'add_variable', varName: 'todos', varType: 'list', varDefault: [] },
      ],
    });

    expect(res.ok).toBe(true);
    expect(res.results).toHaveLength(12);
    expect(res.results.every((r: any) => r.ok)).toBe(true);
    // Structural batch → compact schematic for the model, not the padded box.
    expect(res.diagram).toContain('WORKFLOW SCHEMATIC');
    expect(res.diagram).not.toContain('╔');
    // The model result never carries the full workflow when a writer exists —
    // here (no writer) it does, which is also the headless contract.
    const wf = res.workflow;
    expect(wf.nodes).toHaveLength(5);
    expect(wf.wires).toHaveLength(7);
    expect(wf.nodes.find((n: any) => n.id === 'brief').waitForAll).toBe(true);
    expect(wf.variables?.[0]?.name).toBe('todos');
  });

  it('answers every inspect_workflow mode against the built graph', async () => {
    await createMorningBrief();
    await modify({
      ops: [
        { op: 'add_node', id: 'fetch_news', tool: 'http_request', args: { url: 'https://x' }, connectFrom: 'trig_cron' },
        { op: 'add_node', id: 'brief', tool: 'ai_inference', args: { prompt: 'p' } },
        { op: 'add_wire', from: 'fetch_news', to: 'brief' },
      ],
    });

    const overview = await inspect({ mode: 'overview' });
    expect(overview.ok).toBe(true);
    expect(overview.summary).toContain('WORKFLOW SCHEMATIC');
    expect(overview.topology.counts.nodes).toBe(2);

    const nodeFlow = await inspect({ mode: 'node_flow', nodeId: 'brief' });
    expect(nodeFlow.ok).toBe(true);
    expect(nodeFlow.nodeFlow.predecessorIds).toContain('fetch_news');
    expect(nodeFlow.nodeFlow.element.tool).toBe('ai_inference');

    const trigFlow = await inspect({ mode: 'trigger_flow', triggerId: 'trig_cron' });
    expect(trigFlow.ok).toBe(true);
    expect(trigFlow.triggerFlow.successorIds).toContain('fetch_news');

    const wire = await inspect({ mode: 'wire', from: 'fetch_news', to: 'brief' });
    expect(wire.ok).toBe(true);
    expect(wire.wire.from).toBe('fetch_news');

    const missing = await inspect({ mode: 'node_flow', nodeId: 'nope' });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('Node not found');
  });

  it('edits the custom_ui component surgically with edit_node_text (no diagram, no full re-send)', async () => {
    await createMorningBrief();
    await modify({ ops: [
      { op: 'add_node', id: 'show', tool: 'custom_ui',
        args: { id: 'brief_win', component: UI_COMPONENT }, connectFrom: 'trig_cron' },
    ] });

    const res = await modify({
      op: 'edit_node_text',
      nodeId: 'show',
      old_string: "<h1 className='text-xl font-bold'>Morning Brief</h1>",
      new_string: "<h1 className='text-2xl font-grotesk text-glow'>Today's Brief</h1>",
    });
    expect(res.ok).toBe(true);
    expect(res.message).toContain('args.component');
    // Arg-only edit → no schematic in the model result.
    expect(res.diagram).toBeUndefined();
    const component = res.workflow.nodes.find((n: any) => n.id === 'show').args.component;
    expect(component).toContain("Today's Brief");
    // The rest of the component survived byte-for-byte.
    expect(component).toContain("stuard.submit({ read: true })");
    expect(component).toContain("useVar('brief', '')");
  });

  it('updates triggers and wires: cron change, loop + callNode via set_path, removal cleanup', async () => {
    await createMorningBrief();
    await modify({ ops: [
      { op: 'add_node', id: 'items', tool: 'get_variable', args: { name: 'queue' }, connectFrom: 'trig_cron' },
      { op: 'add_node', id: 'process', tool: 'log', args: { message: '{{loop.item}}' } },
      { op: 'add_node', id: 'show', tool: 'custom_ui', args: { id: 'w', component: 'function App(){return <div/>;}' } },
      { op: 'add_node', id: 'worker', tool: 'ai_inference', args: { prompt: '{{caller.q}}' } },
    ] });

    // Trigger update through the trigger-as-step path.
    const cron = await modify({ op: 'update_node', nodeId: 'trig_cron', path: 'cron', value: '*/30 * * * *' });
    expect(cron.ok).toBe(true);
    expect(cron.workflow.triggers.find((t: any) => t.id === 'trig_cron').args.cron).toBe('*/30 * * * *');

    // forEach + callNode wires go through set_path on the wires array.
    const current = cron.workflow.wires;
    const wired = await modify({ op: 'set_path', path: 'wires', value: [
      ...current,
      { from: 'items', to: 'process', loop: { type: 'forEach', items: '{{items.value}}' } },
      { from: 'show', to: 'worker', callNode: true },
    ] });
    expect(wired.ok).toBe(true);
    const loopWire = await inspect({ mode: 'wire', from: 'items', to: 'process' });
    expect(loopWire.wire.loop.type).toBe('forEach');

    // Removing a node removes its wires too.
    const removed = await modify({ op: 'remove_node', nodeId: 'process' });
    expect(removed.ok).toBe(true);
    expect(removed.workflow.nodes.find((n: any) => n.id === 'process')).toBeUndefined();
    expect(removed.workflow.wires.some((w: any) => w.from === 'process' || w.to === 'process')).toBe(false);
  });

  it('keeps applying a batch when one op fails, and reports per-op results', async () => {
    await createMorningBrief();
    const res = await modify({ ops: [
      { op: 'add_node', id: 'a', tool: 'log', args: { message: 'a' }, connectFrom: 'trig_cron' },
      { op: 'add_wire', from: 'a', to: 'does_not_exist' },          // fails
      { op: 'add_node', id: 'b', tool: 'log', args: { message: 'b' }, connectFrom: 'a' },
    ] });
    expect(res.ok).toBe(true);
    expect(res.results.map((r: any) => r.ok)).toEqual([true, false, true]);
    expect(res.results[1].error).toContain('Target not found');
    expect(res.message).toContain('Applied 2/3 operations');
    expect(res.workflow.nodes.map((n: any) => n.id)).toEqual(['a', 'b']);
  });

  it('flags hallucinated and orchestrator-only node tools via nodeIssues', async () => {
    await createMorningBrief();
    const res = await modify({ ops: [
      { op: 'add_node', id: 'bad_agent', tool: 'ask_user', args: { q: 'hi' }, connectFrom: 'trig_cron' },
      { op: 'add_node', id: 'bad_made_up', tool: 'frobnicate_files_v2', args: {}, connectFrom: 'bad_agent' },
    ] });
    expect(res.ok).toBe(true);
    expect(res.nodeIssues).toBeDefined();
    const byNode = Object.fromEntries(res.nodeIssues.map((i: any) => [i.nodeId, i]));
    expect(byNode.bad_agent.reason).toBe('orchestrator_only');
    expect(byNode.bad_agent.severity).toBe('error');
    expect(byNode.bad_made_up.reason).toBe('unknown_tool');
    expect(res.message).toContain('Node-tool validation');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Demo 2: Push-to-talk — two triggers, zero guards (the documented pattern).
// ─────────────────────────────────────────────────────────────────────────────

describe('demo: Push-to-talk (one-shot create of the full documented pattern)', () => {
  it('creates press/release triggers wired to start/stop nodes', async () => {
    const res = await (createWorkflowTool as any).execute({
      spec: {
        id: 'flow_ptt',
        name: 'Push to Talk',
        version: '1',
        triggers: [
          { id: 'trig_press', type: 'hotkey', label: 'Hold Ctrl+H', args: { accelerator: 'Ctrl+H' }, position: { x: 50, y: 50 } },
          { id: 'trig_release', type: 'hotkey.release', label: 'Release Ctrl+H', args: { accelerator: 'Ctrl+H' }, position: { x: 50, y: 200 } },
        ],
        nodes: [
          { id: 'start_rec', tool: 'set_variable', label: 'Start', args: { name: 'recording', value: true, notifyUi: true }, position: { x: 250, y: 50 } },
          { id: 'stop_rec', tool: 'set_variable', label: 'Stop', args: { name: 'recording', value: false, notifyUi: true }, position: { x: 250, y: 200 } },
        ],
        wires: [
          { from: 'trig_press', to: 'start_rec' },
          { from: 'trig_release', to: 'stop_rec' },
        ],
      },
    }, {});

    expect(res.ok).toBe(true);
    expect(res.nodeIssues).toBeUndefined();

    const press = await inspect({ mode: 'trigger_flow', triggerId: 'trig_press' });
    expect(press.triggerFlow.successorIds).toEqual(['start_rec']);
    const release = await inspect({ mode: 'trigger_flow', triggerId: 'trig_release' });
    expect(release.triggerFlow.successorIds).toEqual(['stop_rec']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Demo 3: Sub-workflow editing — the send-email helper file.
// ─────────────────────────────────────────────────────────────────────────────

describe('demo: sub-workflow editing (helpers/send-email.stuard)', () => {
  function seedStudioSession() {
    setWorkflowWorkspacePath('flow_morning_brief', WORKSPACE);
    setSessionWorkflow({
      id: 'flow_morning_brief',
      name: 'Morning Brief',
      version: '1',
      triggers: [{ id: 'trig_cron', type: 'schedule.cron', label: 'Cron', args: { cron: '0 9 * * *' }, position: { x: 50, y: 50 } }],
      nodes: [{ id: 'main_node', tool: 'log', label: 'Main', args: { message: 'main' }, position: { x: 200, y: 50 } }],
      wires: [{ from: 'trig_cron', to: 'main_node' }],
    });
    fakeDesktop.state.workspaceFiles.set(SUB_FILE, JSON.stringify(sendEmailSubWorkflow(), null, 2));
  }

  it('inspects the sub-workflow file without touching the main session', async () => {
    seedStudioSession();
    const res = await inspect({ mode: 'overview', stuardFile: SUB_FILE });
    expect(res.ok).toBe(true);
    expect(res.summary).toContain('Send Email Helper');
    expect(res.topology.counts.nodes).toBe(2);
    // Main session untouched and still the main workflow.
    expect(getSessionWorkflow()?.id).toBe('flow_morning_brief');
  });

  it('applies a batch to the sub-workflow and writes it back to its file only', async () => {
    seedStudioSession();

    const res = await modify({
      stuardFile: SUB_FILE,
      ops: [
        // Make the helper actually return — swap the placeholder node.
        { op: 'update_node', nodeId: 'ret', tool: 'log', args: { message: '{{compose.text}}' } },
        { op: 'add_node', id: 'mark_sent', tool: 'set_variable',
          args: { name: 'lastEmailTo', value: '{{args.to}}' }, connectFrom: 'ret' },
        { op: 'edit_node_text', nodeId: 'compose', old_string: 'short professional email', new_string: 'friendly two-line email' },
      ],
    });

    expect(res.ok).toBe(true);
    expect(res.stuardFile).toBe(SUB_FILE);
    expect(res.results.every((r: any) => r.ok)).toBe(true);

    // Written back to the right absolute path, as valid JSON, with the edits.
    const written = fakeDesktop.state.writes.get(`${WORKSPACE}/${SUB_FILE}`);
    expect(written).toBeDefined();
    const saved = JSON.parse(written!);
    expect(saved.id).toBe('flow_send_email');
    expect(saved.nodes.map((n: any) => n.id)).toEqual(['compose', 'ret', 'mark_sent']);
    expect(saved.nodes.find((n: any) => n.id === 'compose').args.prompt).toContain('friendly two-line email');
    expect(saved.wires).toContainEqual({ from: 'ret', to: 'mark_sent' });

    // The MAIN workflow is completely untouched — no sub nodes, same identity.
    const main = getSessionWorkflow();
    expect(main?.id).toBe('flow_morning_brief');
    expect(main?.nodes.map((n: any) => n.id)).toEqual(['main_node']);
  });

  it('reads back its own writes: inspect after modify sees the new topology', async () => {
    seedStudioSession();
    await modify({
      stuardFile: SUB_FILE,
      ops: [{ op: 'add_node', id: 'audit', tool: 'log', args: { message: 'sent' }, connectFrom: 'ret' }],
    });
    // Simulate the desktop file system: the write IS the new file content.
    const written = fakeDesktop.state.writes.get(`${WORKSPACE}/${SUB_FILE}`)!;
    fakeDesktop.state.workspaceFiles.set(SUB_FILE, written);

    const res = await inspect({ mode: 'node_flow', nodeId: 'audit', stuardFile: SUB_FILE });
    expect(res.ok).toBe(true);
    expect(res.nodeFlow.predecessorIds).toContain('ret');
  });

  it('surfaces a write failure instead of pretending the edit landed', async () => {
    seedStudioSession();
    const realExec = fakeDesktop.exec;
    (fakeDesktop as any).exec = async (tool: string, args: any) =>
      tool === 'write_file' ? { ok: false, error: 'disk full' } : realExec(tool, args);
    try {
      const res = await modify({ stuardFile: SUB_FILE, op: 'rename', name: 'Renamed Helper' });
      expect(res.ok).toBe(false);
      expect(res.error).toContain('disk full');
    } finally {
      (fakeDesktop as any).exec = realExec;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// load_workflow + execute_step plumbing
// ─────────────────────────────────────────────────────────────────────────────

describe('load_workflow and execute_step', () => {
  it('loads a saved workflow into the session for editing', async () => {
    fakeDesktop.state.savedWorkflows.set('flow_ptt', {
      id: 'flow_ptt', name: 'Push to Talk', version: '1',
      triggers: [{ id: 'trig_press', type: 'hotkey', label: 'H', args: {}, position: { x: 0, y: 0 } }],
      nodes: [{ id: 'start_rec', tool: 'set_variable', label: 'S', args: {}, position: { x: 0, y: 0 } }],
      wires: [{ from: 'trig_press', to: 'start_rec' }],
    });

    const res = await (loadWorkflow as any).execute({ workflowId: 'flow_ptt' }, {});
    expect(res.ok).toBe(true);
    expect(res.nodes).toBe(1);
    expect(getSessionWorkflow()?.id).toBe('flow_ptt');

    // And the loaded workflow is immediately editable.
    const edit = await modify({ op: 'add_node', tool: 'log', args: { message: 'x' }, connectFrom: 'start_rec' });
    expect(edit.ok).toBe(true);
    expect(edit.workflow.nodes).toHaveLength(2);
  });

  it('errors on a missing workflow id', async () => {
    const res = await (loadWorkflow as any).execute({ workflowId: 'flow_nope' }, {});
    expect(res.ok).toBe(false);
    expect(res.error).toContain('flow_nope');
  });

  it('execute_step routes a tool test through the bridge with the workflow marker', async () => {
    const res = await (executeStep as any).execute({ tool: 'log', args: { message: 'probe' }, timeoutMs: 5000 }, {});
    expect(res.ok).toBe(true);
    const call = fakeDesktop.state.calls.find(c => c.tool === 'log');
    expect(call).toBeDefined();
    expect(call!.args.__workflowToolCall).toBe(true);
    expect(call!.args.message).toBe('probe');
  });
});
