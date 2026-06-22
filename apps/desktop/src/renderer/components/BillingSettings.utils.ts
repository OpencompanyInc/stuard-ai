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

export interface ComputeBillingEventRow {
  id?: string | null;
  event_type?: string | null;
  credits_deducted?: number | string | null;
  details?: Record<string, any> | null;
  billing_hour?: string | null;
  created_at?: string | null;
}

export interface UsageBreakdownLike {
  category: string;
  credits: number;
  costUsd: number;
  count: number;
}

const CREDITS_PER_USD_FALLBACK = 33;

const SOURCE_TYPE_LABELS: Record<string, string> = {
  inference: "Chat",
  subagent: "Subagent",
  browser_use: "Browser Agent",
  browser: "Browser Agent",
  file_ops: "File Agent",
  workflow: "Workflow Agent",
  delegation: "Delegated Agent",
  google: "Google Agent",
  outlook: "Outlook Agent",
  github: "GitHub Agent",
  meta: "Meta Agent",
  discord: "Discord Agent",
  discord_dm: "Discord DM",
  discord_dm_fallback: "Discord DM",
  reddit: "Reddit Agent",
  cloud_compute: "Cloud Compute",
  billing_compute: "Cloud Compute",
  compute: "Cloud Compute",
  storage: "Storage",
  hot_storage: "Hot Storage",
  cold_storage: "Cold Storage",
  storage_purchase: "Storage",
  billing_hot_storage: "Hot Storage",
  billing_cold_storage: "Cold Storage",
  messaging: "Messaging",
  "messaging:discord": "Discord",
  "messaging:telnyx": "SMS",
  "messaging:whatsapp": "WhatsApp Agent",
  telnyx: "SMS",
  whatsapp: "WhatsApp Agent",
  sms: "SMS",
  reminder_sms: "SMS Reminder",
  reminder_whatsapp: "WhatsApp Reminder",
  voice: "Voice Call",
  "voice:telnyx": "Voice Call",
  "voice:telnyx:inbound": "Inbound Call",
  "voice:telnyx:outbound": "Outbound Call",
  usage: "Usage",
  unknown: "Unknown",
};

const KNOWN_INFERENCE_PREFIXES = new Set([
  "anthropic",
  "azure",
  "cohere",
  "deepseek",
  "fireworks",
  "google",
  "grok",
  "groq",
  "meta",
  "mistral",
  "ollama",
  "openai",
  "openrouter",
  "perplexity",
  "vertex",
  "xai",
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
    const normalized = Number(value);
    if (Number.isFinite(normalized)) return normalized;
  }
  return 0;
}

export function buildCreditsApiPath(
  path: string,
  options: {
    limit?: number;
    offset?: number;
    since?: string | null;
  } = {}
): string {
  const params = new URLSearchParams();
  const limit = Number(options.limit);
  const offset = Number(options.offset);

  if (Number.isFinite(limit) && limit > 0) {
    params.set("limit", String(Math.trunc(limit)));
  }

  if (Number.isFinite(offset) && offset >= 0) {
    params.set("offset", String(Math.trunc(offset)));
  }

  const rawSince = String(options.since || "").trim();
  if (rawSince) {
    const parsed = new Date(rawSince);
    if (!Number.isNaN(parsed.getTime())) {
      params.set("since", parsed.toISOString());
    }
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function titleCaseToken(token: string): string {
  const lower = token.toLowerCase();
  if (lower === "ai") return "AI";
  if (lower === "sms") return "SMS";
  if (lower === "api") return "API";
  if (lower === "github") return "GitHub";
  if (lower === "whatsapp") return "WhatsApp";
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function humanizeSourceType(sourceType: string): string {
  const normalized = String(sourceType || "").trim().toLowerCase();
  if (!normalized) return "Usage";
  const parts = normalized.split(/[:/_-]+/).filter(Boolean);
  if (parts.length === 0) return "Usage";
  return parts.map(titleCaseToken).join(" ");
}

function inferSourceTypeFromModel(model: string): string {
  const normalized = String(model || "").trim().toLowerCase();
  if (!normalized || normalized === "unknown") return "usage";
  if (normalized.startsWith("voice:")) return normalized;
  if (normalized.includes("subagent")) return "subagent";
  if (normalized.includes("whatsapp")) return "messaging:whatsapp";
  if (
    normalized.includes("telnyx") ||
    normalized.includes("sms") ||
    normalized.includes("text-message")
  ) {
    return "messaging:telnyx";
  }
  if (normalized.includes("discord")) return "messaging:discord";
  if (normalized.includes("compute")) return "compute";
  if (normalized.includes("storage")) return "storage";

  const prefix = normalized.split("/")[0] || normalized;
  if (KNOWN_INFERENCE_PREFIXES.has(prefix) || normalized.includes("/")) {
    return "inference";
  }
  return "usage";
}

function normalizeSourceType(value: unknown, model: string): string {
  return (
    pickFirstString(value) ||
    inferSourceTypeFromModel(model) ||
    "usage"
  )
    .trim()
    .toLowerCase();
}

export function getUsageSourceLabel(
  sourceType: string,
  subagentKind?: string | null,
  sourceLabel?: string | null
): string {
  if (sourceLabel) return sourceLabel;
  const normalized = String(sourceType || "usage").trim().toLowerCase();
  if (normalized === "subagent" && subagentKind) {
    return "Subagent";
  }
  return SOURCE_TYPE_LABELS[normalized] || humanizeSourceType(normalized);
}

export function getUsageSourceCategory(
  sourceType: string,
  subagentKind?: string | null
): "inference" | "subagent" | "compute" | "storage" | "messaging" | "voice" {
  const normalized = String(sourceType || "usage").trim().toLowerCase();
  if (subagentKind || normalized === "subagent") return "subagent";
  if (normalized.startsWith("voice:") || normalized === "voice") return "voice";
  if (normalized === "compute" || normalized.includes("compute")) return "compute";
  if (normalized.includes("storage")) return "storage";
  if (
    normalized.startsWith("messaging") ||
    normalized.includes("discord") ||
    normalized.includes("sms") ||
    normalized.includes("whatsapp") ||
    normalized.startsWith("reminder_")
  ) {
    return "messaging";
  }
  return "inference";
}

export function isNonBillableUsageEvent(input: { model?: string | null; raw?: any }): boolean {
  const raw = input?.raw && typeof input.raw === "object" ? input.raw : {};
  const src = String(raw.sourceType ?? raw.source_type ?? "").trim().toLowerCase();
  const lbl = String(raw.source_label ?? raw.sourceLabel ?? "").trim().toLowerCase();
  const excluded = raw.billingExcluded ?? raw.billing_excluded ?? raw.nonBillable ?? raw.non_billable;
  const isTruthy = (v: unknown) => v === true || String(v).trim().toLowerCase() === "true" || String(v).trim() === "1";
  const isEmbed = (m: string | null | undefined) => {
    const n = String(m ?? "").toLowerCase();
    return n.includes("embedding") || n.includes("embed-text") || n.includes("nomic-embed") || n.includes("mxbai-embed");
  };
  return isTruthy(excluded) || src === "embedding" || lbl.startsWith("embedding") || isEmbed(input?.model ?? raw.model);
}

export function categorizeModelForUsage(model: string): string {
  const m = String(model || "unknown");
  if (m.startsWith("voice:")) return "voice";
  if (m.startsWith("messaging:") || ["telnyx", "sms", "reminder_sms", "reminder_whatsapp", "whatsapp"].includes(m)) return "messaging";
  if (m.startsWith("compute") || m.startsWith("cloud_compute") || m.startsWith("billing_compute")) return "compute";
  if (
    m.startsWith("storage") ||
    m.startsWith("hot_storage") ||
    m.startsWith("cold_storage") ||
    m.startsWith("storage_purchase") ||
    m.startsWith("billing_hot_storage") ||
    m.startsWith("billing_cold_storage")
  ) return "storage";
  if (m.startsWith("subagent") || m.startsWith("browser") || m.startsWith("delegation")) return "subagent";
  return `inference:${m}`;
}

function computeBillingCategory(eventType: string): "compute" | "storage" {
  return eventType === "compute" ? "compute" : "storage";
}

function computeBillingLabel(eventType: string): string {
  switch (eventType) {
    case "compute":
      return "VM Runtime";
    case "hot_storage":
      return "VM Hot Storage";
    case "cold_storage":
      return "VM Cold Storage";
    case "storage_purchase":
      return "Storage Purchase";
    default:
      return "Cloud Computer";
  }
}

function computeBillingModel(eventType: string, details: Record<string, any>): string {
  if (eventType === "compute") {
    const machine = pickFirstString(details?.machineType, details?.machine_type, details?.tier);
    return machine ? `compute:${machine}` : "compute";
  }
  if (eventType === "hot_storage") return "storage:hot";
  if (eventType === "cold_storage") return "storage:cold";
  if (eventType === "storage_purchase") return "storage:purchase";
  return eventType || "compute";
}

export function computeBillingCredits(row: ComputeBillingEventRow): number {
  return Math.max(0, pickFirstNumber(row?.credits_deducted));
}

function computeBillingCostUsd(row: ComputeBillingEventRow): number {
  const details = row?.details && typeof row.details === "object" ? row.details : {};
  const explicitUsd = pickFirstNumber(
    details?.costUsd,
    details?.cost_usd,
    details?.hourlyUsd,
    details?.hourly_usd,
    details?.amountUsd,
    details?.amount_usd
  );
  if (explicitUsd > 0) return explicitUsd;
  return computeBillingCredits(row) / CREDITS_PER_USD_FALLBACK;
}

export function aggregateComputeBillingEvents(rows: ComputeBillingEventRow[]): UsageBreakdownLike[] {
  const buckets: Record<string, UsageBreakdownLike> = {};
  for (const row of rows || []) {
    const eventType = String(row?.event_type || "").trim().toLowerCase();
    if (!eventType) continue;
    const category = computeBillingCategory(eventType);
    if (!buckets[category]) buckets[category] = { category, credits: 0, costUsd: 0, count: 0 };
    buckets[category].credits += computeBillingCredits(row);
    buckets[category].costUsd += computeBillingCostUsd(row);
    buckets[category].count += 1;
  }
  return Object.values(buckets).map((item) => ({
    ...item,
    credits: Number(item.credits.toFixed(2)),
    costUsd: Number(item.costUsd.toFixed(6)),
  }));
}

export function rollupUsageCategory(category: string): string {
  const cat = String(category || "usage");
  if (!cat.startsWith("inference:")) return cat;

  const model = cat.slice("inference:".length);
  if (!model || model === "unknown") return "inference:other";

  const provider = model.includes("/")
    ? model.split("/")[0].toLowerCase()
    : model.toLowerCase();

  const knownProviders = new Set([
    "anthropic",
    "openai",
    "google",
    "deepseek",
    "meta",
    "mistral",
    "groq",
    "ollama",
    "x-ai",
    "cohere",
  ]);

  return knownProviders.has(provider) ? `inference:${provider}` : "inference:other";
}

export function rollupUsageBreakdownForDisplay(
  items: UsageBreakdownLike[],
  options?: { maxItems?: number },
): UsageBreakdownLike[] {
  const maxItems = Math.max(4, options?.maxItems ?? 8);
  const merged: Record<string, UsageBreakdownLike> = {};

  for (const row of items || []) {
    const category = rollupUsageCategory(String(row?.category || "usage"));
    if (!merged[category]) merged[category] = { category, credits: 0, costUsd: 0, count: 0 };
    merged[category].credits += Number(row?.credits) || 0;
    merged[category].costUsd += Number(row?.costUsd) || 0;
    merged[category].count += Number(row?.count) || 0;
  }

  const sorted = Object.values(merged)
    .map((item) => ({
      ...item,
      credits: Number(item.credits.toFixed(2)),
      costUsd: Number(item.costUsd.toFixed(6)),
    }))
    .sort((a, b) => b.credits - a.credits || b.count - a.count);

  if (sorted.length <= maxItems) return sorted;

  const head = sorted.slice(0, maxItems - 1);
  const tail = sorted.slice(maxItems - 1);
  const other: UsageBreakdownLike = {
    category: "other",
    credits: Number(tail.reduce((sum, item) => sum + item.credits, 0).toFixed(2)),
    costUsd: Number(tail.reduce((sum, item) => sum + item.costUsd, 0).toFixed(6)),
    count: tail.reduce((sum, item) => sum + item.count, 0),
  };

  return [...head, other];
}

/**
 * Activity-level breakdown — answers "what did I spend credits on?" rather than
 * "which model vendor served the request?". Every charge the system records carries
 * an activity (chat, delegated agents, voice, messaging, cloud compute, storage),
 * which is far more meaningful to a user than the underlying model provider. The
 * per-provider model split is kept as a drill-down under the "ai" activity so power
 * users can still see it without it dominating the top level.
 */
export type UsageActivityKey =
  | "ai"
  | "subagent"
  | "compute"
  | "storage"
  | "messaging"
  | "voice"
  | "other";

export interface UsageActivityProvider {
  category: string; // inference:<provider>
  credits: number;
  costUsd: number;
  count: number;
}

export interface UsageActivityRow {
  key: UsageActivityKey;
  credits: number;
  costUsd: number;
  count: number;
  /** Per-provider model detail — only populated for the "ai" activity. */
  providers?: UsageActivityProvider[];
}

export function usageActivityFromCategory(category: string): UsageActivityKey {
  const cat = String(category || "usage").toLowerCase();
  if (cat.startsWith("inference:")) return "ai";
  if (cat === "subagent" || cat.startsWith("subagent") || cat.startsWith("browser") || cat.startsWith("delegation")) {
    return "subagent";
  }
  if (cat === "voice" || cat.startsWith("voice")) return "voice";
  if (cat === "messaging" || cat.startsWith("messaging")) return "messaging";
  if (cat === "compute" || cat.startsWith("compute") || cat.startsWith("cloud_compute")) return "compute";
  if (cat === "storage" || cat.startsWith("storage")) return "storage";
  return "other";
}

export function buildUsageActivityBreakdown(
  items: UsageBreakdownLike[],
  options?: { maxProviders?: number },
): UsageActivityRow[] {
  const maxProviders = Math.max(3, options?.maxProviders ?? 5);
  const activities = new Map<UsageActivityKey, UsageActivityRow>();
  const providerBuckets = new Map<string, UsageActivityProvider>();

  for (const row of items || []) {
    const credits = Number(row?.credits) || 0;
    const costUsd = Number(row?.costUsd) || 0;
    const count = Number(row?.count) || 0;
    const key = usageActivityFromCategory(String(row?.category || "usage"));

    const activity = activities.get(key) || { key, credits: 0, costUsd: 0, count: 0 };
    activity.credits += credits;
    activity.costUsd += costUsd;
    activity.count += count;
    activities.set(key, activity);

    if (key === "ai") {
      const providerCat = rollupUsageCategory(String(row?.category || "usage"));
      const bucket = providerBuckets.get(providerCat) || { category: providerCat, credits: 0, costUsd: 0, count: 0 };
      bucket.credits += credits;
      bucket.costUsd += costUsd;
      bucket.count += count;
      providerBuckets.set(providerCat, bucket);
    }
  }

  const aiRow = activities.get("ai");
  if (aiRow) {
    let providers = Array.from(providerBuckets.values())
      .map((p) => ({ ...p, credits: Number(p.credits.toFixed(2)), costUsd: Number(p.costUsd.toFixed(6)) }))
      .sort((a, b) => b.credits - a.credits || b.count - a.count);

    if (providers.length > maxProviders) {
      const head = providers.slice(0, maxProviders - 1);
      const remainder = providers.slice(maxProviders - 1).reduce(
        (acc, p) => ({
          credits: acc.credits + p.credits,
          costUsd: acc.costUsd + p.costUsd,
          count: acc.count + p.count,
        }),
        { credits: 0, costUsd: 0, count: 0 },
      );
      const existingOther = head.find((p) => p.category === "inference:other");
      if (existingOther) {
        existingOther.credits = Number((existingOther.credits + remainder.credits).toFixed(2));
        existingOther.costUsd = Number((existingOther.costUsd + remainder.costUsd).toFixed(6));
        existingOther.count += remainder.count;
      } else {
        head.push({
          category: "inference:other",
          credits: Number(remainder.credits.toFixed(2)),
          costUsd: Number(remainder.costUsd.toFixed(6)),
          count: remainder.count,
        });
      }
      providers = head.sort((a, b) => b.credits - a.credits || b.count - a.count);
    }
    aiRow.providers = providers;
  }

  return Array.from(activities.values())
    .map((a) => ({ ...a, credits: Number(a.credits.toFixed(2)), costUsd: Number(a.costUsd.toFixed(6)) }))
    .sort((a, b) => b.credits - a.credits || b.count - a.count);
}

export function mergeUsageBreakdowns(
  usageRows: UsageBreakdownLike[],
  computeRows: UsageBreakdownLike[]
): UsageBreakdownLike[] {
  const merged: Record<string, UsageBreakdownLike> = {};
  for (const row of [...(usageRows || []), ...(computeRows || [])]) {
    const category = String(row?.category || "usage");
    if (!merged[category]) merged[category] = { category, credits: 0, costUsd: 0, count: 0 };
    merged[category].credits += Number(row?.credits) || 0;
    merged[category].costUsd += Number(row?.costUsd) || 0;
    merged[category].count += Number(row?.count) || 0;
  }
  return Object.values(merged)
    .map((item) => ({
      ...item,
      credits: Number(item.credits.toFixed(2)),
      costUsd: Number(item.costUsd.toFixed(6)),
    }))
    .sort((a, b) => b.credits - a.credits || b.count - a.count);
}

export function normalizeComputeBillingLogEntry(row: ComputeBillingEventRow): UsageLogEntry {
  const eventType = String(row?.event_type || "compute").trim().toLowerCase();
  const details = row?.details && typeof row.details === "object" ? row.details : {};
  const createdAt = pickFirstString(row?.billing_hour, row?.created_at) || "";
  const id = pickFirstString(row?.id) || `compute-billing:${eventType}:${createdAt}`;

  return normalizeUsageLogEntry({
    id,
    source_ref: `compute-billing:${eventType}:${createdAt || id}`,
    model: computeBillingModel(eventType, details),
    source_type: computeBillingCategory(eventType),
    source_label: computeBillingLabel(eventType),
    credit_cost: computeBillingCredits(row),
    cost_usd: computeBillingCostUsd(row),
    created_at: createdAt,
    step_count: 1,
  });
}

export function normalizeUsageLogEntry(entry: any): UsageLogEntry {
  const raw = entry?.raw && typeof entry.raw === "object" ? entry.raw : {};
  const model = pickFirstString(entry?.model, raw?.model) || "unknown";
  const promptTokens = pickFirstNumber(
    entry?.promptTokens,
    entry?.prompt_tokens,
    raw?.promptTokens,
    raw?.prompt_tokens
  );
  const completionTokens = pickFirstNumber(
    entry?.completionTokens,
    entry?.completion_tokens,
    raw?.completionTokens,
    raw?.completion_tokens
  );
  const totalTokens =
    pickFirstNumber(
      entry?.totalTokens,
      entry?.total_tokens,
      raw?.totalTokens,
      raw?.total_tokens
    ) ||
    promptTokens + completionTokens;

  const sourceRef =
    pickFirstString(
      entry?.sourceRef,
      entry?.source_ref,
      raw?.sourceRef,
      raw?.source_ref
    ) || null;

  return {
    id:
      pickFirstString(entry?.id, sourceRef) ||
      `usage-log:${pickFirstString(entry?.createdAt, entry?.created_at) || "unknown"}`,
    sourceRef,
    model,
    chatName:
      pickFirstString(
        entry?.chatName,
        entry?.chat_name,
        raw?.chatName,
        raw?.chat_name
      ) || null,
    conversationId:
      pickFirstString(
        entry?.conversationId,
        entry?.conversation_id,
        raw?.conversationId,
        raw?.conversation_id
      ) || null,
    sourceType: normalizeSourceType(
      entry?.sourceType ??
        entry?.source_type ??
        raw?.sourceType ??
        raw?.source_type,
      model
    ),
    sourceLabel:
      pickFirstString(
        entry?.sourceLabel,
        entry?.source_label,
        raw?.sourceLabel,
        raw?.source_label
      ) || null,
    subagentKind:
      pickFirstString(
        entry?.subagentKind,
        entry?.subagent_kind,
        raw?.subagentKind,
        raw?.subagent_kind
      ) || null,
    credits: pickFirstNumber(
      entry?.credits,
      entry?.creditCost,
      entry?.credit_cost,
      raw?.credits,
      raw?.creditCost,
      raw?.credit_cost
    ),
    costUsd: pickFirstNumber(
      entry?.costUsd,
      entry?.cost_usd,
      raw?.costUsd,
      raw?.cost_usd
    ),
    promptTokens,
    completionTokens,
    totalTokens,
    createdAt:
      pickFirstString(
        entry?.createdAt,
        entry?.created_at,
        raw?.createdAt,
        raw?.created_at
      ) || "",
    stepCount: Math.max(
      1,
      pickFirstNumber(entry?.stepCount, entry?.step_count)
    ),
  };
}

export type CreditSummaryLike = {
  unlimited?: boolean;
  limit?: number;
  remaining?: number;
  used?: number;
};

export function creditUsagePercent(summary: CreditSummaryLike | null | undefined): number {
  if (!summary || summary.unlimited) return 0;
  const limit = Number(summary.limit) || 0;
  if (limit <= 0) return 0;
  const remaining = Math.max(0, Number(summary.remaining) || 0);
  const consumed = Math.max(0, limit - remaining);
  return Math.min(100, Math.floor((consumed / limit) * 100));
}

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
