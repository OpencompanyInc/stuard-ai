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
});
