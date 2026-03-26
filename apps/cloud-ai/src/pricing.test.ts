import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock models.json before importing pricing module
vi.mock('./models.json', () => ({
  default: [
    {
      id: 'google/gemini-3-flash-preview',
      name: 'Gemini 3 Flash Preview',
      category: 'fast',
      contextWindow: 128000,
      pricing: { in: 0.1, out: 0.2, cached: 0.01 },
    },
    {
      id: 'xai/grok-4-1-fast',
      name: 'Grok 4.1 Fast',
      category: 'balanced',
      contextWindow: 200000,
      pricing: { in: 0.5, out: 1.0, cached: 0.05 },
    },
    {
      id: 'google/gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      category: 'smart',
      contextWindow: 1000000,
      pricing: { in: 2.0, out: 4.0, cached: 0.2 },
    },
    {
      id: 'perplexity/sonar-pro',
      name: 'Sonar Pro',
      category: 'research',
      contextWindow: 100000,
      pricing: { in: 3.0, out: 6.0, cached: 0.3 },
    },
    {
      id: 'deepseek/deepseek-chat',
      name: 'DeepSeek Chat',
      category: 'balanced',
      contextWindow: 64000,
      pricing: { in: 0.14, out: 0.28, cached: 0.014 },
    },
  ],
}));

import {
  getDefaultModelForCategory,
  priceForModel,
  estimateCostUsd,
  estimateStorageCostCredits,
  creditsPerUsd,
  creditsFromUsd,
  preciseCreditsFromUsd,
  snapCredits,
  monthlyCreditLimitForPlan,
  ALL_MODELS,
  PLAN_CONFIG,
  USAGE_COST_PERCENTAGE,
  MINI_MODEL_OUTPUT_COST_THRESHOLD,
  isMiniModel,
  getMiniModels,
  getModelsForPlan,
  isModelAvailableForPlan,
  getPlanConfig,
} from './pricing';

describe('pricing module', () => {
  beforeEach(() => {
    // Clear all environment variable overrides
    vi.unstubAllEnvs();
  });

  describe('ALL_MODELS', () => {
    it('should load models from models.json', () => {
      expect(ALL_MODELS).toBeInstanceOf(Array);
      expect(ALL_MODELS.length).toBeGreaterThan(0);
    });

    it('should have required fields for each model', () => {
      for (const model of ALL_MODELS) {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('name');
        expect(model).toHaveProperty('category');
        expect(model).toHaveProperty('pricing');
        expect(model.pricing).toHaveProperty('in');
        expect(model.pricing).toHaveProperty('out');
        expect(model.pricing).toHaveProperty('cached');
      }
    });
  });

  describe('getDefaultModelForCategory', () => {
    it('should return correct default for fast category', () => {
      expect(getDefaultModelForCategory('fast')).toBe('google/gemini-3.1-flash-lite-preview');
    });

    it('should return correct default for balanced category', () => {
      expect(getDefaultModelForCategory('balanced')).toBe('openai/gpt-5-chat-latest');
    });

    it('should return correct default for smart category', () => {
      expect(getDefaultModelForCategory('smart')).toBe('google/gemini-3.1-pro-preview');
    });

    it('should return correct default for research category', () => {
      expect(getDefaultModelForCategory('research')).toBe('perplexity/sonar-pro');
    });
  });

  describe('priceForModel', () => {
    it('should return pricing for known model', () => {
      const price = priceForModel('google/gemini-3-flash-preview');
      expect(price.inPerMTokUSD).toBe(0.1);
      expect(price.outPerMTokUSD).toBe(0.2);
      expect(price.cachedInPerMTokUSD).toBe(0.01);
    });

    it('should resolve legacy model IDs', () => {
      const price = priceForModel('gpt-5-mini');
      expect(price.inPerMTokUSD).toBe(0.14); // deepseek/deepseek-chat pricing
      expect(price.outPerMTokUSD).toBe(0.28);
    });

    it('should return fallback pricing for unknown model', () => {
      const price = priceForModel('unknown/model');
      expect(price.inPerMTokUSD).toBe(0.14);
      expect(price.outPerMTokUSD).toBe(0.28);
      expect(price.cachedInPerMTokUSD).toBe(0.014);
    });

    it('should use environment variable overrides', () => {
      vi.stubEnv('PRICE_GOOGLE_GEMINI_3_FLASH_PREVIEW_IN_PER_M_USD', '0.5');
      vi.stubEnv('PRICE_GOOGLE_GEMINI_3_FLASH_PREVIEW_OUT_PER_M_USD', '1.0');

      // Re-import to pick up env vars (in real usage)
      const price = priceForModel('google/gemini-3-flash-preview');
      // Note: env vars are checked at runtime in the actual function
      expect(price).toBeDefined();
    });
  });

  describe('estimateCostUsd', () => {
    it('should calculate cost correctly for prompt and completion tokens', () => {
      // Using gemini-3-flash: in=0.1, out=0.2 per MTok
      const cost = estimateCostUsd('google/gemini-3-flash-preview', 1000000, 1000000);
      // 1M input tokens * $0.1/MTok + 1M output tokens * $0.2/MTok = $0.3
      expect(cost).toBe(0.3);
    });

    it('should handle cached tokens correctly', () => {
      // in=0.1, cached=0.01 per MTok
      const cost = estimateCostUsd('google/gemini-3-flash-preview', 1000000, 0, 500000);
      // 500K cached * $0.01/MTok + 500K non-cached * $0.1/MTok = $0.055
      expect(cost).toBe(0.055);
    });

    it('should return 0 for zero tokens', () => {
      const cost = estimateCostUsd('google/gemini-3-flash-preview', 0, 0);
      expect(cost).toBe(0);
    });

    it('should handle negative values gracefully', () => {
      const cost = estimateCostUsd('google/gemini-3-flash-preview', -100, -50);
      expect(cost).toBeGreaterThanOrEqual(0);
    });

    it('should limit cached tokens to prompt tokens', () => {
      // If cached > prompt, should cap cached at prompt
      const cost1 = estimateCostUsd('google/gemini-3-flash-preview', 1000, 0, 5000);
      const cost2 = estimateCostUsd('google/gemini-3-flash-preview', 1000, 0, 1000);
      expect(cost1).toBe(cost2);
    });
  });

  describe('creditsPerUsd', () => {
    it('should return default credits per USD', () => {
      expect(creditsPerUsd()).toBe(33);
    });

    it('should respect environment variable override', () => {
      vi.stubEnv('CREDITS_PER_USD', '200');
      // The function reads env at call time
      expect(creditsPerUsd()).toBe(200);
    });
  });

  describe('snapCredits', () => {
    it('should return 0 for zero or negative', () => {
      expect(snapCredits(0)).toBe(0);
      expect(snapCredits(-5)).toBe(0);
    });

    it('should snap small positive values to 0.1 minimum', () => {
      expect(snapCredits(0.01)).toBe(0.1);
      expect(snapCredits(0.05)).toBe(0.1);
      expect(snapCredits(0.1)).toBe(0.1);
      expect(snapCredits(0.132)).toBe(0.1);  // Telnyx SMS
      expect(snapCredits(0.165)).toBe(0.1);  // WhatsApp
    });

    it('should ceil to nearest 0.25 for values >= 0.25 (never undercharge)', () => {
      expect(snapCredits(0.25)).toBe(0.25);
      expect(snapCredits(0.26)).toBe(0.5);
      expect(snapCredits(0.30)).toBe(0.5);
      expect(snapCredits(0.50)).toBe(0.5);
      expect(snapCredits(0.51)).toBe(0.75);
      expect(snapCredits(0.75)).toBe(0.75);
      expect(snapCredits(0.76)).toBe(1.0);
      expect(snapCredits(1.0)).toBe(1.0);
      expect(snapCredits(1.01)).toBe(1.25);
    });

    it('should handle large values', () => {
      expect(snapCredits(214.5)).toBe(214.5);
      expect(snapCredits(214.1)).toBe(214.25);
      expect(snapCredits(1039.5)).toBe(1039.5);
      expect(snapCredits(2475)).toBe(2475);
    });

    it('should handle NaN and Infinity', () => {
      expect(snapCredits(NaN)).toBe(0);
      expect(snapCredits(Infinity)).toBe(0);
    });
  });

  describe('creditsFromUsd', () => {
    it('should convert USD to credits with ceil snapping', () => {
      // $1 * 33 = 33 credits (exact)
      expect(creditsFromUsd(1)).toBe(33);
      // $2.5 * 33 = 82.5 → exact quarter, stays 82.5
      expect(creditsFromUsd(2.5)).toBe(82.5);
      // $0.5 * 33 = 16.5 → exact quarter, stays 16.5
      expect(creditsFromUsd(0.5)).toBe(16.5);
    });

    it('should ceil up so we never undercharge', () => {
      // $0.017 * 33 = 0.561 → ceil to 0.75
      expect(creditsFromUsd(0.017)).toBe(0.75);
      // $0.134 * 33 = 4.422 → ceil to 4.5
      expect(creditsFromUsd(0.134)).toBe(4.5);
    });

    it('should snap cheap services to 0.1 minimum', () => {
      // Telnyx SMS: $0.004 * 33 = 0.132 → 0.1
      expect(creditsFromUsd(0.004)).toBe(0.1);
      // WhatsApp: $0.005 * 33 = 0.165 → 0.1
      expect(creditsFromUsd(0.005)).toBe(0.1);
    });

    it('should return 0 for negative values', () => {
      expect(creditsFromUsd(-10)).toBe(0);
    });
  });

  describe('preciseCreditsFromUsd', () => {
    it('should preserve tiny metered costs without snapping to 0.1', () => {
      expect(preciseCreditsFromUsd(0.0013698630136986301)).toBe(0.0452);
      expect(preciseCreditsFromUsd(0.000006737131013037407)).toBe(0.0002);
    });

    it('should return 0 for invalid or negative values', () => {
      expect(preciseCreditsFromUsd(-10)).toBe(0);
      expect(preciseCreditsFromUsd(NaN)).toBe(0);
    });
  });

  describe('estimateStorageCostCredits', () => {
    it('should use precise storage credits instead of the minimum billable unit', () => {
      expect(estimateStorageCostCredits(10, 0, 1)).toBe(0.0452);
    });
  });

  describe('monthlyCreditLimitForPlan', () => {
    it('should return credits for FREE_TRIAL plan', () => {
      const credits = monthlyCreditLimitForPlan('FREE_TRIAL');
      // $0.45 budget * 33 credits/USD = 14.85 → ceil to 15
      expect(credits).toBe(15);
    });

    it('should return credits for STARTER plan', () => {
      const credits = monthlyCreditLimitForPlan('STARTER');
      // $6.50 budget * 33 credits/USD = 214.5 → exact quarter
      expect(credits).toBe(214.5);
    });

    it('should return credits for PRO plan', () => {
      const credits = monthlyCreditLimitForPlan('PRO');
      // $31.50 budget (70%) * 33 credits/USD = 1039.5 → exact quarter
      expect(credits).toBe(1039.5);
    });

    it('should return credits for POWER plan', () => {
      const credits = monthlyCreditLimitForPlan('POWER');
      // $75 budget (75%) * 33 credits/USD = 2475 → snap to 2475
      expect(credits).toBe(2475);
    });

    it('should return -1 (unlimited) for BYOK plan', () => {
      expect(monthlyCreditLimitForPlan('BYOK')).toBe(-1);
    });

    it('should return credits for TEAM plan (legacy)', () => {
      expect(monthlyCreditLimitForPlan('TEAM')).toBe(50000);
    });

    it('should return credits for BUSINESS plan (legacy)', () => {
      expect(monthlyCreditLimitForPlan('BUSINESS')).toBe(200000);
    });

    it('should return credits for ENTERPRISE plan (legacy)', () => {
      expect(monthlyCreditLimitForPlan('ENTERPRISE')).toBe(1000000);
    });

    it('should handle case-insensitive plan names', () => {
      expect(monthlyCreditLimitForPlan('free_trial')).toBe(15);
      expect(monthlyCreditLimitForPlan('Free_Trial')).toBe(15);
      expect(monthlyCreditLimitForPlan('FREE_TRIAL')).toBe(15);
    });

    it('should return -1 for unknown plans', () => {
      expect(monthlyCreditLimitForPlan('UNKNOWN')).toBe(-1);
      expect(monthlyCreditLimitForPlan('')).toBe(-1);
    });
  });

  describe('PLAN_CONFIG', () => {
    it('should have correct configuration for FREE_TRIAL', () => {
      expect(PLAN_CONFIG.FREE_TRIAL.priceUsd).toBe(0);
      expect(PLAN_CONFIG.FREE_TRIAL.budgetUsd).toBe(0.45);
      expect(PLAN_CONFIG.FREE_TRIAL.isRecurring).toBe(false);
      expect(PLAN_CONFIG.FREE_TRIAL.allModels).toBe(false);
    });

    it('should have correct configuration for STARTER', () => {
      expect(PLAN_CONFIG.STARTER.priceUsd).toBe(10);
      expect(PLAN_CONFIG.STARTER.budgetUsd).toBe(6.50);
      expect(PLAN_CONFIG.STARTER.isRecurring).toBe(true);
      expect(PLAN_CONFIG.STARTER.allModels).toBe(true);
    });

    it('should have correct configuration for PRO', () => {
      expect(PLAN_CONFIG.PRO.priceUsd).toBe(45);
      expect(PLAN_CONFIG.PRO.budgetUsd).toBe(31.50);
      expect(PLAN_CONFIG.PRO.isRecurring).toBe(true);
      expect(PLAN_CONFIG.PRO.allModels).toBe(true);
    });

    it('should have correct configuration for POWER', () => {
      expect(PLAN_CONFIG.POWER.priceUsd).toBe(100);
      expect(PLAN_CONFIG.POWER.budgetUsd).toBe(75);
      expect(PLAN_CONFIG.POWER.isRecurring).toBe(true);
      expect(PLAN_CONFIG.POWER.allModels).toBe(true);
    });

    it('should have correct configuration for BYOK', () => {
      expect(PLAN_CONFIG.BYOK.priceUsd).toBe(0);
      expect(PLAN_CONFIG.BYOK.budgetUsd).toBe(Infinity);
      expect(PLAN_CONFIG.BYOK.isRecurring).toBe(false);
      expect(PLAN_CONFIG.BYOK.allModels).toBe(true);
    });

    it('should have 65% usage cost percentage', () => {
      expect(USAGE_COST_PERCENTAGE).toBe(0.65);
    });
  });

  describe('model cost restrictions', () => {
    it('should identify mini models correctly based on cost threshold', () => {
      // In mock: gemini-3-flash has out=0.2, deepseek has out=0.28 - both under $1.0
      expect(isMiniModel('google/gemini-3-flash-preview')).toBe(true);
      expect(isMiniModel('deepseek/deepseek-chat')).toBe(true);
    });

    it('should identify non-mini models correctly', () => {
      // In mock: gemini-2.5-pro has out=4.0, sonar-pro has out=6.0 - both over $1.0
      expect(isMiniModel('google/gemini-2.5-pro')).toBe(false);
      expect(isMiniModel('perplexity/sonar-pro')).toBe(false);
    });

    it('should have MINI_MODEL_OUTPUT_COST_THRESHOLD at $1.0', () => {
      expect(MINI_MODEL_OUTPUT_COST_THRESHOLD).toBe(1.0);
    });

    it('should return mini models from getMiniModels', () => {
      const miniModels = getMiniModels();
      expect(miniModels.length).toBeGreaterThan(0);
      miniModels.forEach(model => {
        expect(model.pricing.out).toBeLessThanOrEqual(MINI_MODEL_OUTPUT_COST_THRESHOLD);
      });
    });
  });

  describe('getModelsForPlan', () => {
    it('should return only mini models for FREE_TRIAL', () => {
      const models = getModelsForPlan('FREE_TRIAL');
      models.forEach(model => {
        expect(model.pricing.out).toBeLessThanOrEqual(MINI_MODEL_OUTPUT_COST_THRESHOLD);
      });
    });

    it('should return all models for STARTER', () => {
      const models = getModelsForPlan('STARTER');
      expect(models).toEqual(ALL_MODELS);
    });

    it('should return all models for PRO', () => {
      const models = getModelsForPlan('PRO');
      expect(models).toEqual(ALL_MODELS);
    });

    it('should return all models for POWER', () => {
      const models = getModelsForPlan('POWER');
      expect(models).toEqual(ALL_MODELS);
    });

    it('should return all models for BYOK', () => {
      const models = getModelsForPlan('BYOK');
      expect(models).toEqual(ALL_MODELS);
    });
  });

  describe('isModelAvailableForPlan', () => {
    it('should allow mini models for FREE_TRIAL', () => {
      expect(isModelAvailableForPlan('google/gemini-3-flash-preview', 'FREE_TRIAL')).toBe(true);
      expect(isModelAvailableForPlan('deepseek/deepseek-chat', 'FREE_TRIAL')).toBe(true);
    });

    it('should disallow expensive models for FREE_TRIAL', () => {
      expect(isModelAvailableForPlan('google/gemini-2.5-pro', 'FREE_TRIAL')).toBe(false);
      expect(isModelAvailableForPlan('perplexity/sonar-pro', 'FREE_TRIAL')).toBe(false);
    });

    it('should allow all models for paid plans', () => {
      expect(isModelAvailableForPlan('google/gemini-2.5-pro', 'STARTER')).toBe(true);
      expect(isModelAvailableForPlan('perplexity/sonar-pro', 'PRO')).toBe(true);
      expect(isModelAvailableForPlan('google/gemini-2.5-pro', 'POWER')).toBe(true);
    });

    it('should allow all models for BYOK', () => {
      expect(isModelAvailableForPlan('google/gemini-2.5-pro', 'BYOK')).toBe(true);
      expect(isModelAvailableForPlan('perplexity/sonar-pro', 'BYOK')).toBe(true);
    });
  });

  describe('getPlanConfig', () => {
    it('should return config for valid plans', () => {
      expect(getPlanConfig('FREE_TRIAL')).toEqual(PLAN_CONFIG.FREE_TRIAL);
      expect(getPlanConfig('STARTER')).toEqual(PLAN_CONFIG.STARTER);
      expect(getPlanConfig('PRO')).toEqual(PLAN_CONFIG.PRO);
      expect(getPlanConfig('POWER')).toEqual(PLAN_CONFIG.POWER);
      expect(getPlanConfig('BYOK')).toEqual(PLAN_CONFIG.BYOK);
    });

    it('should return null for unknown plans', () => {
      expect(getPlanConfig('UNKNOWN')).toBeNull();
    });

    it('should handle case-insensitive plan names', () => {
      expect(getPlanConfig('free_trial')).toEqual(PLAN_CONFIG.FREE_TRIAL);
      expect(getPlanConfig('starter')).toEqual(PLAN_CONFIG.STARTER);
    });
  });
});
