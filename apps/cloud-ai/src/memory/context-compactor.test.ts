import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({ text: '## TASK\nSummarized objective.' })),
}));
vi.mock('../utils/models', () => ({
  buildNativeProviderModel: vi.fn(() => ({ modelId: 'mock-model' })),
}));

import { generateText } from 'ai';
import {
  compactHistory,
  emergencyTruncate,
  getRecentWithinBudget,
  isSummaryMessage,
  SUMMARY_PREFIX,
} from './context-compactor';
import { computeBudget, estimateTokens } from './token-budget';

const TEST_ENV: Record<string, string> = {
  // Deterministic small budget: historyBudget = 60000 - 9000 - 4096 - 10000 = 36904
  COMPACTION_FALLBACK_CONTEXT: '60000',
  // Disable tool-output pruning so message sizes stay deterministic
  COMPACTION_PRUNE_MINIMUM: '999999999',
};
const MODEL_ID = 'not-a-real-model'; // forces the fallback context window

function bigText(chars: number): string {
  return 'x'.repeat(chars);
}

function toolCallPair(i: number, resultChars = 6000) {
  return [
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: `call-${i}`, toolName: 'search', args: { q: `query ${i}` } }],
    },
    {
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: `call-${i}`, toolName: 'search', result: bigText(resultChars) }],
    },
  ];
}

function chatHistory(messageCount: number, charsEach = 3000) {
  const messages: any[] = [
    { role: 'system', content: 'SYSTEM PROMPT: you are the subagent.' },
    { role: 'user', content: 'ORIGINAL TASK: research the topic and report back.' },
  ];
  for (let i = 0; i < messageCount; i += 1) {
    messages.push({ role: i % 2 === 0 ? 'assistant' : 'user', content: `msg ${i} ${bigText(charsEach)}` });
  }
  return messages;
}

function toolHistory(pairCount: number) {
  const messages: any[] = [
    { role: 'system', content: 'SYSTEM PROMPT: you are the subagent.' },
    { role: 'user', content: 'ORIGINAL TASK: research the topic and report back.' },
  ];
  for (let i = 0; i < pairCount; i += 1) {
    messages.push(...toolCallPair(i));
  }
  return messages;
}

function summaryIndices(messages: any[]): number[] {
  return messages
    .map((msg, idx) => (typeof msg.content === 'string' && msg.content.startsWith(SUMMARY_PREFIX) ? idx : -1))
    .filter((idx) => idx >= 0);
}

beforeEach(() => {
  for (const [key, value] of Object.entries(TEST_ENV)) process.env[key] = value;
  vi.mocked(generateText).mockClear();
});

afterEach(() => {
  for (const key of Object.keys(TEST_ENV)) delete process.env[key];
});

describe('compactHistory', () => {
  it('preserves the leading system prompt and original task message', async () => {
    const history = chatHistory(60);
    const before = estimateTokens(history).totalTokens;

    const result = await compactHistory(history, MODEL_ID);

    expect(result[0].role).toBe('system');
    expect(result[0].content).toContain('SYSTEM PROMPT');
    expect(result[1].role).toBe('user');
    expect(result[1].content).toContain('ORIGINAL TASK');
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(estimateTokens(result as any[]).totalTokens).toBeLessThan(before);
  });

  it('places the summary right after the protected prefix as a user message', async () => {
    const result = await compactHistory(chatHistory(60), MODEL_ID);

    const indices = summaryIndices(result);
    expect(indices).toEqual([2]);
    expect(result[2].role).toBe('user');
    expect(isSummaryMessage(result[2])).toBe(true);
  });

  it('never starts the kept window with an orphaned tool result', async () => {
    const result = await compactHistory(toolHistory(25), MODEL_ID);

    const indices = summaryIndices(result);
    expect(indices.length).toBe(1);
    const afterSummary = result[indices[0] + 1];
    expect(afterSummary?.role).not.toBe('tool');
    // Global invariant: every tool message must directly follow an assistant
    // (tool call) or another tool message.
    for (let i = 0; i < result.length; i += 1) {
      if (result[i].role === 'tool') {
        expect(['assistant', 'tool']).toContain(result[i - 1]?.role);
      }
    }
  });

  it('merges a previous summary instead of stacking summaries', async () => {
    const history = chatHistory(60);
    history.splice(2, 0, { role: 'user', content: `${SUMMARY_PREFIX}\nOld summary from a prior round.` });

    const result = await compactHistory(history, MODEL_ID);

    expect(summaryIndices(result).length).toBe(1);
    // The old summary must have been fed into the regeneration prompt
    const prompt = vi.mocked(generateText).mock.calls[0][0] as any;
    expect(String(prompt.prompt)).toContain('Old summary from a prior round.');
  });

  it('does nothing when under the compaction trigger', async () => {
    const history = chatHistory(4, 200);
    const result = await compactHistory(history, MODEL_ID);

    expect(summaryIndices(result).length).toBe(0);
    expect(generateText).not.toHaveBeenCalled();
    expect(result.length).toBe(history.length);
  });
});

describe('emergencyTruncate', () => {
  it('removes tool results together with their tool call (no orphans)', () => {
    const history = toolHistory(40);
    const budget = computeBudget(MODEL_ID);

    emergencyTruncate(history as any[], budget);

    expect(history[0].role).toBe('system');
    expect(history[1].content).toContain('ORIGINAL TASK');
    for (let i = 0; i < history.length; i += 1) {
      if (history[i].role === 'tool') {
        expect(['assistant', 'tool']).toContain(history[i - 1]?.role);
      }
    }
  });
});

describe('getRecentWithinBudget', () => {
  it('does not start the kept window on a tool message', () => {
    const history = toolHistory(40);
    const budget = computeBudget(MODEL_ID);

    const kept = getRecentWithinBudget(history as any[], budget);

    const firstNonSystem = kept.find((msg: any) => msg.role !== 'system');
    expect(firstNonSystem?.role).not.toBe('tool');
    for (let i = 0; i < kept.length; i += 1) {
      if ((kept[i] as any).role === 'tool') {
        expect(['assistant', 'tool']).toContain((kept[i - 1] as any)?.role);
      }
    }
  });
});
