import { useEffect, useMemo, useState } from "react";
import { getCloudAiHttp } from "../utils/cloud";
import { FALLBACK_MODELS, ALL_CHAT_MODEL_IDS, type ModelMeta } from "./usePreferences";

const ALLOWED_MODEL_SET = new Set(ALL_CHAT_MODEL_IDS);

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
    const map: Record<string, string> = {};
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

    // Only allow models defined in ALL_CHAT_MODEL_IDS
    raw = raw.filter(m => ALLOWED_MODEL_SET.has(m.id));

    if (raw.length === 0) return FALLBACK_MODELS;

    // Build set of registry model IDs
    const registryIds = new Set(raw.map(m => m.id));

    // Map registry models
    const registryModels: ModelMeta[] = raw.map((m) => ({
      id: m.id,
      name: fallbackById.get(m.id)?.name || m.name,
      provider: fallbackById.get(m.id)?.provider || m.providerName,
      providerId: m.providerId,
      logoUrl: logoByProviderId[m.providerId],
      isReasoning: typeof fallbackById.get(m.id)?.isReasoning === "boolean"
        ? !!fallbackById.get(m.id)?.isReasoning
        : !!m.reasoning,
      contextWindow: fallbackById.get(m.id)?.contextWindow ?? m.limit?.context,
      category: fallbackById.get(m.id)?.category || ((m.tier as any) || (m.reasoning ? "smart" : "balanced")),
    }));

    // Add fallback models that aren't in registry (e.g., Perplexity research models)
    const missingFallbacks = FALLBACK_MODELS.filter(m => !registryIds.has(m.id));

    return [...registryModels, ...missingFallbacks];
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


