'use client';

import { useEffect, useMemo, useState } from 'react';
import { resolveBrowserCloudApiOrigin } from '@/lib/cloudApiBase';

export interface ModelMeta {
  id: string;
  name: string;
  provider: string;
  providerId?: string;
  logoUrl?: string;
  isReasoning: boolean;
  contextWindow?: number;
  category: 'fast' | 'balanced' | 'smart' | 'research';
}

const ALL_CHAT_MODEL_IDS: string[] = [
  'xai/grok-4', 'xai/grok-4-1-fast', 'xai/grok-4-1-fast-non-reasoning',
  'xai/grok-4-fast', 'xai/grok-4-fast-non-reasoning',
  'xai/grok-3', 'xai/grok-3-fast', 'xai/grok-3-fast-latest', 'xai/grok-3-latest',
  'xai/grok-3-mini', 'xai/grok-3-mini-fast',
  'google/gemini-3-flash-preview', 'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite', 'google/gemini-2.5-pro',
  'google/gemini-3.1-pro-preview', 'google/gemini-3-pro-preview',
  'openai/gpt-4.1', 'openai/gpt-4.1-mini', 'openai/gpt-4.1-nano',
  'openai/gpt-4o', 'openai/gpt-4o-mini',
  'openai/gpt-5', 'openai/gpt-5-chat-latest', 'openai/gpt-5-codex',
  'openai/gpt-5-mini', 'openai/gpt-5-nano', 'openai/gpt-5-pro',
  'openai/gpt-5.1', 'openai/gpt-5.1-chat-latest', 'openai/gpt-5.1-codex',
  'openai/gpt-5.1-codex-mini', 'openai/gpt-5.2-codex', 'openai/gpt-5.3-codex',
  'deepseek/deepseek-chat', 'deepseek/deepseek-reasoner',
  'anthropic/claude-3-5-haiku-latest', 'anthropic/claude-haiku-4-5',
  'anthropic/claude-3-7-sonnet-latest', 'anthropic/claude-sonnet-4-5', 'anthropic/claude-opus-4-5',
  'perplexity/sonar', 'perplexity/sonar-pro', 'perplexity/sonar-reasoning',
  'perplexity/sonar-reasoning-pro', 'perplexity/sonar-deep-research',
  'openai/o3-deep-research', 'openai/o4-mini-deep-research',
];

const ALLOWED_MODEL_SET = new Set(ALL_CHAT_MODEL_IDS);

function isModelAllowed(id: string): boolean {
  if (ALLOWED_MODEL_SET.has(id)) return true;
  if (id.startsWith('openrouter/')) return true;
  return false;
}

const REASONING_IDS = new Set([
  'deepseek/deepseek-reasoner',
  'openai/gpt-5-pro', 'openai/gpt-5.1', 'openai/gpt-5.1-chat-latest',
  'google/gemini-3.1-pro-preview', 'google/gemini-3-pro-preview',
  'google/gemini-2.5-pro', 'google/gemini-2.5-flash',
  'xai/grok-4', 'xai/grok-4-1-fast', 'xai/grok-4-fast',
  'xai/grok-3', 'xai/grok-3-fast', 'xai/grok-3-fast-latest', 'xai/grok-3-latest',
  'xai/grok-3-mini', 'xai/grok-3-mini-fast',
  'anthropic/claude-3-7-sonnet-latest', 'anthropic/claude-sonnet-4-5', 'anthropic/claude-opus-4-5',
]);

const CONTEXT_WINDOWS: Record<string, number> = {
  'google/gemini-3.1-pro-preview': 2_000_000,
  'google/gemini-3-pro-preview': 2_000_000,
  'google/gemini-3-flash-preview': 1_000_000,
  'google/gemini-2.5-pro': 2_000_000,
  'google/gemini-2.5-flash': 1_000_000,
  'openai/gpt-5': 128_000, 'openai/gpt-5-pro': 128_000, 'openai/gpt-5.1': 128_000,
  'openai/gpt-4.1': 128_000, 'openai/gpt-4.1-mini': 128_000,
  'openai/gpt-4o': 128_000, 'openai/gpt-4o-mini': 128_000,
  'openai/gpt-5.2-codex': 700_000, 'openai/gpt-5.3-codex': 1_000_000,
  'xai/grok-4': 256_000, 'xai/grok-4-fast': 2_000_000, 'xai/grok-3': 128_000,
  'deepseek/deepseek-chat': 128_000, 'deepseek/deepseek-reasoner': 128_000,
  'anthropic/claude-3-5-haiku-latest': 200_000, 'anthropic/claude-haiku-4-5': 200_000,
  'anthropic/claude-3-7-sonnet-latest': 200_000, 'anthropic/claude-sonnet-4-5': 200_000,
  'anthropic/claude-opus-4-5': 200_000,
  'perplexity/sonar': 128_000, 'perplexity/sonar-pro': 200_000,
  'perplexity/sonar-reasoning': 128_000, 'perplexity/sonar-reasoning-pro': 128_000,
  'perplexity/sonar-deep-research': 128_000,
  'openai/o3-deep-research': 128_000, 'openai/o4-mini-deep-research': 128_000,
};

const CATEGORIES: Record<string, ModelMeta['category']> = {
  'xai/grok-4': 'smart', 'xai/grok-4-1-fast': 'balanced', 'xai/grok-4-1-fast-non-reasoning': 'balanced',
  'xai/grok-4-fast': 'balanced', 'xai/grok-4-fast-non-reasoning': 'balanced',
  'xai/grok-3': 'smart', 'xai/grok-3-fast': 'smart', 'xai/grok-3-fast-latest': 'smart',
  'xai/grok-3-latest': 'smart', 'xai/grok-3-mini': 'fast', 'xai/grok-3-mini-fast': 'fast',
  'google/gemini-3-flash-preview': 'fast', 'google/gemini-2.5-flash': 'fast',
  'google/gemini-2.5-flash-lite': 'fast', 'google/gemini-2.5-pro': 'smart',
  'google/gemini-3.1-pro-preview': 'smart', 'google/gemini-3-pro-preview': 'smart',
  'openai/gpt-4.1': 'smart', 'openai/gpt-4.1-mini': 'balanced', 'openai/gpt-4.1-nano': 'fast',
  'openai/gpt-4o': 'balanced', 'openai/gpt-4o-mini': 'fast',
  'openai/gpt-5': 'smart', 'openai/gpt-5-chat-latest': 'smart', 'openai/gpt-5-codex': 'smart',
  'openai/gpt-5-mini': 'balanced', 'openai/gpt-5-nano': 'fast', 'openai/gpt-5-pro': 'smart',
  'openai/gpt-5.1': 'smart', 'openai/gpt-5.1-chat-latest': 'smart', 'openai/gpt-5.1-codex': 'smart',
  'openai/gpt-5.1-codex-mini': 'balanced', 'openai/gpt-5.2-codex': 'smart', 'openai/gpt-5.3-codex': 'smart',
  'deepseek/deepseek-chat': 'fast', 'deepseek/deepseek-reasoner': 'smart',
  'anthropic/claude-3-5-haiku-latest': 'fast', 'anthropic/claude-haiku-4-5': 'fast',
  'anthropic/claude-3-7-sonnet-latest': 'balanced', 'anthropic/claude-sonnet-4-5': 'smart',
  'anthropic/claude-opus-4-5': 'smart',
  'perplexity/sonar': 'research', 'perplexity/sonar-pro': 'research',
  'perplexity/sonar-reasoning': 'research', 'perplexity/sonar-reasoning-pro': 'research',
  'perplexity/sonar-deep-research': 'research',
  'openai/o3-deep-research': 'research', 'openai/o4-mini-deep-research': 'research',
};

function humanizeProvider(p: string): string {
  const s = String(p || '').toLowerCase();
  if (s === 'xai') return 'xAI';
  if (s === 'openai') return 'OpenAI';
  if (s === 'google') return 'Google';
  if (s === 'deepseek') return 'DeepSeek';
  if (s === 'anthropic') return 'Anthropic';
  if (s === 'perplexity') return 'Perplexity';
  if (s === 'openrouter') return 'OpenRouter';
  return p;
}

function titleizeModelName(mid: string): string {
  try {
    const base = String(mid || '').replace(/-/g, ' ');
    if (mid === 'deepseek-chat') return 'DeepSeek V3';
    if (mid === 'deepseek-reasoner') return 'DeepSeek R1';
    if (mid.startsWith('gpt ')) return base.toUpperCase();
    return base.replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return String(mid || '');
  }
}

export const FALLBACK_MODELS: ModelMeta[] = ALL_CHAT_MODEL_IDS.map((id) => {
  const parts = id.split('/');
  const providerKey = parts[0] || 'other';
  const modelKey = parts.slice(1).join('/') || id;
  const isNonReasoning = modelKey.includes('non-reasoning');
  return {
    id,
    providerId: providerKey,
    provider: humanizeProvider(providerKey),
    name: titleizeModelName(modelKey),
    isReasoning: !isNonReasoning && REASONING_IDS.has(id),
    contextWindow: CONTEXT_WINDOWS[id],
    category: CATEGORIES[id] || 'balanced',
  };
});

const OVERRIDE_PROVIDER_LOGOS: Record<string, string> = {
  anthropic: 'https://models.dev/logos/anthropic.svg',
};

type CloudModelRegistry = {
  ok: boolean;
  source?: string;
  fetchedAt?: string;
  providers?: Array<{ id: string; name: string; logoUrl: string }>;
  models?: Array<{
    id: string;
    providerId: string;
    providerName: string;
    modelId: string;
    name: string;
    reasoning: boolean;
    toolCall: boolean;
    structuredOutput: boolean;
    attachment: boolean;
    modalities: { input: string[]; output: string[] };
    cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
    limit?: { context?: number; output?: number };
    tier?: 'fast' | 'balanced' | 'smart';
  }>;
};

const LS_KEY = 'stuard.model_registry.v2';
const CACHE_TTL_MS = 10 * 60 * 1000;

function readCache(): { fetchedAtMs: number; data: CloudModelRegistry } | null {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.fetchedAtMs !== 'number') return null;
    return parsed;
  } catch { return null; }
}

function writeCache(data: CloudModelRegistry) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ fetchedAtMs: Date.now(), data })); } catch {}
}

export function useModelRegistry() {
  const [registry, setRegistry] = useState<CloudModelRegistry | null>(() => readCache()?.data ?? null);

  useEffect(() => {
    const cached = readCache();
    if (cached && Date.now() - cached.fetchedAtMs < CACHE_TTL_MS) return;

    let cancelled = false;
    (async () => {
      try {
        // Hit cloud-ai directly — registry is public (no auth) and matches the
        // desktop client. Going through the website proxy would require a
        // Bearer token and silently fail for anonymous visitors.
        const base = resolveBrowserCloudApiOrigin();
        const resp = await fetch(`${base}/v1/models`, { cache: 'no-store' });
        if (!resp.ok) return;
        const json = await resp.json() as CloudModelRegistry;
        if (cancelled || !json?.ok) return;
        setRegistry(json);
        writeCache(json);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  const logoByProvider = useMemo(() => {
    const map: Record<string, string> = { ...OVERRIDE_PROVIDER_LOGOS };
    (registry?.providers || []).forEach((p) => {
      if (p?.id && p?.logoUrl) map[String(p.id)] = String(p.logoUrl);
    });
    return map;
  }, [registry]);

  const fallbackById = useMemo(() => {
    const map = new Map<string, ModelMeta>();
    FALLBACK_MODELS.forEach((m) => map.set(m.id, m));
    return map;
  }, []);

  const models: ModelMeta[] = useMemo(() => {
    let raw = registry?.models;
    if (!Array.isArray(raw) || raw.length === 0) return FALLBACK_MODELS;

    raw = raw.filter((m: any) => isModelAllowed(m.id));
    if (raw.length === 0) return FALLBACK_MODELS;

    const registryIds = new Set(raw.map((m: any) => m.id));
    const registryModels: ModelMeta[] = raw.map((m: any) => ({
      id: m.id,
      name: fallbackById.get(m.id)?.name || m.name,
      provider: fallbackById.get(m.id)?.provider || m.providerName,
      providerId: m.providerId,
      logoUrl: logoByProvider[m.providerId],
      isReasoning: typeof fallbackById.get(m.id)?.isReasoning === 'boolean'
        ? !!fallbackById.get(m.id)?.isReasoning
        : !!m.reasoning,
      contextWindow: fallbackById.get(m.id)?.contextWindow ?? m.limit?.context,
      category: fallbackById.get(m.id)?.category || ((m.tier as any) || (m.reasoning ? 'smart' : 'balanced')),
    }));

    const extras = FALLBACK_MODELS
      .filter((m) => !registryIds.has(m.id))
      .map((m) => {
        const providerLogo = m.providerId ? logoByProvider[m.providerId] : undefined;
        if (!providerLogo || m.logoUrl) return m;
        return { ...m, logoUrl: providerLogo };
      });

    return [...registryModels, ...extras];
  }, [registry, logoByProvider, fallbackById]);

  const modelById = useMemo(() => {
    const map = new Map<string, ModelMeta>();
    models.forEach((m) => map.set(m.id, m));
    return map;
  }, [models]);

  return { models, modelById, logoByProvider };
}
