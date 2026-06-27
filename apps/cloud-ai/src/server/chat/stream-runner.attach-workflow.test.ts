import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionWorkflowMock, getWorkflowByIdMock, sendMock } = vi.hoisted(() => ({
  getSessionWorkflowMock: vi.fn(),
  getWorkflowByIdMock: vi.fn(),
  sendMock: vi.fn(),
}));

// We only need the function under test, but stream-runner imports a lot at
// module load, so stub out the heavy/process-bound modules to a no-op shape.
vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('../../pricing', () => ({ getDefaultModelForCategory: vi.fn() }));
vi.mock('../../utils/models', () => ({ buildNativeProviderModel: vi.fn() }));
vi.mock('../../utils/logger', () => ({ writeLog: vi.fn() }));
vi.mock('../../utils/sanitize', () => ({
  sanitizeToolEvent: (v: any) => v,
  sanitizeSteps: (v: any) => v,
}));
vi.mock('../../utils/usage', () => ({ normalizeUsage: (u: any) => u || {} }));
vi.mock('../../utils/thread-title', () => ({
  normalizeThreadTitle: vi.fn(),
  THREAD_TITLE_SYSTEM: '',
}));
vi.mock('../../memory/context-compactor', () => ({ compactHistory: vi.fn() }));
vi.mock('../../memory/conversations', () => ({}));
vi.mock('../../tools/bridge', () => ({
  withClientBridge: vi.fn((_ws: any, fn: any) => fn()),
  getBridgeWs: vi.fn(),
  getBridgeSecrets: vi.fn(),
}));
vi.mock('../../supabase', () => ({
  addAssistantMessage: vi.fn(),
  addUserMessage: vi.fn(),
  finishRun: vi.fn(),
  setConversationTitle: vi.fn(),
}));
vi.mock('../../services/live-usage-billing', () => ({ LiveUsageBillingTracker: vi.fn() }));
vi.mock('../../services/vm-bridge', () => ({ getDesktopWs: vi.fn() }));
vi.mock('../../services/run-state', () => ({
  addPendingApproval: vi.fn(),
  registerRun: vi.fn(),
  removePendingApprovalByToolId: vi.fn(),
  setTerminalResult: vi.fn(),
}));
vi.mock('../socket/state', () => ({
  conversations: new Map(),
  deleteAbortController: vi.fn(),
  setAbortController: vi.fn(),
}));
vi.mock('../socket/helpers', () => ({
  isSISMetaTool: vi.fn(() => false),
  send: sendMock,
}));
vi.mock('./provider-options', () => ({ getHardTimeoutMs: vi.fn(() => 0) }));
vi.mock('./interjections', () => ({
  appendInterjectionToMessages: vi.fn((m: any[]) => m),
  drainInterjectionPayload: vi.fn(),
}));

// The actual module under test mocks only these symbols.
vi.mock('../../tools/workflow', () => ({
  getSessionWorkflow: getSessionWorkflowMock,
  getWorkflowById: getWorkflowByIdMock,
}));

describe('attachWorkflowForClient', () => {
  beforeEach(() => {
    getSessionWorkflowMock.mockReset();
    getWorkflowByIdMock.mockReset();
  });

  it('prefers the freshly-modified workflow resolved by id over the stale session', async () => {
    // Mirrors the real bug: the request-level session ALS still holds the
    // PRE-edit workflow (workflow-agent tools run in their own ALS context), so
    // getSessionWorkflow() is stale. workflowMap, keyed by id, has the new node.
    const stale = { id: 'wf_1', nodes: [{ id: 'trig_manual' }], wires: [], triggers: [] };
    const fresh = {
      id: 'wf_1',
      nodes: [{ id: 'trig_manual' }, { id: 'step_k9o99a', tool: 'random_number' }],
      wires: [{ from: 'trig_manual', to: 'step_k9o99a' }],
      triggers: [],
    };
    getSessionWorkflowMock.mockReturnValue(stale);
    getWorkflowByIdMock.mockImplementation((id: string) => (id === 'wf_1' ? fresh : null));

    const { attachWorkflowForClient } = await import('./stream-runner');

    const out = attachWorkflowForClient('modify_workflow', {
      ok: true,
      workflowId: 'wf_1',
      message: 'Added node "random_number" (step_k9o99a) wired from trig_manual',
      diagram: '...',
    });

    expect(out.workflow).toBe(fresh);
    expect(out.workflow.nodes).toHaveLength(2);
    expect(getWorkflowByIdMock).toHaveBeenCalledWith('wf_1');
  });

  it('falls back to the session workflow when the id is not in the map', async () => {
    const sessionWorkflow = { id: 'wf_x', nodes: [], wires: [], triggers: [] };
    getSessionWorkflowMock.mockReturnValue(sessionWorkflow);
    getWorkflowByIdMock.mockReturnValue(null);

    const { attachWorkflowForClient } = await import('./stream-runner');

    const out = attachWorkflowForClient('modify_workflow', { ok: true, workflowId: 'wf_x', message: 'Updated' });
    expect(out.workflow).toBe(sessionWorkflow);
  });

  it('does not attach any workflow for sub-workflow (stuardFile) results', async () => {
    // Sub-file edits never touch the session/main workflow — attaching the
    // main workflow would hand the canvas a stale, mismatched document.
    const mainWorkflow = { id: 'wf_main', nodes: [{ id: 'n1' }], wires: [], triggers: [] };
    getSessionWorkflowMock.mockReturnValue(mainWorkflow);
    getWorkflowByIdMock.mockReturnValue(mainWorkflow);

    const { attachWorkflowForClient } = await import('./stream-runner');

    const result = { ok: true, workflowId: 'wf_main', stuardFile: 'helpers/send-email.stuard', message: 'Updated' };
    const out = attachWorkflowForClient('modify_workflow', result);

    expect(out).toBe(result);
    expect(out.workflow).toBeUndefined();
  });

  it('reattaches the active session workflow when modify_workflow returns a compact result', async () => {
    const sessionWorkflow = { id: 'wf_1', nodes: [{ id: 'n1' }], wires: [], triggers: [] };
    getSessionWorkflowMock.mockReturnValue(sessionWorkflow);

    const { attachWorkflowForClient } = await import('./stream-runner');

    const compactResult = { ok: true, message: 'Updated', diagram: '...' };
    const out = attachWorkflowForClient('modify_workflow', compactResult);

    expect(out).toEqual({
      ...compactResult,
      workflow: sessionWorkflow,
    });
  });

  it('reattaches workflow for the workflow_modify alias', async () => {
    const sessionWorkflow = { id: 'wf_2', nodes: [], wires: [], triggers: [] };
    getSessionWorkflowMock.mockReturnValue(sessionWorkflow);

    const { attachWorkflowForClient } = await import('./stream-runner');

    const out = attachWorkflowForClient('workflow_modify', { ok: true });
    expect(out).toMatchObject({ ok: true, workflow: sessionWorkflow });
  });

  it('does not overwrite an existing workflow on the result', async () => {
    const original = { id: 'original' };
    getSessionWorkflowMock.mockReturnValue({ id: 'session' });

    const { attachWorkflowForClient } = await import('./stream-runner');

    const out = attachWorkflowForClient('modify_workflow', {
      ok: true,
      workflow: original,
    });

    expect(out.workflow).toBe(original);
  });

  it('does not attach when result.spec is already present (create_workflow path)', async () => {
    const spec = { id: 'spec' };
    getSessionWorkflowMock.mockReturnValue({ id: 'session' });

    const { attachWorkflowForClient } = await import('./stream-runner');

    const out = attachWorkflowForClient('create_workflow', { ok: true, spec });
    expect(out).toEqual({ ok: true, spec });
    expect((out as any).workflow).toBeUndefined();
  });

  it('leaves non-mutation tools untouched', async () => {
    getSessionWorkflowMock.mockReturnValue({ id: 'session' });

    const { attachWorkflowForClient } = await import('./stream-runner');

    const out = attachWorkflowForClient('search_tools', { ok: true, results: [] });
    expect(out).toEqual({ ok: true, results: [] });
    expect((out as any).workflow).toBeUndefined();
  });

  it('leaves error results untouched', async () => {
    getSessionWorkflowMock.mockReturnValue({ id: 'session' });

    const { attachWorkflowForClient } = await import('./stream-runner');

    const errorResult = { ok: false, error: 'boom' };
    const out = attachWorkflowForClient('modify_workflow', errorResult);
    expect(out).toBe(errorResult);
  });

  it('returns the result unchanged when there is no session workflow', async () => {
    getSessionWorkflowMock.mockReturnValue(null);

    const { attachWorkflowForClient } = await import('./stream-runner');

    const compact = { ok: true, message: 'Updated' };
    const out = attachWorkflowForClient('modify_workflow', compact);
    expect(out).toBe(compact);
  });

  it('handles non-object results without throwing', async () => {
    const { attachWorkflowForClient } = await import('./stream-runner');

    expect(attachWorkflowForClient('modify_workflow', null)).toBeNull();
    expect(attachWorkflowForClient('modify_workflow', 'oops')).toBe('oops');
    expect(attachWorkflowForClient('modify_workflow', undefined)).toBeUndefined();
  });
});

// Integration-level: prove the tool-result stream chunk actually carries the
// re-attached workflow out to the client via send(). This is the real wiring
// the desktop canvas depends on — the helper being correct is necessary but
// not sufficient; it has to be invoked on the forwarded tool-result.
describe('handleStreamChunk tool-result forwarding', () => {
  beforeEach(() => {
    getSessionWorkflowMock.mockReset();
    getWorkflowByIdMock.mockReset();
    sendMock.mockReset();
  });

  function findToolEvent(tool: string) {
    return sendMock.mock.calls
      .map((c) => c[1])
      .find((payload: any) => payload?.event === 'tool_event' && payload?.data?.tool === tool);
  }

  it('attaches the session workflow to a modify_workflow tool-result before sending', async () => {
    const sessionWorkflow = { id: 'wf_1', nodes: [{ id: 'step_notify', args: { title: 'calorie' } }], wires: [], triggers: [] };
    getSessionWorkflowMock.mockReturnValue(sessionWorkflow);

    const { handleStreamChunk } = await import('./stream-runner');

    // Shape mirrors the AI SDK tool-result chunk: compact result, no workflow.
    handleStreamChunk({
      chunk: {
        type: 'tool-result',
        payload: {
          toolName: 'modify_workflow',
          toolCallId: 'tc-1',
          result: { ok: true, message: 'Updated', diagram: '...' },
        },
      },
      ws: {} as any,
      requestId: 'req-1',
      authUser: null,
      runtime: { didSendFinal: false, aggregatedText: '', sawAnyTextDelta: false, sawToolCall: false } as any,
      toolCallsMap: new Map(),
      streamChunks: [],
    });

    const event = findToolEvent('modify_workflow');
    expect(event).toBeTruthy();
    expect(event.data.result.workflow).toEqual(sessionWorkflow);
    expect(event.data.result.workflow.nodes[0].args.title).toBe('calorie');
  });

  it('leaves a non-mutation tool-result without a workflow', async () => {
    getSessionWorkflowMock.mockReturnValue({ id: 'session' });

    const { handleStreamChunk } = await import('./stream-runner');

    handleStreamChunk({
      chunk: {
        type: 'tool-result',
        payload: { toolName: 'search_tools', toolCallId: 'tc-2', result: { ok: true, results: [] } },
      },
      ws: {} as any,
      requestId: 'req-2',
      authUser: null,
      runtime: { didSendFinal: false, aggregatedText: '', sawAnyTextDelta: false, sawToolCall: false } as any,
      toolCallsMap: new Map(),
      streamChunks: [],
    });

    const event = findToolEvent('search_tools');
    expect(event).toBeTruthy();
    expect(event.data.result.workflow).toBeUndefined();
  });
});
