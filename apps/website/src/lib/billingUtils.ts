// Shared billing helpers mirroring apps/desktop/src/renderer/components/BillingSettings.utils.ts
// so the website and desktop classify and label usage identically.

export interface UsageLogEntry {
  id: string;
  sourceRef: string | null;
  model: string;
  chatName: string | null;
  conversationId: string | null;
  sourceType: string;
  sourceLabel: string | null;
  subagentKind: string | null;
  credits: number;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  createdAt: string;
  stepCount: number;
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  inference: 'Chat',
  subagent: 'Subagent',
  browser_use: 'Browser Agent',
  browser: 'Browser Agent',
  file_ops: 'File Agent',
  workflow: 'Workflow Agent',
  delegation: 'Delegated Agent',
  google: 'Google Agent',
  outlook: 'Outlook Agent',
  github: 'GitHub Agent',
  meta: 'Meta Agent',
  discord: 'Discord Agent',
  discord_dm: 'Discord DM',
  discord_dm_fallback: 'Discord DM',
  reddit: 'Reddit Agent',
  compute: 'Cloud Compute',
  storage: 'Storage',
  messaging: 'Messaging',
  'messaging:discord': 'Discord',
  'messaging:telnyx': 'SMS',
  'messaging:whatsapp': 'WhatsApp Agent',
  telnyx: 'SMS',
  whatsapp: 'WhatsApp Agent',
  sms: 'SMS',
  reminder_sms: 'SMS Reminder',
  reminder_whatsapp: 'WhatsApp Reminder',
  voice: 'Voice Call',
  'voice:telnyx': 'Voice Call',
  'voice:telnyx:inbound': 'Inbound Call',
  'voice:telnyx:outbound': 'Outbound Call',
  usage: 'Usage',
  unknown: 'Unknown',
};

const KNOWN_INFERENCE_PREFIXES = new Set([
  'anthropic', 'azure', 'cohere', 'deepseek', 'fireworks', 'google', 'grok',
  'groq', 'meta', 'mistral', 'ollama', 'openai', 'openrouter', 'perplexity',
  'vertex', 'xai',
]);

function pickFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value == null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
}

function pickFirstNumber(...values: unknown[]): number {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function buildCreditsApiPath(
  path: string,
  options: { limit?: number; offset?: number; since?: string | null } = {},
): string {
  const params = new URLSearchParams();
  if (Number.isFinite(options.limit) && (options.limit as number) > 0) {
    params.set('limit', String(Math.trunc(options.limit as number)));
  }
  if (Number.isFinite(options.offset) && (options.offset as number) >= 0) {
    params.set('offset', String(Math.trunc(options.offset as number)));
  }
  const rawSince = String(options.since || '').trim();
  if (rawSince) {
    const parsed = new Date(rawSince);
    if (!Number.isNaN(parsed.getTime())) params.set('since', parsed.toISOString());
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function titleCaseToken(token: string): string {
  const lower = token.toLowerCase();
  if (lower === 'ai') return 'AI';
  if (lower === 'sms') return 'SMS';
  if (lower === 'api') return 'API';
  if (lower === 'github') return 'GitHub';
  if (lower === 'whatsapp') return 'WhatsApp';
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function humanizeSourceType(sourceType: string): string {
  const normalized = String(sourceType || '').trim().toLowerCase();
  if (!normalized) return 'Usage';
  const parts = normalized.split(/[:/_-]+/).filter(Boolean);
  if (parts.length === 0) return 'Usage';
  return parts.map(titleCaseToken).join(' ');
}

function inferSourceTypeFromModel(model: string): string {
  const normalized = String(model || '').trim().toLowerCase();
  if (!normalized || normalized === 'unknown') return 'usage';
  if (normalized.startsWith('voice:')) return normalized;
  if (normalized.includes('subagent')) return 'subagent';
  if (normalized.includes('whatsapp')) return 'messaging:whatsapp';
  if (normalized.includes('telnyx') || normalized.includes('sms') || normalized.includes('text-message')) {
    return 'messaging:telnyx';
  }
  if (normalized.includes('discord')) return 'messaging:discord';
  if (normalized.includes('compute')) return 'compute';
  if (normalized.includes('storage')) return 'storage';
  const prefix = normalized.split('/')[0] || normalized;
  if (KNOWN_INFERENCE_PREFIXES.has(prefix) || normalized.includes('/')) return 'inference';
  return 'usage';
}

function normalizeSourceType(value: unknown, model: string): string {
  return (pickFirstString(value) || inferSourceTypeFromModel(model) || 'usage').trim().toLowerCase();
}

export function getUsageSourceLabel(sourceType: string, subagentKind?: string | null, sourceLabel?: string | null): string {
  if (sourceLabel) return sourceLabel;
  const normalized = String(sourceType || 'usage').trim().toLowerCase();
  if (normalized === 'subagent' && subagentKind) return 'Subagent';
  return SOURCE_TYPE_LABELS[normalized] || humanizeSourceType(normalized);
}

export type UsageCategory = 'inference' | 'subagent' | 'compute' | 'storage' | 'messaging' | 'voice';

export function getUsageSourceCategory(sourceType: string, subagentKind?: string | null): UsageCategory {
  const normalized = String(sourceType || 'usage').trim().toLowerCase();
  if (subagentKind || normalized === 'subagent') return 'subagent';
  if (normalized.startsWith('voice:') || normalized === 'voice') return 'voice';
  if (normalized === 'compute') return 'compute';
  if (normalized.includes('storage')) return 'storage';
  if (
    normalized.startsWith('messaging') ||
    normalized.includes('discord') ||
    normalized.includes('sms') ||
    normalized.includes('whatsapp') ||
    normalized.startsWith('reminder_')
  ) {
    return 'messaging';
  }
  return 'inference';
}

export function normalizeUsageLogEntry(entry: any): UsageLogEntry {
  const raw = entry?.raw && typeof entry.raw === 'object' ? entry.raw : {};
  const model = pickFirstString(entry?.model, raw?.model) || 'unknown';
  const promptTokens = pickFirstNumber(entry?.promptTokens, entry?.prompt_tokens, raw?.promptTokens, raw?.prompt_tokens);
  const completionTokens = pickFirstNumber(entry?.completionTokens, entry?.completion_tokens, raw?.completionTokens, raw?.completion_tokens);
  const totalTokens =
    pickFirstNumber(entry?.totalTokens, entry?.total_tokens, raw?.totalTokens, raw?.total_tokens) ||
    promptTokens + completionTokens;

  const sourceRef =
    pickFirstString(entry?.sourceRef, entry?.source_ref, raw?.sourceRef, raw?.source_ref) || null;

  return {
    id: pickFirstString(entry?.id, sourceRef) ||
      `usage-log:${pickFirstString(entry?.createdAt, entry?.created_at) || 'unknown'}`,
    sourceRef,
    model,
    chatName: pickFirstString(entry?.chatName, entry?.chat_name, raw?.chatName, raw?.chat_name) || null,
    conversationId: pickFirstString(entry?.conversationId, entry?.conversation_id, raw?.conversationId, raw?.conversation_id) || null,
    sourceType: normalizeSourceType(
      entry?.sourceType ?? entry?.source_type ?? raw?.sourceType ?? raw?.source_type,
      model,
    ),
    sourceLabel: pickFirstString(entry?.sourceLabel, entry?.source_label, raw?.sourceLabel, raw?.source_label) || null,
    subagentKind: pickFirstString(entry?.subagentKind, entry?.subagent_kind, raw?.subagentKind, raw?.subagent_kind) || null,
    credits: pickFirstNumber(entry?.credits, entry?.creditCost, entry?.credit_cost, raw?.credits, raw?.creditCost, raw?.credit_cost),
    costUsd: pickFirstNumber(entry?.costUsd, entry?.cost_usd, raw?.costUsd, raw?.cost_usd),
    promptTokens,
    completionTokens,
    totalTokens,
    createdAt: pickFirstString(entry?.createdAt, entry?.created_at, raw?.createdAt, raw?.created_at) || '',
    stepCount: Math.max(1, pickFirstNumber(entry?.stepCount, entry?.step_count)),
  };
}

/**
 * Stuard brand chart palette — a warm, red-led ramp used for every dashboard
 * chart (category + model pies, usage bars). Cohesive and on-brand: no blue,
 * green, violet, or cyan. Ordered for adjacent-slice contrast.
 */
export const BRAND_CHART_COLORS = [
  '#FF383C', // Stuard red
  '#F59E0B', // amber
  '#FF7849', // coral
  '#D26A78', // dusty rose
  '#E5B53C', // gold
  '#9C8B7E', // warm gray
  '#C96A3A', // burnt orange
  '#B59B86', // sand
];

export const CATEGORY_CONFIG: Record<UsageCategory, { label: string; hex: string }> = {
  inference: { label: 'AI Inference', hex: '#FF383C' },
  subagent: { label: 'Delegated Agents', hex: '#FF7849' },
  compute: { label: 'Cloud Compute', hex: '#F59E0B' },
  voice: { label: 'Voice Calls', hex: '#E5B53C' },
  messaging: { label: 'Messaging', hex: '#D26A78' },
  storage: { label: 'Storage', hex: '#9C8B7E' },
};

const modelColorCache = new Map<string, string>();
let modelColorIdx = 0;

function getModelColor(category: string): string {
  let hex = modelColorCache.get(category);
  if (!hex) {
    hex = BRAND_CHART_COLORS[modelColorIdx % BRAND_CHART_COLORS.length];
    modelColorCache.set(category, hex);
    modelColorIdx += 1;
  }
  return hex;
}

export function getCategoryDisplay(category: string): { label: string; hex: string } {
  if (category in CATEGORY_CONFIG) return CATEGORY_CONFIG[category as UsageCategory];
  if (category.startsWith('inference:')) {
    const model = category.slice('inference:'.length);
    const label = model.includes('/') ? model.split('/').slice(1).join('/') : model;
    return { label, hex: getModelColor(category) };
  }
  return { label: category, hex: '#9ca3af' };
}

// ── Pure client-safe helpers ────────────────────────────────────────────────

function normalizeStr(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function isTruthyStr(v: unknown): boolean {
  if (v === true) return true;
  const n = normalizeStr(v);
  return n === 'true' || n === '1' || n === 'yes';
}

function isEmbeddingModelName(model: string | null | undefined): boolean {
  const n = normalizeStr(model);
  return n.includes('embedding') || n.includes('embed-text') || n.includes('nomic-embed') || n.includes('mxbai-embed');
}

export function isNonBillableUsageEvent(input: { model?: string | null; raw?: any }): boolean {
  const raw = input?.raw && typeof input.raw === 'object' ? input.raw : {};
  const sourceType = normalizeStr(raw.sourceType ?? raw.source_type);
  const sourceLabel = normalizeStr(raw.source_label ?? raw.sourceLabel);
  const excluded = raw.billingExcluded ?? raw.billing_excluded ?? raw.nonBillable ?? raw.non_billable;
  return (
    isTruthyStr(excluded) ||
    sourceType === 'embedding' ||
    sourceLabel.startsWith('embedding') ||
    isEmbeddingModelName(input?.model ?? raw.model)
  );
}

export function categorizeModelForUsage(model: string): string {
  const m = String(model || 'unknown');
  if (m.startsWith('voice:')) return 'voice';
  if (m.startsWith('messaging:') || ['telnyx', 'sms', 'reminder_sms', 'reminder_whatsapp', 'whatsapp'].includes(m)) return 'messaging';
  if (m.startsWith('compute') || m.startsWith('cloud_compute')) return 'compute';
  if (m.startsWith('storage')) return 'storage';
  if (m.startsWith('subagent') || m.startsWith('browser') || m.startsWith('delegation')) return 'subagent';
  return `inference:${m}`;
}

export function isInferenceModel(model: string | null | undefined): boolean {
  const m = String(model || '');
  return (
    !m.startsWith('voice:') && !m.startsWith('messaging:') &&
    !m.startsWith('compute') && !m.startsWith('storage') &&
    !m.startsWith('subagent') && !m.startsWith('browser') && !m.startsWith('delegation') &&
    m !== 'telnyx' && m !== 'sms' && m !== 'whatsapp' && m !== 'unknown' && m !== ''
  );
}

export function resolveBillingPeriodStart(since?: string | null): Date {
  if (since) {
    const d = new Date(since);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function displayModelName(model: string): string {
  if (!model || model === 'unknown') return 'Unknown';
  let name = model;
  if (name.startsWith('openrouter/')) name = name.slice('openrouter/'.length);
  const slashIdx = name.indexOf('/');
  if (slashIdx !== -1) name = name.slice(slashIdx + 1);
  return name
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((t) => {
      if (!t) return t;
      if (/^\d/.test(t)) return t;
      return t.charAt(0).toUpperCase() + t.slice(1);
    })
    .join(' ');
}

export function formatModel(model: string): string {
  if (!model || model === 'unknown') return 'Unknown';
  if (model.startsWith('voice:')) return '-';
  if (model.startsWith('messaging:') || model === 'telnyx' || model === 'sms') return '-';
  return model
    .replace('anthropic/', '')
    .replace('openai/', '')
    .replace('google/', '')
    .replace('deepseek/', '');
}

export type CreditSummaryLike = {
  unlimited?: boolean;
  limit?: number;
  remaining?: number;
  used?: number;
};

/** % consumed from grant balance (limit − remaining). Floored so ~5 credits left is not rounded to 100%. */
export function creditUsagePercent(summary: CreditSummaryLike | null | undefined): number {
  if (!summary || summary.unlimited) return 0;
  const limit = Number(summary.limit) || 0;
  if (limit <= 0) return 0;
  const remaining = Math.max(0, Number(summary.remaining) || 0);
  const consumed = Math.max(0, limit - remaining);
  return Math.min(100, Math.floor((consumed / limit) * 100));
}

/** 0–100 for progress bars; stays below 100 while any credits remain. */
export function creditUsageBarPercent(summary: CreditSummaryLike | null | undefined): number {
  if (!summary || summary.unlimited) return 0;
  const limit = Number(summary.limit) || 0;
  if (limit <= 0) return 0;
  const remaining = Math.max(0, Number(summary.remaining) || 0);
  const consumed = Math.max(0, limit - remaining);
  const raw = (consumed / limit) * 100;
  return remaining > 0 ? Math.min(99.9, raw) : Math.min(100, raw);
}

export function isCreditExhausted(summary: CreditSummaryLike | null | undefined): boolean {
  if (!summary || summary.unlimited) return false;
  return (Number(summary.remaining) || 0) <= 0;
}

export function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return 'Unknown';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
