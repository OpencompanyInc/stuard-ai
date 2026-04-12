import { beforeEach, describe, expect, it, vi } from 'vitest';

const logUsageEventMock = vi.fn(async () => {});

vi.mock('../supabase', () => ({
  logUsageEvent: logUsageEventMock,
}));

import { LiveUsageBillingTracker, usageLikeToTotals } from './live-usage-billing';
import { normalizeUsage } from '../utils/usage';

describe('normalizeUsage', () => {
  it('extracts OpenRouter usage accounting metadata', () => {
    const normalized = normalizeUsage({
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
      providerMetadata: {
        openrouter: {
          usage: {
            cost: 0.008,
            promptTokensDetails: { cachedTokens: 12 },
            completionTokensDetails: { reasoningTokens: 7 },
          },
        },
      },
    });

    expect(normalized.promptTokens).toBe(120);
    expect(normalized.completionTokens).toBe(45);
    expect(normalized.totalTokens).toBe(165);
    expect(normalized.cachedPromptTokens).toBe(12);
    expect(normalized.reasoningTokens).toBe(7);
    expect(normalized.costUsd).toBe(0.008);
  });
});

describe('LiveUsageBillingTracker', () => {
  beforeEach(() => {
    logUsageEventMock.mockClear();
  });

  it('settles cumulative credit deltas instead of re-rounding each step independently', async () => {
    const tracker = new LiveUsageBillingTracker({
      userId: 'user-1',
      conversationId: 'conv-1',
      model: 'openrouter/openai/gpt-4.1-mini',
      sourceRef: 'test-run',
      sourceType: 'inference',
      sourceLabel: 'Chat',
    });

    await tracker.settleIncrement({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      costUsd: 0.008,
    }, {
      trigger: 'step_finish',
      stepNumber: 1,
    });

    await tracker.settleIncrement({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      costUsd: 0.008,
    }, {
      trigger: 'step_finish',
      stepNumber: 2,
    });

    const calls = logUsageEventMock.mock.calls as any[];
    expect(logUsageEventMock).toHaveBeenCalledTimes(2);
    expect(calls[0][3].creditCost).toBe(0.5);
    expect(calls[1][3].creditCost).toBe(0.25);
    expect(tracker.getCumulativeTotals().credits).toBe(0.75);
  });

  it('uses OpenRouter exact cost metadata when building billable totals', () => {
    const totals = usageLikeToTotals('openrouter/anthropic/claude-sonnet-4', {
      usage: {
        inputTokens: 250,
        outputTokens: 50,
        totalTokens: 300,
      },
      providerMetadata: {
        openrouter: {
          usage: {
            cost: 0.01,
            promptTokensDetails: { cachedTokens: 25 },
            completionTokensDetails: { reasoningTokens: 9 },
          },
        },
      },
    });

    expect(totals.promptTokens).toBe(250);
    expect(totals.completionTokens).toBe(50);
    expect(totals.totalTokens).toBe(300);
    expect(totals.cachedPromptTokens).toBe(25);
    expect(totals.reasoningTokens).toBe(9);
    expect(totals.costUsd).toBe(0.01);
    expect(totals.credits).toBe(0.5);
  });
});
