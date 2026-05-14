import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getWorkflowAgentMock,
  getOrchestratorAgentMock,
  ensureExecutionToolsRegisteredMock,
  getSkillsFromContextMock,
  buildInputMessagesMock,
  buildProviderOptionsMock,
  resolveMaxStepsMock,
  sendMock,
  conversationsState,
  anonResourcesState,
  anonThreadsState,
  wsConversationsState,
} = vi.hoisted(() => {
  return {
    getWorkflowAgentMock: vi.fn(),
    getOrchestratorAgentMock: vi.fn(),
    ensureExecutionToolsRegisteredMock: vi.fn(async () => {}),
    getSkillsFromContextMock: vi.fn(() => [
      {
        id: 'skill-1',
        name: 'Test Skill',
        description: 'A test skill',
        trigger: 'when asked',
      },
    ]),
    buildInputMessagesMock: vi.fn(async () => [{ role: 'user', content: 'prepared input' }]),
    buildProviderOptionsMock: vi.fn(() => ({ provider: 'mocked' })),
    resolveMaxStepsMock: vi.fn(() => 40),
    sendMock: vi.fn(),
    conversationsState: new Map<any, any[]>(),
    anonResourcesState: new Map<any, string>(),
    anonThreadsState: new Map<any, string>(),
    wsConversationsState: new Map<any, any>(),
  };
});

vi.mock('../../agents/workflow-agent', () => {
  return {
    getWorkflowAgent: getWorkflowAgentMock,
    getWorkflowAgentForUser: getWorkflowAgentMock,
  };
});

vi.mock('../../auth', () => {
  return {
    verifyAccessToken: vi.fn(async () => null),
    AuthErrorCode: {
      UNAUTHORIZED: 'unauthorized',
      EXPIRED_TOKEN: 'expired_token',
    },
  };
});

vi.mock('../../orchestrator', () => {
  return {
    getOrchestratorAgent: getOrchestratorAgentMock,
    getOrchestratorAgentForUser: getOrchestratorAgentMock,
  };
});

vi.mock('../../orchestrator/execution-tools-bootstrap', () => {
  return {
    ensureExecutionToolsRegistered: ensureExecutionToolsRegisteredMock,
  };
});

vi.mock('../../router/model-router', () => {
  return {
    routeModel: vi.fn(),
  };
});

vi.mock('../../supabase', () => {
  return {
    createConversation: vi.fn(),
    addUserMessage: vi.fn(),
    checkAccess: vi.fn(async () => ({ allowed: true })),
    incrementDailyRequestCounter: vi.fn(),
    getExternalAccount: vi.fn(),
  };
});

vi.mock('../../tools/skill-tools', () => {
  return {
    getSkillsFromContext: getSkillsFromContextMock,
  };
});

vi.mock('../../tools/workflow', () => {
  return {
    clearSessionWorkflow: vi.fn(),
    setSessionWorkflow: vi.fn(),
  };
});

vi.mock('../../utils/messages', () => {
  return {
    normalizeMessages: vi.fn((msg: any) => msg.messages || []),
    contentToText: vi.fn((content: any) => {
      if (typeof content === 'string') return content;
      return String(content ?? '');
    }),
  };
});

vi.mock('../../utils/shared-embedding', () => {
  return {
    getOrCreateQueryEmbedding: vi.fn(),
  };
});

vi.mock('../../utils/logger', () => {
  return {
    writeLog: vi.fn(),
  };
});

vi.mock('../../utils/config', () => {
  return {
    ENABLE_ROUTING: true,
    REQUIRE_AUTH: false,
  };
});

vi.mock('../socket/state', () => {
  return {
    anonResources: anonResourcesState,
    anonThreads: anonThreadsState,
    conversations: conversationsState,
    wsConversations: wsConversationsState,
  };
});

vi.mock('./message-context', () => {
  return {
    buildInputMessages: buildInputMessagesMock,
  };
});

vi.mock('./provider-options', () => {
  return {
    buildProviderOptions: buildProviderOptionsMock,
    resolveMaxSteps: resolveMaxStepsMock,
  };
});

vi.mock('../socket/helpers', () => {
  return {
    pickDefaultModelId: vi.fn(),
    send: sendMock,
    normalizeTierChoice: vi.fn((input: any) => (input === 'auto' ? 'auto' : 'balanced')),
  };
});

vi.mock('../socket/auth-handler', () => {
  return {
    registerWebhookState: vi.fn(async () => 0),
    sendRunStateSync: vi.fn(),
  };
});

describe('prepareChatRequest', () => {
  beforeEach(() => {
    getWorkflowAgentMock.mockReset();
    getOrchestratorAgentMock.mockReset();
    ensureExecutionToolsRegisteredMock.mockClear();
    getSkillsFromContextMock.mockClear();
    buildInputMessagesMock.mockClear();
    buildProviderOptionsMock.mockClear();
    resolveMaxStepsMock.mockClear();
    sendMock.mockClear();
    conversationsState.clear();
    anonResourcesState.clear();
    anonThreadsState.clear();
    wsConversationsState.clear();
  });

  it('builds the orchestrator agent for normal chat requests', async () => {
    const agent = { id: 'orchestrator-agent' };
    getOrchestratorAgentMock.mockReturnValue(agent);

    const { prepareChatRequest } = await import('./prepare-chat-request');

    const ws = { send: vi.fn() } as any;
    const secretBag: Record<string, any> = {
      __skills: [
        {
          id: 'skill-1',
          name: 'Test Skill',
          description: 'A test skill',
          trigger: 'when asked',
        },
      ],
    };
    const msg = {
      model: 'balanced',
      modelId: 'openai/gpt-5.4',
      messages: [{ role: 'user', content: 'Use the new server path' }],
      context: {
        skills: secretBag.__skills,
      },
    };

    const prepared = await prepareChatRequest({
      ws,
      msg,
      requestId: 'req-1',
      secretBag,
    });

    expect(ensureExecutionToolsRegisteredMock).toHaveBeenCalledTimes(1);
    expect(getSkillsFromContextMock).toHaveBeenCalledTimes(1);
    expect(getOrchestratorAgentMock).toHaveBeenCalledWith(
      'balanced',
      [],
      {},
      'openai/gpt-5.4',
      getSkillsFromContextMock.mock.results[0]?.value,
      [],
      null,
      undefined,
    );
    expect(buildInputMessagesMock).toHaveBeenCalledWith(expect.objectContaining({ agent }));
    expect(secretBag.__modelTier).toBe('balanced');
    expect(secretBag.__modelId).toBe('openai/gpt-5.4');
    expect(prepared?.agent).toBe(agent);
    expect(prepared?.agentType).toBe('stuard');
  });
});
