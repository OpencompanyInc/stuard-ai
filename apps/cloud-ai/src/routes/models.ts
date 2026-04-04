import type { IncomingMessage, ServerResponse } from 'http';
import { registerDynamicPricing } from '../pricing';

type ModelsDevProviderEntry = {
  id?: string;
  name?: string;
  doc?: string;
  env?: unknown;
  npm?: unknown;
  models?: Record<string, any>;
};

type NormalizedModel = {
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
  tier?: 'fast' | 'balanced' | 'smart';
};

type RegistryResponse = {
  ok: true;
  source: 'models.dev';
  fetchedAt: string;
  providers: Array<{ id: string; name: string; logoUrl: string }>;
  models: NormalizedModel[];
  tiers: {
    fast: string[];
    balanced: string[];
    smart: string[];
  };
};

function writeJson(res: ServerResponse, status: number, obj: any, headers?: Record<string, string>) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    ...headers,
  });
  res.end(body);
}

function writeText(res: ServerResponse, status: number, text: string, headers?: Record<string, string>) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Access-Control-Allow-Origin': '*',
    ...headers,
  });
  res.end(text);
}

const SUPPORTED_PROVIDERS = new Set(['openai', 'google', 'xai', 'deepseek', 'anthropic']);
const MODELS_DEV_API = 'https://models.dev/api.json';
const MODELS_DEV_LOGO_BASE = 'https://models.dev/logos/';
const OPENROUTER_MODELS_API = 'https://openrouter.ai/api/v1/models?supported_parameters=tools';

let _cache: {
  fetchedAtMs: number;
  etag?: string;
  registry?: RegistryResponse;
} = { fetchedAtMs: 0 };

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isChatCapable(m: any): boolean {
  const input = m?.modalities?.input;
  const output = m?.modalities?.output;
  const inputArr = Array.isArray(input) ? input : [];
  const outputArr = Array.isArray(output) ? output : [];
  return inputArr.includes('text') && outputArr.includes('text');
}

// ── OpenRouter dynamic model fetching ──────────────────────────────────────

interface OpenRouterApiModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  top_provider?: { context_length: number; max_completion_tokens: number; is_moderated: boolean };
  architecture?: { input_modalities: string[]; output_modalities: string[] };
  supported_parameters?: string[];
  expiration_date?: string | null;
}

function normalizeOpenRouterModel(raw: OpenRouterApiModel): NormalizedModel | null {
  if (!raw?.id || raw.expiration_date) return null; // skip deprecated
  const inputMods = Array.isArray(raw.architecture?.input_modalities) ? raw.architecture!.input_modalities : ['text'];
  const outputMods = Array.isArray(raw.architecture?.output_modalities) ? raw.architecture!.output_modalities : ['text'];
  if (!outputMods.includes('text')) return null; // only chat models
  const params = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
  const promptPrice = parseFloat(raw.pricing?.prompt || '0') * 1_000_000; // per-token → per-MTok
  const completionPrice = parseFloat(raw.pricing?.completion || '0') * 1_000_000;
  const reasoning = params.includes('reasoning') || params.includes('include_reasoning');
  const toolCall = params.includes('tools');
  const structuredOutput = params.includes('structured_outputs') || params.includes('response_format');

  return {
    id: `openrouter/${raw.id}`,
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    modelId: raw.id,
    name: raw.name.replace(/^[^:]+:\s*/, ''), // strip "Provider: " prefix
    reasoning,
    toolCall,
    structuredOutput,
    attachment: inputMods.includes('image') || inputMods.includes('file'),
    modalities: { input: inputMods, output: outputMods },
    cost: { input: promptPrice, output: completionPrice },
    limit: {
      context: raw.top_provider?.context_length || raw.context_length || undefined,
      output: raw.top_provider?.max_completion_tokens || undefined,
    },
  };
}

async function fetchOpenRouterModels(): Promise<NormalizedModel[]> {
  try {
    const resp = await fetch(OPENROUTER_MODELS_API);
    if (!resp.ok) return [];
    const json = await resp.json() as { data: OpenRouterApiModel[] };
    if (!Array.isArray(json?.data)) return [];

    // First pass: collect all paid model base IDs
    const paidIds = new Set<string>();
    for (const raw of json.data) {
      if (!raw.id.endsWith(':free')) paidIds.add(raw.id);
    }

    const models: NormalizedModel[] = [];
    for (const raw of json.data) {
      // Skip :free variant only if a paid version of the same model exists
      if (raw.id.endsWith(':free')) {
        const baseId = raw.id.replace(/:free$/, '');
        if (paidIds.has(baseId)) continue;
      }
      const m = normalizeOpenRouterModel(raw);
      if (m) models.push(m);
    }
    return models;
  } catch {
    return [];
  }
}

function getCachedBaseRegistry(): Pick<RegistryResponse, 'providers' | 'models'> {
  return {
    providers: (_cache.registry?.providers || []).filter((p) => p.id !== 'openrouter'),
    models: (_cache.registry?.models || []).filter((m) => m.providerId !== 'openrouter'),
  };
}

function getCachedOpenRouterModels(): NormalizedModel[] {
  return (_cache.registry?.models || []).filter((m) => m.providerId === 'openrouter');
}

function buildModelsDevRegistry(json: Record<string, ModelsDevProviderEntry>): Pick<RegistryResponse, 'providers' | 'models'> {
  const providers: RegistryResponse['providers'] = [];
  const models: NormalizedModel[] = [];

  for (const providerId of Object.keys(json || {})) {
    if (!SUPPORTED_PROVIDERS.has(providerId)) continue;
    const entry = json[providerId];
    const providerName = normalizeProviderName(providerId, entry);
    providers.push({
      id: providerId,
      name: providerName,
      // proxy through our server so desktop doesn't depend on models.dev directly
      logoUrl: `/v1/models/logos/${encodeURIComponent(providerId)}.svg`,
    });

    const rawModels = entry?.models && typeof entry.models === 'object' ? entry.models : {};
    for (const rawModelId of Object.keys(rawModels)) {
      const m = normalizeModel(providerId, providerName, rawModelId, (rawModels as any)[rawModelId]);
      // filter out embeddings / non-chat models
      if (!isChatCapable(m)) continue;
      models.push(m);
    }
  }

  return { providers, models };
}

function addOpenRouterRegistry(models: NormalizedModel[], providers: RegistryResponse['providers']) {
  if (models.length === 0) return;
  providers.push({
    id: 'openrouter',
    name: 'OpenRouter',
    logoUrl: `/v1/models/logos/openrouter.svg`,
  });
  for (const m of models) {
    if (m.cost?.input != null && m.cost?.output != null) {
      registerDynamicPricing(m.id, m.cost.input, m.cost.output);
    }
  }
}

function normalizeProviderName(id: string, entry: ModelsDevProviderEntry): string {
  const n = String(entry?.name || '').trim();
  if (n) return n;
  // a few nicer fallbacks
  if (id === 'xai') return 'xAI';
  if (id === 'openai') return 'OpenAI';
  if (id === 'deepseek') return 'DeepSeek';
  if (id === 'google') return 'Google';
  return id;
}

function normalizeModel(providerId: string, providerName: string, rawModelId: string, raw: any): NormalizedModel {
  const modelId = String(raw?.id || rawModelId || '').trim() || String(rawModelId);
  const fullId = `${providerId}/${modelId}`;
  const name = String(raw?.name || modelId).trim();
  const reasoning = !!raw?.reasoning;
  const toolCall = !!raw?.tool_call;
  const structuredOutput = !!raw?.structured_output;
  const attachment = !!raw?.attachment;
  const modalities = {
    input: Array.isArray(raw?.modalities?.input) ? raw.modalities.input.map(String) : [],
    output: Array.isArray(raw?.modalities?.output) ? raw.modalities.output.map(String) : [],
  };
  const cost = raw?.cost && typeof raw.cost === 'object'
    ? {
        input: typeof raw.cost.input === 'number' ? raw.cost.input : undefined,
        output: typeof raw.cost.output === 'number' ? raw.cost.output : undefined,
        cache_read: typeof raw.cost.cache_read === 'number' ? raw.cost.cache_read : undefined,
        cache_write: typeof raw.cost.cache_write === 'number' ? raw.cost.cache_write : undefined,
      }
    : undefined;
  const limit = raw?.limit && typeof raw.limit === 'object'
    ? {
        context: typeof raw.limit.context === 'number' ? raw.limit.context : undefined,
        output: typeof raw.limit.output === 'number' ? raw.limit.output : undefined,
      }
    : undefined;

  return {
    id: fullId,
    providerId,
    providerName,
    modelId,
    name,
    reasoning,
    toolCall,
    structuredOutput,
    attachment,
    modalities,
    cost,
    limit,
  };
}

function pickTiers(models: NormalizedModel[]): RegistryResponse['tiers'] {
  // Heuristic tiering:
  // - smart: reasoning models first
  // - fast: cheapest non-reasoning models
  // - balanced: next cheapest non-reasoning models
  const chat = models.filter((m) => isChatCapable(m));

  const smart = chat
    .filter((m) => m.reasoning)
    .sort((a, b) => (a.cost?.input ?? 999) - (b.cost?.input ?? 999));

  const nonReasoning = chat
    .filter((m) => !m.reasoning)
    .sort((a, b) => (a.cost?.input ?? 999) - (b.cost?.input ?? 999));

  const fast = nonReasoning.slice(0, 3);
  const balanced = nonReasoning.slice(3, 6);
  const smartFallback = smart.length > 0 ? smart.slice(0, 3) : nonReasoning.slice(6, 9);

  return {
    fast: fast.map((m) => m.id),
    balanced: balanced.map((m) => m.id),
    smart: smartFallback.map((m) => m.id),
  };
}

async function fetchRegistry(): Promise<RegistryResponse> {
  const now = Date.now();
  if (_cache.registry && now - _cache.fetchedAtMs < CACHE_TTL_MS) return _cache.registry;

  let etag = _cache.etag;
  let providers: RegistryResponse['providers'] = [];
  let models: NormalizedModel[] = [];

  try {
    const headers: Record<string, string> = {};
    if (_cache.etag) headers['If-None-Match'] = _cache.etag;

    const resp = await fetch(MODELS_DEV_API, { headers });
    if (resp.status === 304 && _cache.registry) {
      ({ providers, models } = getCachedBaseRegistry());
    } else {
      if (!resp.ok) throw new Error(`models_dev_fetch_failed_${resp.status}`);
      etag = resp.headers.get('etag') || undefined;
      const json = (await resp.json()) as Record<string, ModelsDevProviderEntry>;
      ({ providers, models } = buildModelsDevRegistry(json));
    }
  } catch {
    ({ providers, models } = getCachedBaseRegistry());
  }

  // ── Fetch OpenRouter models dynamically ──────────────────────────────
  const freshOpenRouterModels = await fetchOpenRouterModels();
  const orModels = freshOpenRouterModels.length > 0 ? freshOpenRouterModels : getCachedOpenRouterModels();
  if (orModels.length > 0) {
    addOpenRouterRegistry(orModels, providers);
    models.push(...orModels);
  }

  if (models.length === 0) {
    if (_cache.registry) {
      _cache.fetchedAtMs = now;
      return _cache.registry;
    }
    throw new Error('models_registry_unavailable');
  }

  const tiers = pickTiers(models);
  // attach tier field so clients can render consistently
  const tierSet = new Map<string, NormalizedModel['tier']>();
  tiers.fast.forEach((id) => tierSet.set(id, 'fast'));
  tiers.balanced.forEach((id) => tierSet.set(id, 'balanced'));
  tiers.smart.forEach((id) => tierSet.set(id, 'smart'));
  models.forEach((m) => {
    (m as any).tier = tierSet.get(m.id);
  });

  const registry: RegistryResponse = {
    ok: true,
    source: 'models.dev',
    fetchedAt: new Date().toISOString(),
    providers,
    models,
    tiers,
  };

  _cache = { fetchedAtMs: now, etag, registry };
  return registry;
}

/**
 * Check if a model supports multimodal (image/audio/video) input.
 * Uses the cached registry; returns true by default if unknown (safe fallback: attempt multimodal).
 */
export async function modelSupportsMultimodal(modelId: string): Promise<boolean> {
  try {
    const registry = await fetchRegistry();
    const model = registry.models.find(m => m.id === modelId);
    if (!model) return true; // unknown model — assume multimodal to avoid losing data
    const inputMods = Array.isArray(model.modalities?.input) ? model.modalities.input : [];
    return inputMods.includes('image') || inputMods.includes('audio') || inputMods.includes('video');
  } catch {
    return true; // on error assume multimodal
  }
}

async function handleModelsRegistry(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = String(parsedUrl.pathname || '');
  if (req.method === 'GET' && path === '/v1/models') {
    try {
      const registry = await fetchRegistry();
      // Rewrite relative logoUrl to absolute (based on incoming host) so desktop can just use it.
      const origin = `${(req.headers['x-forwarded-proto'] as string) || 'http'}://${req.headers.host || 'localhost'}`;
      const out = {
        ...registry,
        providers: registry.providers.map((p) => ({
          ...p,
          logoUrl: p.logoUrl.startsWith('http') ? p.logoUrl : `${origin}${p.logoUrl}`,
        })),
      };
      writeJson(res, 200, out, { 'Cache-Control': 'no-store' });
      return true;
    } catch (e: any) {
      writeJson(res, 500, { ok: false, error: 'models_registry_failed', message: e?.message || 'failed' }, { 'Cache-Control': 'no-store' });
      return true;
    }
  }
  return false;
}

async function handleLogoProxy(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = String(parsedUrl.pathname || '');
  if (req.method === 'GET' && path.startsWith('/v1/models/logos/')) {
    try {
      const providerPart = path.replace('/v1/models/logos/', '');
      const providerId = decodeURIComponent(providerPart).replace(/\.svg$/i, '');
      const upstream = `${MODELS_DEV_LOGO_BASE}${encodeURIComponent(providerId)}.svg`;
      const upstreamRes = await fetch(upstream, { headers: { 'User-Agent': 'stuard-cloud-ai' } });
      if (!upstreamRes.ok) {
        writeText(res, 404, 'not_found', { 'Cache-Control': 'public, max-age=60' });
        return true;
      }
      const buf = Buffer.from(await upstreamRes.arrayBuffer());
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml',
        'Content-Length': buf.length,
        'Access-Control-Allow-Origin': '*',
        // Cache logos aggressively; they rarely change.
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      });
      res.end(buf);
      return true;
    } catch {
      writeText(res, 500, 'error', { 'Cache-Control': 'no-store' });
      return true;
    }
  }
  return false;
}

export async function handleModelsRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  // CORS preflight
  const path = String(parsedUrl.pathname || '');
  if (req.method === 'OPTIONS' && (path === '/v1/models' || path.startsWith('/v1/models/logos/'))) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return true;
  }

  if (await handleModelsRegistry(req, res, parsedUrl)) return true;
  if (await handleLogoProxy(req, res, parsedUrl)) return true;
  return false;
}





