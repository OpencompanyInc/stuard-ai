import { creditsFromUsd, estimateCostUsd } from '../pricing';
import { logUsageEvent } from '../supabase';
import { isNonBillableUsageEvent } from '../utils/billing-usage';
import { writeLog } from '../utils/logger';
import { normalizeUsage } from '../utils/usage';

export interface BillingTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
  reasoningTokens: number;
  costUsd: number;
  credits: number;
}

export interface LiveUsageSettlementSummary {
  trigger: string;
  stepNumber?: number;
  settled: boolean;
  sourceRef: string;
  model: string;
  conversationId: string | null;
  delta: BillingTotals;
  cumulative: BillingTotals;
}

export interface LiveUsageBillingTrackerOptions {
  userId?: string | null;
  conversationId?: string | null;
  model: string;
  sourceRef: string;
  sourceType?: string;
  sourceLabel?: string;
  billingExcluded?: boolean;
  onSettlement?: (summary: LiveUsageSettlementSummary) => void | Promise<void>;
}

function roundUsd(value: number): number {
  return Number((Number.isFinite(value) ? value : 0).toFixed(8));
}

function roundCredits(value: number): number {
  return Number((Number.isFinite(value) ? value : 0).toFixed(4));
}

export function emptyBillingTotals(): BillingTotals {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedPromptTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    credits: 0,
  };
}

function toUsageLike(input: any): any {
  if (input && typeof input === 'object' && input.usage && input.providerMetadata) {
    return {
      ...(input.usage || {}),
      providerMetadata: input.providerMetadata,
    };
  }
  return input;
}

export function usageLikeToTotals(model: string, input: any): BillingTotals {
  if (isNonBillableUsageEvent({ model, raw: input })) {
    return emptyBillingTotals();
  }
  const usage = normalizeUsage(toUsageLike(input));
  const promptTokens = Math.max(0, Number(usage.promptTokens || 0));
  const completionTokens = Math.max(0, Number(usage.completionTokens || 0));
  const totalTokens = Math.max(
    0,
    Number(usage.totalTokens || 0) || (promptTokens + completionTokens),
  );
  const cachedPromptTokens = Math.max(0, Number(usage.cachedPromptTokens || 0));
  const reasoningTokens = Math.max(
    0,
    Number(usage.reasoningTokens || usage.thinkingTokens || 0),
  );
  const explicitCostUsd = Number(usage.costUsd ?? usage.cost_usd);
  const costUsd = Number.isFinite(explicitCostUsd) && explicitCostUsd >= 0
    ? roundUsd(explicitCostUsd)
    : roundUsd(estimateCostUsd(model, promptTokens, completionTokens, cachedPromptTokens));

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedPromptTokens,
    reasoningTokens,
    costUsd,
    credits: roundCredits(creditsFromUsd(costUsd)),
  };
}

export function addBillingTotals(base: BillingTotals, delta: BillingTotals): BillingTotals {
  const costUsd = roundUsd(base.costUsd + delta.costUsd);
  return {
    promptTokens: Math.max(0, base.promptTokens + delta.promptTokens),
    completionTokens: Math.max(0, base.completionTokens + delta.completionTokens),
    totalTokens: Math.max(0, base.totalTokens + delta.totalTokens),
    cachedPromptTokens: Math.max(0, base.cachedPromptTokens + delta.cachedPromptTokens),
    reasoningTokens: Math.max(0, base.reasoningTokens + delta.reasoningTokens),
    costUsd,
    credits: roundCredits(creditsFromUsd(costUsd)),
  };
}

export function totalsFromUsageList(model: string, inputs: any[]): BillingTotals {
  return (Array.isArray(inputs) ? inputs : []).reduce(
    (totals, input) => addBillingTotals(totals, usageLikeToTotals(model, input)),
    emptyBillingTotals(),
  );
}

export function subtractBillingTotals(current: BillingTotals, previous: BillingTotals): BillingTotals {
  return {
    promptTokens: Math.max(0, current.promptTokens - previous.promptTokens),
    completionTokens: Math.max(0, current.completionTokens - previous.completionTokens),
    totalTokens: Math.max(0, current.totalTokens - previous.totalTokens),
    cachedPromptTokens: Math.max(0, current.cachedPromptTokens - previous.cachedPromptTokens),
    reasoningTokens: Math.max(0, current.reasoningTokens - previous.reasoningTokens),
    costUsd: roundUsd(Math.max(0, current.costUsd - previous.costUsd)),
    credits: roundCredits(Math.max(0, current.credits - previous.credits)),
  };
}

function hasBillableDelta(delta: BillingTotals): boolean {
  return delta.totalTokens > 0 || delta.credits > 0 || delta.costUsd > 0;
}

export class LiveUsageBillingTracker {
  private cumulativeTotals = emptyBillingTotals();
  private settledTotals = emptyBillingTotals();
  private readonly options: Required<Pick<LiveUsageBillingTrackerOptions, 'model' | 'sourceRef'>> & LiveUsageBillingTrackerOptions;

  constructor(options: LiveUsageBillingTrackerOptions) {
    this.options = {
      sourceType: 'inference',
      sourceLabel: 'Chat',
      conversationId: null,
      ...options,
      model: options.model,
      sourceRef: options.sourceRef,
    };
  }

  getCumulativeTotals(): BillingTotals {
    return { ...this.cumulativeTotals };
  }

  getSettledTotals(): BillingTotals {
    return { ...this.settledTotals };
  }

  setBillingExcluded(excluded: boolean): void {
    this.options.billingExcluded = excluded;
  }

  async settleIncrement(input: any, meta: { trigger: string; stepNumber?: number; partial?: boolean }):
    Promise<LiveUsageSettlementSummary> {
    const usageInput = this.options.billingExcluded ? { ...toUsageLike(input), billingExcluded: true } : input;
    this.cumulativeTotals = addBillingTotals(this.cumulativeTotals, usageLikeToTotals(this.options.model, usageInput));
    return this.flush(meta);
  }

  async settleToUsageList(inputs: any[], meta: { trigger: string; stepNumber?: number; partial?: boolean }):
    Promise<LiveUsageSettlementSummary> {
    const usageInputs = this.options.billingExcluded
      ? (Array.isArray(inputs) ? inputs : []).map((input) => ({ ...toUsageLike(input), billingExcluded: true }))
      : inputs;
    this.cumulativeTotals = totalsFromUsageList(this.options.model, usageInputs);
    return this.flush(meta);
  }

  private async flush(meta: { trigger: string; stepNumber?: number; partial?: boolean }):
    Promise<LiveUsageSettlementSummary> {
    const delta = subtractBillingTotals(this.cumulativeTotals, this.settledTotals);
    const summary: LiveUsageSettlementSummary = {
      trigger: meta.trigger,
      stepNumber: meta.stepNumber,
      settled: false,
      sourceRef: this.options.sourceRef,
      model: this.options.model,
      conversationId: this.options.conversationId || null,
      delta,
      cumulative: { ...this.cumulativeTotals },
    };

    if (!this.options.userId || !hasBillableDelta(delta)) {
      return summary;
    }

    try {
      await logUsageEvent(
        this.options.userId,
        this.options.conversationId || null,
        this.options.model,
        {
          promptTokens: delta.promptTokens,
          completionTokens: delta.completionTokens,
          totalTokens: delta.totalTokens,
          cachedPromptTokens: delta.cachedPromptTokens,
          reasoningTokens: delta.reasoningTokens,
          costUsd: delta.costUsd,
          creditCost: delta.credits,
          sourceType: this.options.sourceType,
          source_label: this.options.sourceLabel,
          ...(this.options.billingExcluded ? { billingExcluded: true } : {}),
          sourceRef: this.options.sourceRef,
          settlement_trigger: meta.trigger,
          settlement_step_number: meta.stepNumber,
          partial: meta.partial === true,
          cumulative_prompt_tokens: this.cumulativeTotals.promptTokens,
          cumulative_completion_tokens: this.cumulativeTotals.completionTokens,
          cumulative_total_tokens: this.cumulativeTotals.totalTokens,
          cumulative_cost_usd: this.cumulativeTotals.costUsd,
          cumulative_credit_cost: this.cumulativeTotals.credits,
        },
      );
      this.settledTotals = { ...this.cumulativeTotals };
      summary.settled = true;
      try {
        writeLog('live_usage_billed', {
          sourceRef: this.options.sourceRef,
          trigger: meta.trigger,
          stepNumber: meta.stepNumber,
          model: this.options.model,
          deltaCredits: delta.credits,
          totalCredits: this.cumulativeTotals.credits,
          partial: meta.partial === true,
        });
      } catch { }
      try {
        await this.options.onSettlement?.(summary);
      } catch { }
    } catch (error: any) {
      try {
        writeLog('live_usage_billing_error', {
          sourceRef: this.options.sourceRef,
          trigger: meta.trigger,
          message: String(error?.message || error || 'unknown_error'),
        });
      } catch { }
    }

    return summary;
  }
}
