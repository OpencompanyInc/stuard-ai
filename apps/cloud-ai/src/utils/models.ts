import { createRequire } from 'node:module';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { openai, createOpenAI } from '@ai-sdk/openai';
import { getUserApiKey } from '../byok/keys';
import { buildCodexModel } from '../byok/codex-client';
import type { Provider as ByokProvider } from '../byok/types';

const require = createRequire(import.meta.url);

function loadOptionalExport<T>(specifier: string, exportName: string): T | null {
  try {
    const mod = require(specifier) as Record<string, T>;
    return mod?.[exportName] || null;
  } catch {
    return null;
  }
}

// Single configured Google provider — reads GOOGLE_API_KEY (works for both Gemini and Cloud Vision)
export const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '',
});

/**
 * Builds an AI SDK model instance from a provider/model-id string.
 * Format: "provider/model-id" (e.g. "openai/gpt-4.1")
 */
export const buildProviderModel = (id: string): any | null => {
  try {
    const raw = String(id || '').trim();
    const idx = raw.indexOf('/');
    if (idx <= 0 || idx >= raw.length - 1) return null;
    const provider = raw.slice(0, idx).toLowerCase();
    const mid = raw.slice(idx + 1);
    if (!mid) return null;

    if (provider === 'xai') {
      const xai = loadOptionalExport<(modelId: string) => any>('@ai-sdk/xai', 'xai');
      return xai ? xai(mid) : null;
    }
    if (provider === 'google') return google(mid);
    if (provider === 'deepseek') {
      const deepseek = loadOptionalExport<(modelId: string) => any>('@ai-sdk/deepseek', 'deepseek');
      return deepseek ? deepseek(mid) : null;
    }
    if (provider === 'openai' || provider === 'penai') {
      const isReasoningModel = /^(o[1-9]|gpt-5(?:$|[-.]))/.test(mid);
      return isReasoningModel ? openai.responses(mid) : openai(mid);
    }
    if (provider === 'anthropic') {
      const anthropic = loadOptionalExport<(modelId: string) => any>('@ai-sdk/anthropic', 'anthropic');
      return anthropic ? anthropic(mid) : null;
    }
    if (provider === 'perplexity') {
      const apiKey = process.env.PERPLEXITY_API_KEY || '';
      if (!apiKey) return null;
      const { createOpenAI } = require('@ai-sdk/openai');
      const perplexity = createOpenAI({
        apiKey,
        baseURL: 'https://api.perplexity.ai/',
      });
      return perplexity(mid);
    }
    if (provider === 'openrouter') {
      const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) return null;
      const createOpenRouter = loadOptionalExport<(args: { apiKey: string; compatibility?: 'strict' | 'compatible' }) => (modelId: string) => any>(
        '@openrouter/ai-sdk-provider',
        'createOpenRouter',
      );
      if (!createOpenRouter) return null;
      const openrouter = createOpenRouter({
        apiKey,
        compatibility: 'strict',
      });
      return openrouter(mid);
    }
    return null;
  } catch {
    return null;
  }
};

// ─── BYOK-aware variant ─────────────────────────────────────────────────────

/**
 * Maps a `provider/...` model id prefix to the BYOK provider enum value.
 * Returns null when there's no BYOK-overridable provider for the prefix.
 */
function byokProviderFromPrefix(prefix: string): ByokProvider | null {
  switch (prefix) {
    case 'anthropic': return 'anthropic';
    case 'openai': return 'openai';
    case 'penai': return 'openai'; // existing typo-tolerant alias
    case 'google': return 'google';
    case 'xai': return 'xai';
    case 'openrouter': return 'openrouter';
    default: return null;
  }
}

function buildModelWithKey(provider: ByokProvider, modelId: string, apiKey: string, baseUrl?: string | null): any | null {
  try {
    switch (provider) {
      case 'anthropic': {
        const createAnthropic = loadOptionalExport<(args: { apiKey: string }) => (m: string) => any>(
          '@ai-sdk/anthropic', 'createAnthropic',
        );
        return createAnthropic ? createAnthropic({ apiKey })(modelId) : null;
      }
      case 'openai': {
        const client = createOpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
        const isReasoningModel = /^(o[1-9]|gpt-5(?:$|[-.]))/.test(modelId);
        return isReasoningModel ? client.responses(modelId) : client(modelId);
      }
      case 'google': {
        return createGoogleGenerativeAI({ apiKey })(modelId);
      }
      case 'xai': {
        const createXai = loadOptionalExport<(args: { apiKey: string }) => (m: string) => any>(
          '@ai-sdk/xai', 'createXai',
        );
        return createXai ? createXai({ apiKey })(modelId) : null;
      }
      case 'openrouter': {
        const createOpenRouter = loadOptionalExport<(args: { apiKey: string; compatibility?: 'strict' | 'compatible' }) => (m: string) => any>(
          '@openrouter/ai-sdk-provider', 'createOpenRouter',
        );
        return createOpenRouter ? createOpenRouter({ apiKey, compatibility: 'strict' })(modelId) : null;
      }
      case 'openai_compatible': {
        if (!baseUrl) return null;
        return createOpenAI({ apiKey, baseURL: baseUrl })(modelId);
      }
    }
  } catch {
    return null;
  }
  return null;
}

export interface ResolvedModel {
  model: any;
  source: 'byok' | 'friendly' | 'subscription';
  provider: string;
  /** True when the call should NOT consume Stuard credits (BYOK was used). */
  billingExcluded: boolean;
}

export type ModelSourcePreference = 'auto' | 'stuard' | 'api_key' | 'subscription';

function normalizeModelSourcePreference(value: unknown): ModelSourcePreference {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'stuard' || raw === 'friendly') return 'stuard';
  if (raw === 'api_key' || raw === 'api-key' || raw === 'byok') return 'api_key';
  if (raw === 'subscription' || raw === 'chatgpt' || raw === 'codex') return 'subscription';
  return 'auto';
}

/**
 * Per-user variant of buildProviderModel. Resolves a BYOK key first; if the
 * user has no enabled key for the requested provider (or the BYOK build
 * fails), falls back to the friendly env-var-keyed model.
 *
 * Use this from inference handlers; pass null for `userId` in dev/anon
 * paths and it will degrade to the friendly key.
 */
export async function buildProviderModelForUser(
  userId: string | null | undefined,
  id: string,
  sourcePreference: ModelSourcePreference | string | null | undefined = 'auto',
): Promise<ResolvedModel | null> {
  const raw = String(id || '').trim();
  const idx = raw.indexOf('/');
  if (idx <= 0 || idx >= raw.length - 1) return null;
  const providerPrefix = raw.slice(0, idx).toLowerCase();
  const modelId = raw.slice(idx + 1);
  if (!modelId) return null;
  const source = normalizeModelSourcePreference(sourcePreference);

  if (source === 'stuard') {
    const m = buildProviderModel(id);
    return m ? { model: m, source: 'friendly', provider: providerPrefix, billingExcluded: false } : null;
  }

  if (userId) {
    if ((source === 'subscription' && providerPrefix === 'openai') || providerPrefix === 'codex') {
      const m = await buildCodexModel(userId, modelId);
      if (m) return { model: m, source: 'subscription', provider: 'codex_subscription', billingExcluded: true };
      return null;
    }

    const byokKind = byokProviderFromPrefix(providerPrefix);
    if (byokKind && source !== 'subscription') {
      const resolved = await getUserApiKey(userId, byokKind);
      if (resolved?.apiKey) {
        const m = buildModelWithKey(byokKind, modelId, resolved.apiKey, resolved.baseUrl);
        if (m) return { model: m, source: 'byok', provider: byokKind, billingExcluded: true };
      }
      if (source === 'api_key') return null;
    }

    // openai_compatible BYOK is selected via "openai_compatible/<modelId>"
    if (providerPrefix === 'openai_compatible') {
      const resolved = await getUserApiKey(userId, 'openai_compatible');
      if (resolved?.apiKey && resolved.baseUrl) {
        const m = buildModelWithKey('openai_compatible', modelId, resolved.apiKey, resolved.baseUrl);
        if (m) return { model: m, source: 'byok', provider: 'openai_compatible', billingExcluded: true };
      }
      return null;
    }
  }

  if (source === 'api_key' || source === 'subscription') return null;

  // Fall back to the friendly env-var keyed builder.
  const m = buildProviderModel(id);
  if (!m) return null;
  return { model: m, source: 'friendly', provider: providerPrefix, billingExcluded: false };
}

/**
 * Builds an AI SDK embedding model instance from a provider/model-id string.
 * Format: "provider/model-id" (e.g. "openai/text-embedding-3-large")
 */
export const buildProviderEmbeddingModel = (id: string): any | null => {
  try {
    const raw = String(id || '').trim();
    const idx = raw.indexOf('/');
    if (idx <= 0 || idx >= raw.length - 1) return null;
    const provider = raw.slice(0, idx).toLowerCase();
    const mid = raw.slice(idx + 1);
    if (!mid) return null;

    if (provider === 'openai' || provider === 'penai') return openai.embedding(mid);
    if (provider === 'google') return google.textEmbeddingModel(mid);
    
    return null;
  } catch {
    return null;
  }
};




