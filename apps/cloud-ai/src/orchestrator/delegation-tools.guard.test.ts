import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Turn-end guard coverage: the orchestrator can finish its turn while a
 * delegated subagent is still blocked on ask_orchestrator. These tests verify
 * that pending questions are tracked per request and can be force-resolved so
 * the subagent never hangs (and the UI never gets stuck on "ask_orchestrator").
 *
 * Aborting the unblocked subagents is the agent runner's job — this layer stays
 * decoupled from subagent-runtime and just reports which subagentIds it freed.
 */

const {
  runSubagentMock,
  getBridgeWsMock,
  getBridgeSecretsMock,
  withClientBridgeMock,
  execLocalToolMock,
  writeLogMock,
} = vi.hoisted(() => ({
  runSubagentMock: vi.fn(),
  getBridgeWsMock: vi.fn(),
  getBridgeSecretsMock: vi.fn(),
  withClientBridgeMock: vi.fn(async (_ws: any, fn: () => any) => fn()),
  execLocalToolMock: vi.fn(async () => ({ ok: true })),
  writeLogMock: vi.fn(),
}));

vi.mock('./subagent-runtime', () => ({
  runSubagent: runSubagentMock,
}));

vi.mock('../tools/bridge', () => ({
  execLocalTool: execLocalToolMock,
  getBridgeWs: getBridgeWsMock,
  getBridgeSecrets: getBridgeSecretsMock,
  withClientBridge: withClientBridgeMock,
}));

vi.mock('../utils/logger', () => ({
  writeLog: writeLogMock,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued microtasks + a macrotask settle (parallel question fan-out). */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('Subagent question turn-end guard', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getBridgeWsMock.mockReturnValue(undefined);
    getBridgeSecretsMock.mockReturnValue(undefined);
    withClientBridgeMock.mockImplementation(async (_ws: any, fn: () => any) => fn());
  });

  it('tracks a surfaced question scoped to the owning request, and clears it after reply', async () => {
    getBridgeSecretsMock.mockReturnValue({ __requestId: 'req-1' });
    runSubagentMock.mockImplementation(async ({ onQuestion }: any) => {
      const answer = await onQuestion({
        type: 'subagent_question',
        questionId: 'q-1',
        subagentId: 'sa-1',
        runId: 'run-1',
        question: 'Pick a number',
        choices: ['5', '7'],
      });
      return { ok: true, subagentId: 'sa-1', result: `done:${answer.answer}`, durationMs: 1 };
    });

    const {
      delegate,
      replyToSubagent,
      getPendingSubagentQuestions,
      hasPendingSubagentQuestions,
    } = await import('./delegation-tools');

    const delegated = await (delegate as any).execute({
      tasks: [{ subagent: 'browser', instruction: 'ask the orchestrator' }],
    });
    expect(delegated.awaitingReply).toBe(true);

    // Surfaced + attributed to req-1 only.
    expect(hasPendingSubagentQuestions('req-1')).toBe(true);
    expect(hasPendingSubagentQuestions('req-2')).toBe(false);
    expect(getPendingSubagentQuestions('req-1')).toEqual([
      expect.objectContaining({
        questionId: 'q-1',
        subagentId: 'sa-1',
        subagent: 'browser',
        question: 'Pick a number',
        choices: ['5', '7'],
      }),
    ]);
    expect(getPendingSubagentQuestions('req-2')).toEqual([]);

    const resumed = await (replyToSubagent as any).execute({ questionId: 'q-1', answer: '5' });
    expect(resumed.completed).toBe(true);
    expect(resumed.result).toBe('done:5');

    // Answered → no longer pending.
    expect(hasPendingSubagentQuestions('req-1')).toBe(false);
    expect(getPendingSubagentQuestions('req-1')).toEqual([]);
  });

  it('force-resolves a stuck single-task question and unblocks the subagent', async () => {
    getBridgeSecretsMock.mockReturnValue({ __requestId: 'req-stuck' });
    const finished = deferred<void>();
    let received: string | undefined;
    runSubagentMock.mockImplementation(async ({ onQuestion }: any) => {
      const answer = await onQuestion({
        type: 'subagent_question',
        questionId: 'q-stuck',
        subagentId: 'sa-stuck',
        runId: 'run-stuck',
        question: 'Need a decision',
      });
      received = answer.answer;
      finished.resolve();
      return { ok: true, subagentId: 'sa-stuck', result: 'stopped', durationMs: 1 };
    });

    const {
      delegate,
      hasPendingSubagentQuestions,
      resolvePendingSubagentQuestionsForRequest,
    } = await import('./delegation-tools');

    const delegated = await (delegate as any).execute({
      tasks: [{ subagent: 'browser', instruction: 'ask then block' }],
    });
    expect(delegated.awaitingReply).toBe(true);
    expect(hasPendingSubagentQuestions('req-stuck')).toBe(true);

    // requestId is required — undefined must be a safe no-op (never nuke globally).
    expect(resolvePendingSubagentQuestionsForRequest(undefined, 'x')).toEqual([]);
    expect(hasPendingSubagentQuestions('req-stuck')).toBe(true);

    // A different request must not touch this one.
    expect(resolvePendingSubagentQuestionsForRequest('req-other', 'x')).toEqual([]);
    expect(hasPendingSubagentQuestions('req-stuck')).toBe(true);

    const freed = resolvePendingSubagentQuestionsForRequest('req-stuck', 'orchestrator_finished');
    expect(freed).toEqual(['sa-stuck']);
    expect(hasPendingSubagentQuestions('req-stuck')).toBe(false);

    await finished.promise;
    expect(received).toContain('ended this turn without answering');
  });

  it('force-resolves both the active and the queued sibling in a parallel group', async () => {
    getBridgeSecretsMock.mockReturnValue({ __requestId: 'req-par' });
    const received: Record<string, string> = {};
    runSubagentMock.mockImplementation(async ({ request, onQuestion }: any) => {
      if (request.instruction.includes('first')) {
        const a = await onQuestion({
          type: 'subagent_question',
          questionId: 'q-a',
          subagentId: 'sa-a',
          runId: 'run-a',
          question: 'A?',
        });
        received['sa-a'] = a.answer;
        return { ok: true, subagentId: 'sa-a', result: 'a-done', durationMs: 1 };
      }
      const b = await onQuestion({
        type: 'subagent_question',
        questionId: 'q-b',
        subagentId: 'sa-b',
        runId: 'run-b',
        question: 'B?',
      });
      received['sa-b'] = b.answer;
      return { ok: true, subagentId: 'sa-b', result: 'b-done', durationMs: 1 };
    });

    const {
      delegate,
      getPendingSubagentQuestions,
      hasPendingSubagentQuestions,
      resolvePendingSubagentQuestionsForRequest,
    } = await import('./delegation-tools');

    const delegated = await (delegate as any).execute({
      tasks: [
        { subagent: 'browser', instruction: 'first parallel question' },
        { subagent: 'file_ops', instruction: 'second parallel question' },
      ],
    });

    expect(delegated.awaitingReply).toBe(true);
    expect(delegated.questionId).toBe('q-a');

    // Let the slow sibling reach ask_orchestrator so it sits queued behind q-a.
    await flush();

    // Only the active question is surfaced/answerable; the queued one is hidden.
    expect(getPendingSubagentQuestions('req-par').map((q) => q.questionId)).toEqual(['q-a']);
    expect(hasPendingSubagentQuestions('req-par')).toBe(true);
    expect(hasPendingSubagentQuestions('req-elsewhere')).toBe(false);

    // The backstop must drain BOTH the active and the queued sibling.
    const freed = resolvePendingSubagentQuestionsForRequest('req-par', 'orchestrator_finished');
    expect([...freed].sort()).toEqual(['sa-a', 'sa-b']);
    expect(hasPendingSubagentQuestions('req-par')).toBe(false);

    await flush();
    expect(received['sa-a']).toContain('ended this turn without answering');
    expect(received['sa-b']).toContain('ended this turn without answering');
  });

  it('leaves a still-running (not-yet-asking) sibling untouched by the backstop', async () => {
    getBridgeSecretsMock.mockReturnValue({ __requestId: 'req-mix' });
    const slow = deferred<any>();
    runSubagentMock.mockImplementation(async ({ request, onQuestion }: any) => {
      if (request.instruction.includes('asks')) {
        const a = await onQuestion({
          type: 'subagent_question',
          questionId: 'q-asks',
          subagentId: 'sa-asks',
          runId: 'run-asks',
          question: 'Blocked?',
        });
        return { ok: true, subagentId: 'sa-asks', result: `asked:${a.answer}`, durationMs: 1 };
      }
      return slow.promise; // still running, never asked a question
    });

    const {
      delegate,
      hasPendingSubagentQuestions,
      resolvePendingSubagentQuestionsForRequest,
    } = await import('./delegation-tools');

    const delegated = await (delegate as any).execute({
      tasks: [
        { subagent: 'browser', instruction: 'asks the orchestrator' },
        { subagent: 'file_ops', instruction: 'slow worker' },
      ],
    });
    expect(delegated.awaitingReply).toBe(true);

    // Only the blocked question is freed; the running sibling is not a pending
    // question and must not be reported (so the runner won't abort it here).
    const freed = resolvePendingSubagentQuestionsForRequest('req-mix', 'orchestrator_finished');
    expect(freed).toEqual(['sa-asks']);
    expect(hasPendingSubagentQuestions('req-mix')).toBe(false);

    // Clean up the still-running sibling.
    slow.resolve({ ok: true, subagentId: 'sa-slow', result: 'slow done', durationMs: 1 });
  });
});
