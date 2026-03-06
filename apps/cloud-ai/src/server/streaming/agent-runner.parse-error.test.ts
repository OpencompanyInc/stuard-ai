import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  getStuardAgentMock,
  getWorkflowAgentMock,
  writeLogMock,
} = vi.hoisted(() => {
  return {
    getStuardAgentMock: vi.fn(),
    getWorkflowAgentMock: vi.fn(),
    writeLogMock: vi.fn(),
  };
});

vi.mock('../../agents/stuard-agent', () => {
  return {
    getAgent: getStuardAgentMock,
  };
});

vi.mock('../../agents/workflow-agent', () => {
  return {
    getWorkflowAgent: getWorkflowAgentMock,
  };
});

vi.mock('../../utils/logger', () => {
  return {
    writeLog: writeLogMock,
  };
});

vi.mock('../../agents/skill-agent', () => {
  return {
    getSkillAgent: vi.fn(),
    SKILL_SYSTEM_PROMPT: '',
    clearSessionSkill: vi.fn(),
    setSessionSkill: vi.fn(),
  };
});

vi.mock('../../router/model-router', () => {
  return {
    routeModel: vi.fn(),
    ModelChoice: {},
  };
});

vi.mock('../../tools/bridge', () => {
  return {
    withClientBridge: vi.fn((_ws: any, fn: any) => fn()),
  };
});

vi.mock('../../utils/usage', () => {
  return {
    normalizeUsage: vi.fn((u: any) => u),
  };
});

describe('runAgent tool-call JSON parse failure handling', () => {
  beforeEach(() => {
    getStuardAgentMock.mockReset();
    getWorkflowAgentMock.mockReset();
    writeLogMock.mockReset();
  });

  it('emits tool_event:error then final (retryable) when Mastra throws invalid tool-call JSON error shape', async () => {
    const parseError = new SyntaxError('Unterminated string in JSON at position 10');
    const thrown = {
      error: parseError,
      input: '{"a": "unterminated}',
    };

    const agent = {
      stream: vi.fn(async () => {
        throw thrown;
      }),
    };

    getStuardAgentMock.mockReturnValue(agent);

    const sent: any[] = [];
    const ws: any = {
      on: vi.fn(),
      send: (data: string) => {
        sent.push(JSON.parse(data));
      },
    };

    const { runAgent } = await import('./agent-runner');

    await runAgent(ws as any, { text: 'hi', agent: 'stuard', model: 'balanced' } as any);

    const toolEvt = sent.find((m) => m?.type === 'progress' && m?.event === 'tool_event');
    expect(toolEvt).toBeTruthy();
    expect(toolEvt.data?.status).toBe('error');
    expect(toolEvt.data?.error).toBe('invalid_json');
    expect(typeof toolEvt.data?.toolCallId).toBe('string');

    const finalMsg = sent.find((m) => m?.type === 'final');
    expect(finalMsg).toBeTruthy();
    expect(String(finalMsg?.result?.text || '')).toContain('Tool call failed');

    const anyHardError = sent.some((m) => m?.type === 'error');
    expect(anyHardError).toBe(false);

    const logged = writeLogMock.mock.calls.some(([event]) => event === 'tool_call_parse_error');
    expect(logged).toBe(true);
  });
});
