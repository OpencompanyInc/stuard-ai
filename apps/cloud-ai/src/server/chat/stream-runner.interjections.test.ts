import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  addAssistantMessageMock,
  addUserMessageMock,
  deleteAbortControllerMock,
  finishRunMock,
  getBridgeWsMock,
  sendMock,
  setAbortControllerMock,
  setTerminalResultMock,
  writeLogMock,
} = vi.hoisted(() => {
  return {
    addAssistantMessageMock: vi.fn(),
    addUserMessageMock: vi.fn(),
    deleteAbortControllerMock: vi.fn(),
    finishRunMock: vi.fn(),
    getBridgeWsMock: vi.fn(() => undefined),
    sendMock: vi.fn(),
    setAbortControllerMock: vi.fn(),
    setTerminalResultMock: vi.fn(),
    writeLogMock: vi.fn(),
  };
});

vi.mock('ai', () => {
  return {
    generateText: vi.fn(),
  };
});

vi.mock('../../pricing', () => {
  return {
    getDefaultModelForCategory: vi.fn((category: string) => category),
  };
});

vi.mock('../../utils/models', () => {
  return {
    buildProviderModel: vi.fn(),
  };
});

vi.mock('../../utils/logger', () => {
  return {
    writeLog: writeLogMock,
  };
});

vi.mock('../../utils/sanitize', () => {
  return {
    sanitizeToolEvent: vi.fn((value: any) => value),
    sanitizeSteps: vi.fn((value: any) => value),
  };
});

vi.mock('../../utils/usage', () => {
  return {
    normalizeUsage: vi.fn((usage: any) => usage || {}),
  };
});

vi.mock('../../utils/thread-title', () => {
  return {
    normalizeThreadTitle: vi.fn(),
    THREAD_TITLE_SYSTEM: '',
  };
});

vi.mock('../../memory/context-compactor', () => {
  return {
    compactHistory: vi.fn(async (history: any[]) => history),
  };
});

vi.mock('../../memory/conversations', () => {
  return {
    storeMessageLocally: vi.fn(async () => undefined),
    processConversationTurn: vi.fn(async () => undefined),
  };
});

vi.mock('../../tools/bridge', () => {
  return {
    withClientBridge: vi.fn((_ws: any, fn: any) => fn()),
    getBridgeWs: getBridgeWsMock,
  };
});

vi.mock('../../supabase', () => {
  return {
    addAssistantMessage: addAssistantMessageMock,
    addUserMessage: addUserMessageMock,
    finishRun: finishRunMock,
    setConversationTitle: vi.fn(),
  };
});

vi.mock('../../services/live-usage-billing', () => {
  return {
    LiveUsageBillingTracker: vi.fn(function LiveUsageBillingTrackerMock(this: any) {
      this.settleIncrement = vi.fn(async () => undefined);
      this.settleToUsageList = vi.fn(async () => undefined);
      this.getCumulativeTotals = vi.fn(() => ({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedPromptTokens: 0,
        reasoningTokens: 0,
        costUsd: 0,
        credits: 0,
      }));
    }),
  };
});

vi.mock('../../services/run-state', () => {
  return {
    addPendingApproval: vi.fn(),
    registerRun: vi.fn(),
    removePendingApprovalByToolId: vi.fn(),
    setTerminalResult: setTerminalResultMock,
  };
});

vi.mock('../socket/helpers', () => {
  return {
    isSISMetaTool: vi.fn(() => false),
    send: sendMock,
  };
});

vi.mock('./provider-options', () => {
  return {
    getHardTimeoutMs: vi.fn(() => 0),
  };
});

describe('runPreparedChatStream interjections', () => {
  beforeEach(() => {
    addAssistantMessageMock.mockClear();
    addUserMessageMock.mockClear();
    deleteAbortControllerMock.mockClear();
    finishRunMock.mockClear();
    getBridgeWsMock.mockClear();
    sendMock.mockClear();
    setAbortControllerMock.mockClear();
    setTerminalResultMock.mockClear();
    writeLogMock.mockClear();
  });

  it('injects queued interjection text into the next prepared model step', async () => {
    const ws = { send: vi.fn() } as any;
    const history: any[] = [{ role: 'user', content: 'Original request' }];
    let preparedStepMessages: any[] | undefined;

    const agent = {
      stream: vi.fn(async (_messages: any[], options: any) => {
        const { enqueueInterjection } = await import('../socket/state');
        enqueueInterjection(ws, 'req-steer', 'Use the smaller patch.');

        const preparedStep = await options.prepareStep({
          messages: [{ id: 'existing', role: 'user', content: { format: 2, parts: [{ type: 'text', text: 'Original request' }], content: 'Original request' } }],
          stepNumber: 1,
        });
        preparedStepMessages = preparedStep.messages;

        return {
          fullStream: (async function* emptyStream() {})(),
        };
      }),
    };

    const { runPreparedChatStream } = await import('./stream-runner');

    await runPreparedChatStream({
      ws,
      msg: {},
      requestId: 'req-steer',
      messages: [{ role: 'user', content: 'Original request' }],
      history,
      prompt: 'Original request',
      inputMessages: [{ role: 'user', content: 'Original request' }],
      agent,
      agentType: 'stuard',
      authUser: { userId: 'user-1' },
      requestedMode: 'balanced',
      routedTier: 'balanced',
      chosenModelId: 'openai/test-model',
      conversationId: 'conv-1',
      conversationCreatedNow: false,
      modelLabel: 'openai/test-model',
      resource: 'resource-1',
      thread: 'thread-1',
      maxSteps: 3,
      providerOptions: {},
    } as any);

    const injected = preparedStepMessages?.at(-1);
    expect(injected?.role).toBe('user');
    expect(injected?.content?.format).toBe(2);
    expect(injected?.content?.content).toContain('Use the smaller patch.');
    expect(history.some((message) => String(message.content).includes('Use the smaller patch.'))).toBe(true);
    expect(addUserMessageMock).toHaveBeenCalledWith(
      'user-1',
      'conv-1',
      expect.stringContaining('Use the smaller patch.'),
      expect.objectContaining({ kind: 'steer', appliedTo: 'step' }),
    );
    expect(sendMock).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        type: 'progress',
        event: 'interjection_applied',
        data: { count: 1 },
      }),
      'req-steer',
    );
  });

  it('defers a queued interjection when the stream finishes before another step', async () => {
    const ws = { send: vi.fn() } as any;
    const history: any[] = [{ role: 'user', content: 'Original request' }];

    const agent = {
      stream: vi.fn(async (_messages: any[], options: any) => {
        const { enqueueInterjection } = await import('../socket/state');
        enqueueInterjection(ws, 'req-steer-finish', 'Use the smaller patch.');

        await options.onFinish({
          text: 'Done',
          steps: [],
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        });

        return {
          fullStream: (async function* emptyStream() {})(),
        };
      }),
    };

    const { runPreparedChatStream } = await import('./stream-runner');

    await runPreparedChatStream({
      ws,
      msg: {},
      requestId: 'req-steer-finish',
      messages: [{ role: 'user', content: 'Original request' }],
      history,
      prompt: 'Original request',
      inputMessages: [{ role: 'user', content: 'Original request' }],
      agent,
      agentType: 'stuard',
      authUser: { userId: 'user-1' },
      requestedMode: 'balanced',
      routedTier: 'balanced',
      chosenModelId: 'openai/test-model',
      conversationId: 'conv-1',
      conversationCreatedNow: false,
      modelLabel: 'openai/test-model',
      resource: 'resource-1',
      thread: 'thread-1',
      maxSteps: 3,
      providerOptions: {},
    } as any);

    expect(addUserMessageMock).not.toHaveBeenCalled();
    expect(history.some((message) => String(message.content).includes('Use the smaller patch.'))).toBe(false);
    expect(sendMock).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        type: 'progress',
        event: 'interjection_deferred',
        data: { count: 1 },
      }),
      'req-steer-finish',
    );
  });
});
