import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('Delegation question coordination', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getBridgeWsMock.mockReturnValue(undefined);
    getBridgeSecretsMock.mockReturnValue(undefined);
    withClientBridgeMock.mockImplementation(async (_ws: any, fn: () => any) => fn());
  });

  it('returns a question early, then returns the final result after reply_to_subagent', async () => {
    runSubagentMock.mockImplementation(async ({ onQuestion }: any) => {
      const answer = await onQuestion({
        type: 'subagent_question',
        questionId: 'q-1',
        subagentId: 'sa-1',
        runId: 'run-1',
        question: 'What number should I return?',
        choices: ['5', '7'],
      });

      expect(answer.answer).toBe('5');

      return {
        ok: true,
        subagentId: 'sa-1',
        result: 'Returned 5.',
        durationMs: 42,
      };
    });

    const { delegate, replyToSubagent } = await import('./delegation-tools');

    const delegated = await (delegate as any).execute({
      tasks: [{ subagent: 'browser', instruction: 'Ask the orchestrator what number to return, then finish.' }],
    });

    expect(delegated.ok).toBe(true);
    expect(delegated.awaitingReply).toBe(true);
    expect(delegated.completed).toBe(false);
    expect(delegated.question).toMatchObject({
      questionId: 'q-1',
      question: 'What number should I return?',
      choices: ['5', '7'],
    });

    const resumed = await (replyToSubagent as any).execute({
      questionId: 'q-1',
      answer: '5',
    });

    expect(resumed.ok).toBe(true);
    expect(resumed.awaitingReply).toBe(false);
    expect(resumed.completed).toBe(true);
    expect(resumed.subagentId).toBe('sa-1');
    expect(resumed.result).toBe('Returned 5.');
  });

  it('supports a follow-up question after the first reply', async () => {
    runSubagentMock.mockImplementation(async ({ onQuestion }: any) => {
      const first = await onQuestion({
        type: 'subagent_question',
        questionId: 'q-1',
        subagentId: 'sa-2',
        runId: 'run-2',
        question: 'First question?',
      });
      expect(first.answer).toBe('alpha');

      const second = await onQuestion({
        type: 'subagent_question',
        questionId: 'q-2',
        subagentId: 'sa-2',
        runId: 'run-2',
        question: 'Second question?',
      });
      expect(second.answer).toBe('beta');

      return {
        ok: true,
        subagentId: 'sa-2',
        result: 'Finished after two answers.',
        durationMs: 84,
      };
    });

    const { delegate, replyToSubagent } = await import('./delegation-tools');

    const firstQuestion = await (delegate as any).execute({
      tasks: [{ subagent: 'browser', instruction: 'Ask two questions before finishing.' }],
    });

    expect(firstQuestion.awaitingReply).toBe(true);
    expect(firstQuestion.completed).toBe(false);
    expect(firstQuestion.question?.questionId).toBe('q-1');

    const secondQuestion = await (replyToSubagent as any).execute({
      questionId: 'q-1',
      answer: 'alpha',
    });

    expect(secondQuestion.awaitingReply).toBe(true);
    expect(secondQuestion.completed).toBe(false);
    expect(secondQuestion.question?.questionId).toBe('q-2');
    expect(secondQuestion.question?.question).toBe('Second question?');

    const finalResult = await (replyToSubagent as any).execute({
      questionId: 'q-2',
      answer: 'beta',
    });

    expect(finalResult.awaitingReply).toBe(false);
    expect(finalResult.completed).toBe(true);
    expect(finalResult.result).toBe('Finished after two answers.');
  });

  it('injects the selected skill into delegated subagent context', async () => {
    getBridgeSecretsMock.mockReturnValue({
      __skills: [
        {
          id: 'skill_email',
          name: 'Email Helper',
          description: 'Draft concise follow-up emails',
          trigger: 'when the user asks for email help',
          steps: [{ id: 'step_1', type: 'prompt', label: 'Draft', content: 'Write the email.' }],
        },
      ],
    });
    runSubagentMock.mockResolvedValue({
      ok: true,
      subagentId: 'sa-skill',
      result: 'Completed with the selected skill.',
      durationMs: 21,
    });

    const { delegate } = await import('./delegation-tools');

    const result = await (delegate as any).execute({
      tasks: [{
        subagent: 'browser',
        instruction: 'Use the delegated skill while you work.',
        skill: 'email helper',
        context: 'Conversation context goes here.',
      }],
    });

    expect(result.ok).toBe(true);
    expect(runSubagentMock).toHaveBeenCalledTimes(1);
    expect(runSubagentMock).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        context: expect.stringContaining('## SELECTED SKILL'),
      }),
    }));

    const [{ request }] = runSubagentMock.mock.calls[0];
    expect(request.context).toContain('Name: Email Helper');
    expect(request.context).toContain('1. [prompt] Draft');
    expect(request.context).toContain('Conversation context goes here.');
  });

  it('passes target agent ids into the delegated agent subagent context', async () => {
    runSubagentMock.mockResolvedValue({
      ok: true,
      subagentId: 'sa-agent',
      result: 'Agent answered.',
      durationMs: 18,
    });

    const { delegate } = await import('./delegation-tools');

    const result = await (delegate as any).execute({
      tasks: [{
        subagent: 'agent',
        instruction: 'Ask this configured agent for an update.',
        agent_id: 'agent_research',
        agent_name: 'Research',
      }],
    });

    expect(result.ok).toBe(true);
    expect(runSubagentMock).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        kind: 'agent',
        context: expect.stringContaining('Target agent id: agent_research'),
      }),
    }));
    const [{ request }] = runSubagentMock.mock.calls[0];
    expect(request.context).toContain('Target agent name: Research');
  });

  it('assigns deterministic tab indexes and unique session secrets for parallel browser delegates', async () => {
    const {
      assignBrowserDelegateTabIndexes,
      buildDelegateBridgeSecrets,
    } = await import('./delegation-tools');

    const tasks = [
      { subagent: 'browser' },
      { subagent: 'file_ops' },
      { subagent: 'browser' },
      { subagent: 'browser' },
    ];

    const indexes = assignBrowserDelegateTabIndexes(tasks);
    expect(indexes).toEqual([0, undefined, 1, 2]);

    const first = buildDelegateBridgeSecrets('browser', { userId: 'user-1' }, 'run-a', indexes[0]);
    const second = buildDelegateBridgeSecrets('browser', { userId: 'user-1' }, 'run-b', indexes[2]);
    const nonBrowser = buildDelegateBridgeSecrets('file_ops', { userId: 'user-1' }, 'run-c', indexes[1]);

    expect(first?.browserUseSessionId).toBe('browser-run-a');
    expect(second?.browserUseSessionId).toBe('browser-run-b');
    expect(first?.browserUseSessionId).not.toBe(second?.browserUseSessionId);
    expect(first?.browserUseTabIndex).toBe(0);
    expect(second?.browserUseTabIndex).toBe(1);
    expect(nonBrowser).toEqual({ userId: 'user-1' });
  });

  it('gives a single browser delegate a session id without forcing a tab index', async () => {
    getBridgeSecretsMock.mockReturnValue({ userId: 'user-1' });
    runSubagentMock.mockResolvedValue({
      ok: true,
      subagentId: 'sa-browser',
      result: 'done',
      durationMs: 1,
    });

    const { delegate } = await import('./delegation-tools');

    const result = await (delegate as any).execute({
      tasks: [{ subagent: 'browser', instruction: 'Open one page.' }],
    });

    expect(result.ok).toBe(true);
    expect(runSubagentMock).toHaveBeenCalledTimes(1);
    const [{ bridgeSecrets }] = runSubagentMock.mock.calls[0];
    expect(bridgeSecrets.browserUseSessionId).toMatch(/^browser-run-/);
    expect(bridgeSecrets.browserUseTabIndex).toBeUndefined();
  });

  it('returns an error when the requested skill is not available', async () => {
    getBridgeSecretsMock.mockReturnValue({
      __skills: [
        {
          id: 'skill_email',
          name: 'Email Helper',
          description: 'Draft concise follow-up emails',
          trigger: 'when the user asks for email help',
          steps: [],
        },
      ],
    });

    const { delegate } = await import('./delegation-tools');

    const result = await (delegate as any).execute({
      tasks: [{
        subagent: 'browser',
        instruction: 'Try to use a missing skill.',
        skill: 'missing skill',
      }],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown skill "missing skill"');
    expect(runSubagentMock).not.toHaveBeenCalled();
  });

  it('returns the first parallel question before waiting for a slow sibling, then waits for final batch completion', async () => {
    const slowTask = deferred<any>();
    runSubagentMock.mockImplementation(async ({ request, onQuestion }: any) => {
      if (request.instruction.includes('ask first')) {
        const answer = await onQuestion({
          type: 'subagent_question',
          questionId: 'q-parallel-1',
          subagentId: 'sa-question',
          runId: 'run-question',
          question: 'Which value should I use?',
        });
        expect(answer.answer).toBe('use 42');
        return {
          ok: true,
          subagentId: 'sa-question',
          result: 'Question task finished.',
          durationMs: 10,
        };
      }

      return slowTask.promise;
    });

    const { delegate, replyToSubagent } = await import('./delegation-tools');

    const delegated = await Promise.race([
      (delegate as any).execute({
        tasks: [
          { subagent: 'browser', instruction: 'ask first, then finish' },
          { subagent: 'file_ops', instruction: 'slow sibling' },
        ],
      }),
      new Promise(resolve => setTimeout(() => resolve('timeout'), 1000)),
    ]);

    expect(delegated).not.toBe('timeout');
    expect((delegated as any).awaitingReply).toBe(true);
    expect((delegated as any).completed).toBe(false);
    expect((delegated as any).questionId).toBe('q-parallel-1');
    expect((delegated as any).results).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'awaiting_reply', questionId: 'q-parallel-1' }),
      expect.objectContaining({ status: 'running', completed: false }),
    ]));

    let replySettled = false;
    const replyPromise = (replyToSubagent as any).execute({
      questionId: 'q-parallel-1',
      answer: 'use 42',
    }).then((value: any) => {
      replySettled = true;
      return value;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(replySettled).toBe(false);

    slowTask.resolve({
      ok: true,
      subagentId: 'sa-slow',
      result: 'Slow task finished.',
      durationMs: 100,
    });

    const final = await replyPromise;
    expect(final.ok).toBe(true);
    expect(final.results).toHaveLength(2);
    expect(final.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ subagentId: 'sa-question', completed: true, result: 'Question task finished.' }),
      expect.objectContaining({ subagentId: 'sa-slow', completed: true, result: 'Slow task finished.' }),
    ]));
  });

  it('surfaces parallel questions FIFO while only one question is active', async () => {
    runSubagentMock.mockImplementation(async ({ request, onQuestion }: any) => {
      if (request.instruction.includes('first')) {
        const answer = await onQuestion({
          type: 'subagent_question',
          questionId: 'q-first',
          subagentId: 'sa-first',
          runId: 'run-first',
          question: 'First question?',
        });
        expect(answer.answer).toBe('alpha');
        return {
          ok: true,
          subagentId: 'sa-first',
          result: 'First done.',
          durationMs: 1,
        };
      }

      const answer = await onQuestion({
        type: 'subagent_question',
        questionId: 'q-second',
        subagentId: 'sa-second',
        runId: 'run-second',
        question: 'Second question?',
      });
      expect(answer.answer).toBe('beta');
      return {
        ok: true,
        subagentId: 'sa-second',
        result: 'Second done.',
        durationMs: 2,
      };
    });

    const { delegate, replyToSubagent } = await import('./delegation-tools');

    const first = await (delegate as any).execute({
      tasks: [
        { subagent: 'browser', instruction: 'first parallel question' },
        { subagent: 'file_ops', instruction: 'second parallel question' },
      ],
    });

    expect(first.awaitingReply).toBe(true);
    expect(first.questionId).toBe('q-first');
    expect(first.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionId: 'q-first', status: 'awaiting_reply' }),
    ]));

    const second = await (replyToSubagent as any).execute({
      questionId: 'q-first',
      answer: 'alpha',
    });

    expect(second.awaitingReply).toBe(true);
    expect(second.completed).toBe(false);
    expect(second.questionId).toBe('q-second');
    expect(second.question.question).toBe('Second question?');

    const final = await (replyToSubagent as any).execute({
      questionId: 'q-second',
      answer: 'beta',
    });

    expect(final.ok).toBe(true);
    expect(final.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ subagentId: 'sa-first', completed: true, result: 'First done.' }),
      expect.objectContaining({ subagentId: 'sa-second', completed: true, result: 'Second done.' }),
    ]));
  });

  it('does not return parallel completion until every sibling is terminal', async () => {
    const slowTask = deferred<any>();
    runSubagentMock.mockImplementation(async ({ request }: any) => {
      if (request.instruction.includes('fast')) {
        return {
          ok: true,
          subagentId: 'sa-fast',
          result: 'Fast return_control summary.',
          durationMs: 5,
        };
      }
      return slowTask.promise;
    });

    const { delegate } = await import('./delegation-tools');

    let settled = false;
    const delegatedPromise = (delegate as any).execute({
      tasks: [
        { subagent: 'browser', instruction: 'fast return_control completion' },
        { subagent: 'file_ops', instruction: 'slow terminal sibling' },
      ],
    }).then((value: any) => {
      settled = true;
      return value;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    slowTask.resolve({
      ok: true,
      subagentId: 'sa-slow-terminal',
      result: 'Slow terminal summary.',
      durationMs: 50,
    });

    const final = await delegatedPromise;
    expect(final.ok).toBe(true);
    expect(final.results).toHaveLength(2);
    expect(final.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ subagentId: 'sa-fast', completed: true }),
      expect.objectContaining({ subagentId: 'sa-slow-terminal', completed: true }),
    ]));
  });

  it('serializes ask_orchestrator across two single-task delegate calls on the same request', async () => {
    getBridgeSecretsMock.mockReturnValue({ __requestId: 'req-separate' });
    const order: string[] = [];

    runSubagentMock.mockImplementation(async ({ request, onQuestion }: any) => {
      if (request.instruction.includes('first')) {
        order.push('first-ask');
        const answer = await onQuestion({
          type: 'subagent_question',
          questionId: 'q-sep-first',
          subagentId: 'sa-first',
          runId: 'run-first',
          question: 'First separate delegate?',
        });
        expect(answer.answer).toBe('answer-one');
        order.push('first-done');
        return { ok: true, subagentId: 'sa-first', result: 'First finished.', durationMs: 1 };
      }

      order.push('second-ask');
      const answer = await onQuestion({
        type: 'subagent_question',
        questionId: 'q-sep-second',
        subagentId: 'sa-second',
        runId: 'run-second',
        question: 'Second separate delegate?',
      });
      expect(answer.answer).toBe('answer-two');
      order.push('second-done');
      return { ok: true, subagentId: 'sa-second', result: 'Second finished.', durationMs: 2 };
    });

    const { delegate, replyToSubagent } = await import('./delegation-tools');

    const firstResult = await (delegate as any).execute({
      tasks: [{ subagent: 'browser', instruction: 'first separate delegate' }],
    });
    expect(firstResult.awaitingReply).toBe(true);
    expect(firstResult.questionId).toBe('q-sep-first');

    const afterFirstReply = await (replyToSubagent as any).execute({
      questionId: 'q-sep-first',
      answer: 'answer-one',
    });
    expect(afterFirstReply.completed).toBe(true);
    expect(afterFirstReply.result).toBe('First finished.');

    const secondResult = await (delegate as any).execute({
      tasks: [{ subagent: 'file_ops', instruction: 'second separate delegate' }],
    });
    expect(secondResult.awaitingReply).toBe(true);
    expect(secondResult.questionId).toBe('q-sep-second');

    const final = await (replyToSubagent as any).execute({
      questionId: 'q-sep-second',
      answer: 'answer-two',
    });
    expect(final.completed).toBe(true);
    expect(final.result).toBe('Second finished.');
    expect(order).toEqual(['first-ask', 'first-done', 'second-ask', 'second-done']);
  });

  it('preserves the aggregate response when parallel tasks complete without questions', async () => {
    runSubagentMock.mockImplementation(async ({ request }: any) => ({
      ok: true,
      subagentId: request.instruction.includes('one') ? 'sa-one' : 'sa-two',
      result: request.instruction.includes('one') ? 'One done.' : 'Two done.',
      durationMs: 1,
    }));

    const { delegate } = await import('./delegation-tools');

    const result = await (delegate as any).execute({
      tasks: [
        { subagent: 'browser', instruction: 'one' },
        { subagent: 'file_ops', instruction: 'two' },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.awaitingReply).toBeUndefined();
    expect(result.questionId).toBeUndefined();
    expect(result.results).toEqual([
      expect.objectContaining({ index: 0, subagent: 'browser', completed: true, result: 'One done.' }),
      expect.objectContaining({ index: 1, subagent: 'file_ops', completed: true, result: 'Two done.' }),
    ]);
    expect(result.summary).toContain('2/2 tasks completed');
  });
});
