import modelsData from './models.json';

export type ModelCategory = 'fast' | 'balanced' | 'smart' | 'research';

export type PlanType = 'FREE_TRIAL' | 'STARTER' | 'PRO' | 'POWER' | 'BYOK';

export interface ModelInfo {
  id: string;
  name: string;
  category: ModelCategory;
  contextWindow?: number;
  pricing: {
    in: number;
    out: number;
    cached: number;
  };
}

type Price = { inPerMTokUSD: number; outPerMTokUSD: number; cachedInPerMTokUSD: number };

/**
 * Plan configuration with pricing and budget details
 * Budget = 65% of plan price allocated to usage
 */
export const PLAN_CONFIG: Record<PlanType, {
  priceUsd: number;
  budgetUsd: number;
  isRecurring: boolean;
  allModels: boolean;
}> = {
  FREE_TRIAL: { priceUsd: 0, budgetUsd: 0.50, isRecurring: false, allModels: false },
  STARTER: { priceUsd: 10, budgetUsd: 6.50, isRecurring: true, allModels: true },
  PRO: { priceUsd: 45, budgetUsd: 29.25, isRecurring: true, allModels: true },
  POWER: { priceUsd: 100, budgetUsd: 65, isRecurring: true, allModels: true },
  BYOK: { priceUsd: 0, budgetUsd: Infinity, isRecurring: false, allModels: true },
};

/**
 * Usage cost percentage - how much of plan price goes to API usage budget
 */
export const USAGE_COST_PERCENTAGE = 0.65;

/**
 * Cost threshold for "mini" models (output price per MTok in USD)
 * Models with output price <= this threshold are considered "mini" models
 * and are available to Free Trial users
 */
export const MINI_MODEL_OUTPUT_COST_THRESHOLD = 1.0;

// ─────────────────────────────────────────────────────────────────────────────
// Compute Tier & Storage Pricing
// ─────────────────────────────────────────────────────────────────────────────

export const COMPUTE_TIER_CONFIG: Record<string, { machineType: string; vcpus: number; memoryGb: number; hourlyUsd: number }> = {
  starter: { machineType: 'e2-small',      vcpus: 1, memoryGb: 2,  hourlyUsd: 0.017 },
  basic:   { machineType: 'e2-standard-2', vcpus: 2, memoryGb: 8,  hourlyUsd: 0.067 },
  pro:     { machineType: 'e2-standard-4', vcpus: 4, memoryGb: 16, hourlyUsd: 0.134 },
  power:   { machineType: 'e2-standard-8', vcpus: 8, memoryGb: 32, hourlyUsd: 0.268 },
};

export const STORAGE_PRICING = {
  hotPerGbMonthUsd: 0.10,   // pd-balanced persistent disk
  coldPerGbMonthUsd: 0.02,  // GCS standard class
};

/** Estimate compute cost in credits for a given tier over `hours` hours. */
export function estimateComputeCostCredits(tier: string, hours: number): number {
  const config = COMPUTE_TIER_CONFIG[tier];
  if (!config) return 0;
  return creditsFromUsd(config.hourlyUsd * hours);
}

/** Estimate storage cost in credits for hot (GB) + cold (bytes) over `hours` hours. */
export function estimateStorageCostCredits(hotGb: number, coldBytes: number, hours: number): number {
  const hoursPerMonth = 730;
  const coldGb = coldBytes / (1024 * 1024 * 1024);
  const hotUsd = (hotGb * STORAGE_PRICING.hotPerGbMonthUsd / hoursPerMonth) * hours;
  const coldUsd = (coldGb * STORAGE_PRICING.coldPerGbMonthUsd / hoursPerMonth) * hours;
  return creditsFromUsd(hotUsd + coldUsd);
}

function envNumber(key: string, def: number) {
  const v = process.env[key];
  if (!v) return def;
  const n = Number(v);
  return isNaN(n) ? def : n;
}

/**
 * All available models loaded from models.json
 */
export const ALL_MODELS: ModelInfo[] = modelsData as any;

/**
 * Mapping for legacy model IDs to the new system
 */
const LEGACY_MAPPING: Record<string, string> = {
  'gpt-4.1': 'xai/grok-4-1-fast',
  'gpt-5-mini': 'deepseek/deepseek-chat',
  'gpt-5': 'google/gemini-2.5-pro',
};

/**
 * Get the default model ID for a specific category
 */
export function getDefaultModelForCategory(category: ModelCategory): string {
  const models = ALL_MODELS.filter(m => m.category === category);
  if (models.length > 0) {
    // Return the first one or a specific preferred one
    if (category === 'fast') return 'google/gemini-3.1-flash-lite-preview';
    if (category === 'balanced') return 'xai/grok-4-1-fast';
    if (category === 'smart') return 'google/gemini-2.5-pro';
    if (category === 'research') return 'perplexity/sonar-pro';
    return models[0].id;
  }
  return 'google/gemini-3.1-flash-lite-preview'; // Ultimate fallback
}

export function priceForModel(modelId: string): Price {
  // Resolve legacy mapping or direct ID
  const resolvedId = LEGACY_MAPPING[modelId] || modelId;
  const model = ALL_MODELS.find(m => m.id === resolvedId);

  if (model) {
    // Support environment variable overrides based on the model ID (sanitized)
    const envBase = resolvedId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    return {
      inPerMTokUSD: envNumber(`PRICE_${envBase}_IN_PER_M_USD`, model.pricing.in),
      outPerMTokUSD: envNumber(`PRICE_${envBase}_OUT_PER_M_USD`, model.pricing.out),
      cachedInPerMTokUSD: envNumber(`PRICE_${envBase}_CACHED_IN_PER_M_USD`, model.pricing.cached),
    };
  }

  // Fallback to a default (fast tier)
  return {
    inPerMTokUSD: envNumber('PRICE_DEFAULT_IN_PER_M_USD', 0.14),
    outPerMTokUSD: envNumber('PRICE_DEFAULT_OUT_PER_M_USD', 0.28),
    cachedInPerMTokUSD: envNumber('PRICE_DEFAULT_CACHED_IN_PER_M_USD', 0.014),
  };
}

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number, cachedPromptTokens = 0): number {
  const p = priceForModel(model);
  const cached = Math.max(0, Math.min(Math.max(0, promptTokens), Math.max(0, cachedPromptTokens)));
  const nonCached = Math.max(0, Math.max(0, promptTokens) - cached);
  const inCost = (nonCached / 1_000_000) * p.inPerMTokUSD + (cached / 1_000_000) * p.cachedInPerMTokUSD;
  const outCost = (Math.max(0, completionTokens) / 1_000_000) * p.outPerMTokUSD;
  const total = inCost + outCost;
  return Math.max(0, Number(total.toFixed(8)));
}

export function creditsPerUsd(): number {
  return envNumber('CREDITS_PER_USD', 100);
}

export function creditsFromUsd(usd: number): number {
  const c = usd * creditsPerUsd();
  return Math.max(0, Math.round(c));
}

function planKey(plan: string): string {
  return String(plan || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

export function monthlyCreditLimitForPlan(plan: string): number {
  const key = planKey(plan);
  const envKey = `PLAN_${key}_MONTHLY_CREDITS`;
  const n = envNumber(envKey, -1);
  if (n >= 0) return n;

  // New plan structure with 65% usage budget
  const planConfig = PLAN_CONFIG[key as PlanType];
  if (planConfig) {
    if (planConfig.budgetUsd === Infinity) return -1; // BYOK = unlimited
    return creditsFromUsd(planConfig.budgetUsd);
  }

  // Legacy plan support
  if (key === 'FREE') {
    const freeUsd = envNumber('PLAN_FREE_PRICE_USD', 0.5);
    return creditsFromUsd(freeUsd);
  }
  const priceKey = `PLAN_${key}_PRICE_USD`;
  const price = envNumber(priceKey, -1);
  if (price >= 0) {
    const usageBudgetUsd = price * USAGE_COST_PERCENTAGE;
    return Math.round(usageBudgetUsd * creditsPerUsd());
  }
  if (key === 'TEAM') return 50000;
  if (key === 'BUSINESS') return 200000;
  if (key === 'ENTERPRISE') return 1000000;
  return -1;
}

/**
 * Check if a model is considered a "mini" model based on its output cost
 */
export function isMiniModel(modelId: string): boolean {
  const price = priceForModel(modelId);
  return price.outPerMTokUSD <= MINI_MODEL_OUTPUT_COST_THRESHOLD;
}

/**
 * Get all mini models (models with output cost <= threshold)
 */
export function getMiniModels(): ModelInfo[] {
  return ALL_MODELS.filter(m => m.pricing.out <= MINI_MODEL_OUTPUT_COST_THRESHOLD);
}

/**
 * Get available models for a given plan
 */
export function getModelsForPlan(plan: string): ModelInfo[] {
  const key = planKey(plan);
  const planConfig = PLAN_CONFIG[key as PlanType];

  // If plan has access to all models, return all
  if (!planConfig || planConfig.allModels) {
    return ALL_MODELS;
  }

  // For FREE_TRIAL, only return mini models (cost-based restriction)
  return getMiniModels();
}

/**
 * Check if a model is available for a given plan
 */
export function isModelAvailableForPlan(modelId: string, plan: string): boolean {
  const key = planKey(plan);
  const planConfig = PLAN_CONFIG[key as PlanType];

  // If plan has access to all models, return true
  if (!planConfig || planConfig.allModels) {
    return true;
  }

  // For FREE_TRIAL, check if model is a mini model
  return isMiniModel(modelId);
}

/**
 * Get plan configuration
 */
export function getPlanConfig(plan: string) {
  const key = planKey(plan);
  return PLAN_CONFIG[key as PlanType] || null;
}
