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
 * Native `provider/` id prefix → OpenRouter vendor prefix. These are the
 * "has a native provider" models (Gemini, GPT, Grok, DeepSeek, Claude) that
 * Stuard serves through its OpenRouter account instead of the vendor's own key.
 * Only the prefix changes (xAI is `x-ai` on OpenRouter); the model-id portion is
 * preserved, so the same proven id string works on either transport.
 *
 * Perplexity is intentionally absent — it keeps its native key (PERPLEXITY_API_KEY,
 * also used by the web_search tool).
 */
const OPENROUTER_VENDOR_BY_PREFIX: Record<string, string> = {
  openai: 'openai',
  penai: 'openai', // typo-tolerant alias
  google: 'google',
  anthropic: 'anthropic',
  deepseek: 'deepseek',
  xai: 'x-ai',
};

/** Build an OpenRouter-backed model with a given key, or null if unavailable. */
function createOpenRouterModel(apiKey: string, modelId: string): any | null {
  const createOpenRouter = loadOptionalExport<(args: { apiKey: string; compatibility?: 'strict' | 'compatible' }) => (m: string) => any>(
    '@openrouter/ai-sdk-provider',
    'createOpenRouter',
  );
  if (!createOpenRouter) return null;
  return createOpenRouter({ apiKey, compatibility: 'strict' })(modelId);
}

/** Whether Stuard has a native (vendor) key configured for `provider`. */
function hasNativeKey(provider: string): boolean {
  switch (provider) {
    case 'google':
      return !!(process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY);
    case 'openai':
    case 'penai':
      return !!process.env.OPENAI_API_KEY;
    case 'xai':
      return !!process.env.XAI_API_KEY;
    case 'deepseek':
      return !!process.env.DEEPSEEK_API_KEY;
    case 'anthropic':
      return !!process.env.ANTHROPIC_API_KEY;
    case 'perplexity':
      return !!process.env.PERPLEXITY_API_KEY;
    default:
      return false;
  }
}

/** Build a model with the vendor's own native SDK/key (no OpenRouter). */
function buildNativeModel(provider: string, mid: string): any | null {
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
    const perplexity = createOpenAI({ apiKey, baseURL: 'https://api.perplexity.ai/' });
    return perplexity(mid);
  }
  return null;
}

/** Split "provider/model-id" → [provider, mid], or null when malformed. */
function splitModelId(id: string): [string, string] | null {
  const raw = String(id || '').trim();
  const idx = raw.indexOf('/');
  if (idx <= 0 || idx >= raw.length - 1) return null;
  const provider = raw.slice(0, idx).toLowerCase();
  const mid = raw.slice(idx + 1);
  if (!mid) return null;
  return [provider, mid];
}

/**
 * Builds an AI SDK model instance from a provider/model-id string.
 * Format: "provider/model-id" (e.g. "openai/gpt-4.1")
 *
 * This is the "Stuard-served" builder (Stuard pays, the call is user-billed).
 * For models with a native provider (Gemini/GPT/Grok/DeepSeek/Claude) it routes
 * through Stuard's OpenRouter account — NOT the vendor's own key — so Stuard
 * never spends a native Gemini/OpenAI/xAI key on serving. BYOK is resolved
 * upstream in buildProviderModelForUser, which builds with the user's own native
 * key before this builder is ever reached. The native SDK branches below are a
 * fallback for environments with no OpenRouter key (local dev / tests).
 *
 * For internal, non-billed housekeeping (routing, titles, memory, extraction)
 * use buildNativeProviderModel instead — it stays on the cheaper native key.
 */
export const buildProviderModel = (id: string): any | null => {
  try {
    const parsed = splitModelId(id);
    if (!parsed) return null;
    const [provider, mid] = parsed;

    const openRouterKey = process.env.OPENROUTER_API_KEY || '';

    // Explicit OpenRouter id ("openrouter/<vendor>/<model>").
    if (provider === 'openrouter') {
      return openRouterKey ? createOpenRouterModel(openRouterKey, mid) : null;
    }

    // Stuard-served native-provider model → OpenRouter transport (Stuard's key).
    const orVendor = OPENROUTER_VENDOR_BY_PREFIX[provider];
    if (orVendor && openRouterKey) {
      const m = createOpenRouterModel(openRouterKey, `${orVendor}/${mid}`);
      if (m) return m;
      // fall through to the native SDK if the OpenRouter build failed
    }

    return buildNativeModel(provider, mid);
  } catch {
    return null;
  }
};

/**
 * The ONLY model allowed on Stuard's native vendor key. It's the cheap,
 * high-volume housekeeping model, so serving it natively (no OpenRouter markup)
 * is worth keeping a native Google key for. Matches date-suffixed variants too.
 */
const NATIVE_ONLY_MODEL_PREFIX = 'gemini-3.1-flash-lite';

/**
 * Builds a model for INTERNAL, NON-BILLED work that Stuard pays for and never
 * bills to the user (model routing, conversation titles, memory
 * compaction/synthesis, knowledge extraction, auto-skills).
 *
 * Native is restricted to gemini-3.1-flash-lite ONLY — every other model
 * (including other Gemini models like gemini-2.5-flash) uses the OpenRouter
 * served transport, same as buildProviderModel. So the only native vendor key
 * Stuard ever spends here is GOOGLE_API_KEY, and only on flash-lite.
 */
export const buildNativeProviderModel = (id: string): any | null => {
  try {
    const parsed = splitModelId(id);
    if (!parsed) return null;
    const [provider, mid] = parsed;

    const nativeEligible = provider === 'google' && mid.startsWith(NATIVE_ONLY_MODEL_PREFIX);
    if (nativeEligible && hasNativeKey('google')) {
      const m = buildNativeModel('google', mid);
      if (m) return m;
    }

    // Anything else (or no Google key / build failed) → served transport.
    return buildProviderModel(id);
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




