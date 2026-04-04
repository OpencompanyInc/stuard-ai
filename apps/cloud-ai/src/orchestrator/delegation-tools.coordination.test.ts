import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  runSubagentMock,
  getBridgeWsMock,
  getBridgeSecretsMock,
  withClientBridgeMock,
  writeLogMock,
} = vi.hoisted(() => ({
  runSubagentMock: vi.fn(),
  getBridgeWsMock: vi.fn(),
  getBridgeSecretsMock: vi.fn(),
  withClientBridgeMock: vi.fn(async (_ws: any, fn: () => any) => fn()),
  writeLogMock: vi.fn(),
}));

vi.mock('./subagent-runtime', () => ({
  runSubagent: runSubagentMock,
}));

vi.mock('../tools/bridge', () => ({
  getBridgeWs: getBridgeWsMock,
  getBridgeSecrets: getBridgeSecretsMock,
  withClientBridge: withClientBridgeMock,
}));

vi.mock('../utils/logger', () => ({
  writeLog: writeLogMock,
}));

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
      subagent: 'browser',
      instruction: 'Ask the orchestrator what number to return, then finish.',
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
      subagent: 'browser',
      instruction: 'Ask two questions before finishing.',
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
});
