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
  compute: "Cloud Compute",
  storage: "Storage",
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
  if (normalized === "compute") return "compute";
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
  if (m.startsWith("compute") || m.startsWith("cloud_compute")) return "compute";
  if (m.startsWith("storage")) return "storage";
  if (m.startsWith("subagent") || m.startsWith("browser") || m.startsWith("delegation")) return "subagent";
  return `inference:${m}`;
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
