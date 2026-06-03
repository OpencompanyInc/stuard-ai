import { useEffect, useMemo, useState } from "react";
import { getCloudAiHttp } from "../utils/cloud";
import { FALLBACK_MODELS, ALL_CHAT_MODEL_IDS, type ModelMeta } from "./usePreferences";

const ALLOWED_MODEL_SET = new Set(ALL_CHAT_MODEL_IDS);

/** Returns true if a model ID should pass through the allowlist filter. */
function isModelAllowed(id: string): boolean {
  if (ALLOWED_MODEL_SET.has(id)) return true;
  // OpenRouter is the Stuard-served catalog. Its models ARE shown, but de-branded
  // as the underlying vendor (see debrandOpenRouterModel) — the "OpenRouter" name
  // never surfaces. The native curated ids above are the separate BYOK surface.
  if (id.startsWith('openrouter/')) return true;
  return false;
}

const OVERRIDE_PROVIDER_LOGOS: Record<string, string> = {
  anthropic: 'https://models.dev/logos/anthropic.svg',
};

/**
 * Logo source for de-branded OpenRouter vendors.
 *
 * models.dev is unreliable here: it silently serves a generic placeholder SVG
 * (HTTP 200) for vendors it doesn't have, so most of OpenRouter's long tail
 * (qwen, z-ai, meta-llama, bytedance, ibm, …) would show a blank glyph with no
 * way to detect the miss. LobeHub's @lobehub/icons set is purpose-built for AI
 * model/provider logos, covers the long tail, returns honest 404s (so the
 * <img> onError fallback works), and ships monochrome `currentColor` SVGs that
 * match our invert-to-white-in-dark pipeline. Served from jsDelivr (no proxy,
 * no CORS needed for <img>).
 */
const LOBE_LOGO_BASE = 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg/icons';

/** OpenRouter vendor slug → LobeHub icon slug (only where they differ). */
const VENDOR_LOGO_SLUG: Record<string, string> = {
  'x-ai': 'grok',
  'meta-llama': 'meta',
  'mistralai': 'mistral',
  'z-ai': 'zhipu',
  'moonshotai': 'moonshot',
  'bytedance-seed': 'bytedance',
  'amazon': 'bedrock',
  'ibm-granite': 'ibm',
  'arcee-ai': 'arcee',
  'nousresearch': 'nous',
};

function vendorLogoUrl(vendor: string): string {
  const slug = VENDOR_LOGO_SLUG[vendor.toLowerCase()] || vendor.toLowerCase();
  return `${LOBE_LOGO_BASE}/${encodeURIComponent(slug)}.svg`;
}

/**
 * Model-family logos that differ from the vendor mark (e.g. Gemini/Gemma have
 * their own logos, not Google's "G"). Matched against the full model id and
 * applied to EVERY model (native + OpenRouter) so a keyed user's native
 * `google/gemini-*` entry also gets the Gemini logo. Easy to extend.
 */
const MODEL_FAMILY_LOGO: Array<[RegExp, string]> = [
  [/gemini/i, 'gemini'],
  [/gemma/i, 'gemma'],
];

function familyLogoUrl(id: string): string | null {
  for (const [re, slug] of MODEL_FAMILY_LOGO) {
    if (re.test(id)) return `${LOBE_LOGO_BASE}/${slug}.svg`;
  }
  return null;
}

function humanizeVendor(vendor: string): string {
  const v = String(vendor || '').toLowerCase();
  const SPECIAL: Record<string, string> = {
    openai: 'OpenAI', google: 'Google', 'x-ai': 'xAI', xai: 'xAI',
    deepseek: 'DeepSeek', anthropic: 'Anthropic', perplexity: 'Perplexity',
    'meta-llama': 'Meta', mistralai: 'Mistral', qwen: 'Qwen', cohere: 'Cohere',
    'z-ai': 'Z.AI', moonshotai: 'Moonshot', nousresearch: 'Nous', microsoft: 'Microsoft',
  };
  if (SPECIAL[v]) return SPECIAL[v];
  // Title-case the slug as a reasonable default ("ai21" → "Ai21").
  return v.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Re-presents an `openrouter/<vendor>/<model>` registry entry as if it were a
 * first-class vendor model: vendor name + models.dev logo, with the
 * `openrouter/...` id preserved so the backend still routes via the transport.
 */
/** Map an OpenRouter vendor slug to the native provider id it corresponds to,
 *  so gating (BYOK/native suppression) lines up (e.g. `x-ai` → `xai`). */
function identityVendor(vendor: string): string {
  const v = String(vendor || '').toLowerCase();
  return v === 'x-ai' ? 'xai' : v;
}

function debrandOpenRouterModel(
  m: { id: string; providerId: string; name: string },
): { providerId: string; provider: string; logoUrl: string } {
  const vendor = String(m.id).split('/')[1] || m.providerId;
  return {
    providerId: identityVendor(vendor),
    provider: humanizeVendor(vendor),
    logoUrl: vendorLogoUrl(vendor),
  };
}

export type CloudModelRegistry = {
  ok: boolean;
  source?: string;
  fetchedAt?: string;
  providers?: Array<{ id: string; name: string; logoUrl: string }>;
  models?: Array<{
    id: string; // provider/modelId
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
    tier?: "fast" | "balanced" | "smart";
  }>;
  tiers?: {
    fast: string[];
    balanced: string[];
    smart: string[];
    research: string[];
  };
};

const LS_KEY = "stuard.model_registry.v1";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function readCache(): { fetchedAtMs: number; data: CloudModelRegistry } | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.fetchedAtMs !== "number") return null;
    if (!parsed.data || typeof parsed.data !== "object") return null;
    return parsed as any;
  } catch {
    return null;
  }
}

function writeCache(data: CloudModelRegistry) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ fetchedAtMs: Date.now(), data }));
  } catch {}
}

export function useModelRegistry() {
  const [registry, setRegistry] = useState<CloudModelRegistry | null>(() => readCache()?.data ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = readCache();
    const isFresh = cached && Date.now() - cached.fetchedAtMs < CACHE_TTL_MS;
    if (isFresh) return;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const base = getCloudAiHttp();
        const resp = await fetch(`${base}/v1/models`, { cache: "no-store" });
        const json = (await resp.json()) as CloudModelRegistry;
        if (!resp.ok || !json?.ok) throw new Error((json as any)?.error || `http_${resp.status}`);
        if (cancelled) return;
        setRegistry(json);
        writeCache(json);
      } catch (e: any) {
        if (cancelled) return;
        setError(String(e?.message || "failed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const logoByProviderId = useMemo(() => {
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

    // Only allow models defined in ALL_CHAT_MODEL_IDS or from dynamic providers (openrouter)
    raw = raw.filter(m => isModelAllowed(m.id));

    if (raw.length === 0) return FALLBACK_MODELS;

    // Build set of registry model IDs
    const registryIds = new Set(raw.map(m => m.id));

    // Map registry models
    const registryModels: ModelMeta[] = raw.map((m) => {
      // OpenRouter entries are de-branded to their underlying vendor (vendor
      // name + LobeHub logo); native entries keep their providerName/logo.
      const debrand = m.providerId === 'openrouter'
        ? debrandOpenRouterModel(m)
        : null;
      return {
        id: m.id,
        name: fallbackById.get(m.id)?.name || m.name,
        provider: debrand?.provider || fallbackById.get(m.id)?.provider || m.providerName,
        providerId: debrand?.providerId || m.providerId,
        logoUrl: debrand ? debrand.logoUrl : logoByProviderId[m.providerId],
        isReasoning: typeof fallbackById.get(m.id)?.isReasoning === "boolean"
          ? !!fallbackById.get(m.id)?.isReasoning
          : !!m.reasoning,
        // Prefer the registry's real context window (models.dev / OpenRouter both
        // expose it) over our hardcoded table, which is partial and goes stale.
        contextWindow: m.limit?.context ?? fallbackById.get(m.id)?.contextWindow,
        category: fallbackById.get(m.id)?.category || ((m.tier as any) || (m.reasoning ? "smart" : "balanced")),
      };
    });

    // Add fallback models that aren't in registry (e.g., Perplexity/Anthropic aliases)
    // while still attaching provider logos when available.
    const missingFallbacks = FALLBACK_MODELS
      .filter(m => !registryIds.has(m.id))
      .map((m) => {
        const providerId = m.providerId || String(m.id).split('/')[0];
        const providerLogo = providerId ? logoByProviderId[providerId] : undefined;
        if (!providerLogo || m.logoUrl) return m;
        return { ...m, logoUrl: providerLogo };
      });

    // Model-family logo override (Gemini/Gemma ≠ Google), applied uniformly to
    // native + OpenRouter entries.
    return [...registryModels, ...missingFallbacks].map((mm) => {
      const fam = familyLogoUrl(mm.id);
      return fam ? { ...mm, logoUrl: fam } : mm;
    });
  }, [registry, logoByProviderId, fallbackById]);

  const modelById = useMemo(() => {
    const map = new Map<string, ModelMeta>();
    models.forEach((m) => map.set(m.id, m));
    return map;
  }, [models]);

  return {
    loading,
    error,
    registry,
    models,
    modelById,
    logoByProviderId,
  };
}


