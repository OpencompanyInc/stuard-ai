import type { IncomingMessage, ServerResponse } from 'http';
import { createHash } from 'crypto';
import { generateText, generateObject, streamText, embed, embedMany, stepCountIs, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { google, buildProviderEmbeddingModel, buildProviderModel, buildProviderModelForUser } from '../utils/models';
import { userHasUserFundedInference } from '../byok/keys';
import { z } from 'zod';
import { verifyToken, checkAccess, logUsageEvent } from '../supabase';
import { CORS_ALLOWED_ORIGINS, IS_DEVELOPMENT } from '../utils/config';
import { search_tools } from '../tools/meta-tools';

/**
 * Extracts and validates Supabase auth token from request.
 * Returns userId if valid, null otherwise.
 * In development mode, allows unauthenticated requests for local testing.
 */
async function validateAuth(req: IncomingMessage): Promise<{ userId: string | null; isAuthed: boolean }> {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  
  if (token) {
    try {
      const user = await verifyToken(token);
      if (user?.userId) {
        return { userId: user.userId, isAuthed: true };
      }
    } catch {}
  }
  
  // Local-only escape hatch for manual inference testing.
  if (IS_DEVELOPMENT && process.env.ALLOW_UNAUTHENTICATED_INFERENCE === '1') {
    return { userId: null, isAuthed: true };
  }
  
  return { userId: null, isAuthed: false };
}

async function validateStrictBearerAuth(req: IncomingMessage): Promise<{ userId: string | null; isAuthed: boolean }> {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { userId: null, isAuthed: false };
  try {
    const user = await verifyToken(token);
    if (user?.userId) return { userId: user.userId, isAuthed: true };
    return { userId: null, isAuthed: false };
  } catch {
    return { userId: null, isAuthed: false };
  }
}

/** Log inference usage after a successful generateText/embed call. */
async function logInferenceUsage(
  userId: string | null,
  model: string,
  usage?: any,
  sourceLabel?: string,
  options?: { sourceType?: string; billingExcluded?: boolean },
): Promise<void> {
  if (!userId) return;
  try {
    await logUsageEvent(userId, null, model, {
      ...(usage || {}),
      sourceType: options?.sourceType || 'inference',
      ...(sourceLabel ? { source_label: sourceLabel } : {}),
      ...(options?.billingExcluded ? { billingExcluded: true } : {}),
    });
  } catch {}
}

/**
 * Check if user has credits before running inference. Returns error string or
 * null if OK. When `modelSource` is a real BYOK key / ChatGPT subscription the
 * user funds their own inference, so the Stuard credit balance is not required
 * (verified server-side; the client's claim alone can't bypass the gate).
 */
async function requireCredits(userId: string | null, modelSource?: unknown): Promise<string | null> {
  if (!userId) return 'unauthorized';
  try {
    if (await userHasUserFundedInference(userId, modelSource)) return null;
    const access = await checkAccess(userId);
    if (!access.allowed) return access.reason || 'credit_limit_exceeded';
  } catch {
    return 'credit_check_failed';
  }
  return null;
}

/**
 * Gets CORS origin header based on request and configuration.
 */
function getCorsOrigin(req: IncomingMessage): string {
  const origin = req.headers.origin || '';
  
  // Development mode: allow all
  if (CORS_ALLOWED_ORIGINS === '*') return '*';
  
  // No allowed origins configured: deny cross-origin
  if (!CORS_ALLOWED_ORIGINS) return '';
  
  // Check if origin is in allowed list
  const allowed = CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim());
  if (allowed.includes(origin)) return origin;
  
  // Origin not allowed
  return '';
}

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => { try { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); } catch {} });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function writeJson(res: ServerResponse, status: number, obj: any, corsOrigin: string = '*') {
  try {
    const body = JSON.stringify(obj);
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };
    if (corsOrigin) {
      headers['Access-Control-Allow-Origin'] = corsOrigin;
      headers['Vary'] = 'Origin';
    }
    res.writeHead(status, headers);
    res.end(body);
  } catch {
    try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"internal"}'); } catch {}
  }
}

function normalizeOpenAIContentToText(content: any): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === 'string') {
        parts.push(item);
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const t = String((item as any).type || '').toLowerCase();
      if ((t === 'text' || t === 'input_text' || t === 'output_text') && typeof (item as any).text === 'string') {
        parts.push((item as any).text);
        continue;
      }
      if (typeof (item as any).text === 'string') {
        parts.push((item as any).text);
        continue;
      }
      if (typeof (item as any).input === 'string') {
        parts.push((item as any).input);
        continue;
      }
      try {
        parts.push(JSON.stringify(item));
      } catch {}
    }
    return parts.filter(Boolean).join('\n');
  }

  if (typeof content === 'object') {
    if (typeof (content as any).text === 'string') return (content as any).text;
    if (typeof (content as any).input === 'string') return (content as any).input;
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  return String(content);
}

function shouldNormalizeJsonOutput(messages: Array<{ role: string; content: string }>): boolean {
  const tail = messages.slice(-3).map((m) => m.content.toLowerCase()).join('\n');
  return (
    tail.includes('valid json') ||
    tail.includes('json object') ||
    tail.includes('output only the json') ||
    tail.includes('respond with json') ||
    tail.includes('schema')
  );
}

function tryNormalizeJsonLikeText(text: string): string {
  const trimmed = String(text || '').trim();
  if (!trimmed) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || trimmed).trim();

  try {
    const parsed = JSON.parse(candidate);
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
  } catch {}

  const firstObj = candidate.indexOf('{');
  const lastObj = candidate.lastIndexOf('}');
  if (firstObj >= 0 && lastObj > firstObj) {
    const objSlice = candidate.slice(firstObj, lastObj + 1);
    try {
      const parsed = JSON.parse(objSlice);
      return JSON.stringify(parsed);
    } catch {}
  }

  return candidate;
}

function buildProxyModelCandidates(requestedModelId: string): string[] {
  const raw = String(requestedModelId || '').trim();
  const modelId = raw.includes('/') ? raw : `google/${raw || 'gemini-3-flash-preview'}`;
  const lower = modelId.toLowerCase();
  const out: string[] = [modelId];

  if (lower.startsWith('google/')) {
    out.push('google/gemini-2.5-flash', 'openai/gpt-4.1-mini', 'openai/gpt-4o-mini');
  } else if (lower.startsWith('openai/')) {
    out.push('openai/gpt-4.1-mini', 'openai/gpt-4o-mini', 'google/gemini-2.5-flash');
  } else {
    out.push('openai/gpt-4.1-mini', 'openai/gpt-4o-mini', 'google/gemini-2.5-flash');
  }

  const seen = new Set<string>();
  return out.filter((id) => {
    const key = id.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarizeModelError(e: any): string {
  const statusCode = Number((e as any)?.statusCode || (e as any)?.cause?.statusCode || 0);
  const msg = String((e as any)?.message || '').slice(0, 220);
  const reason = String((e as any)?.reason || '').slice(0, 80);
  if (statusCode) return `status=${statusCode}${reason ? ` reason=${reason}` : ''}${msg ? ` msg=${msg}` : ''}`;
  return `${reason || 'error'}${msg ? ` msg=${msg}` : ''}`;
}

function pickModelProvider() {
  // Prefer OpenAI if available; otherwise fall back to Gemini; if both fail, caller should handle.
  const prefer = (process.env.WORKFLOW_INFER_PROVIDER || '').toLowerCase();
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasGemini = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY || !!process.env.GEMINI_API_KEY || !!process.env.GOOGLE_API_KEY;
  if ((prefer === 'openai' && hasOpenAI) || (hasOpenAI && !hasGemini)) return { kind: 'openai' as const, model: 'gpt-4.1-mini' };
  if (hasGemini) return { kind: 'google' as const, model: 'gemini-3.1-flash-lite' };
  // default to openai id (may fail; handled by try/catch in callers)
  return { kind: 'openai' as const, model: 'gpt-4.1-mini' };
}

const BOT_BLUEPRINT_INTERVALS = ['10m', '15m', '30m', '1h', '2h', 'random', 'manual'] as const;
const BOT_BLUEPRINT_INTERNAL_TOOLS = new Set([
  'search_tools',
  'get_tool_schema',
  'execute_tool',
  'get_skill_info',
  'choose_notification_channel',
  'write_session_summary',
  'search_past_conversations',
  'get_conversation_context',
]);

const BOT_BLUEPRINT_PROBES = [
  'tool_available',
  'binary_available',
  'folder_access',
  'oauth_connected',
  'capture_devices_available',
  'dry_run_tool',
] as const;
type BotBlueprintProbeName = typeof BOT_BLUEPRINT_PROBES[number];

const BotBlueprintPreflightStepSchema = z.object({
  id: z.string().min(1).max(64),
  probe: z.enum(BOT_BLUEPRINT_PROBES),
  label: z.string().min(1).max(120),
  rationale: z.string().max(280).optional(),
  args: z.record(z.string(), z.any()).optional(),
});

// Trigger types the builder may choose. Mirrors the desktop trigger picker
// (TriggersSection.tsx). X social triggers are included — X webhooks are live
// and the desktop fully wires their subscriptions. gmail.new_email stays out
// (gated on Google CASA verification) and instagram.* stays out (gated on
// META_INTEGRATION_ENABLED). ANY trigger firing wakes the agent.
const BOT_BLUEPRINT_TRIGGER_TYPES = [
  'schedule.interval',
  'schedule.cron',
  'webhook',
  'fs.watch',
  'command.watch',
  'x.new_comment',
  'x.new_mention',
  'x.new_dm',
  'x.new_follower',
  'x.user_post',
  'manual',
] as const;
type BotBlueprintTriggerType = typeof BOT_BLUEPRINT_TRIGGER_TYPES[number];

const BotBlueprintTriggerSchema = z.object({
  type: z.enum(BOT_BLUEPRINT_TRIGGER_TYPES),
  args: z.record(z.string(), z.any()).optional(),
  label: z.string().max(80).optional(),
  rationale: z.string().max(280).optional(),
});
type BotBlueprintTrigger = z.infer<typeof BotBlueprintTriggerSchema>;

const BotBlueprintResponseSchema = z.object({
  name: z.string().min(1).max(80),
  emoji: z.string().min(1).max(16).optional(),
  description: z.string().min(1).max(320),
  systemPrompt: z.string().min(1).max(6000),
  instructions: z.string().min(1).max(2000),
  allowedTools: z.array(z.string()).max(12).default([]),
  interval: z.enum(BOT_BLUEPRINT_INTERVALS).default('30m'),
  toolRationale: z.array(z.object({
    tool: z.string(),
    reason: z.string(),
  })).max(12).default([]),
  clarifyingQuestions: z.array(z.string().min(1).max(220)).max(5).default([]),
  clarifyingAnswers: z.array(z.object({
    question: z.string(),
    answer: z.string(),
  })).max(10).default([]),
  setupChecks: z.array(z.string().min(1).max(220)).max(6).default([]),
  preflightSteps: z.array(BotBlueprintPreflightStepSchema).max(8).default([]),
  triggers: z.array(BotBlueprintTriggerSchema).max(5).default([]),
});

type PendingBlueprintClarification = {
  resolve: (answers: Array<{ question: string; answer: string }>) => void;
  questions: string[];
  expiresAt: number;
};
const pendingBlueprintClarifications = new Map<string, PendingBlueprintClarification>();
let pendingBlueprintClarificationSweeperStarted = false;
function ensurePendingBlueprintClarificationSweeper() {
  if (pendingBlueprintClarificationSweeperStarted) return;
  pendingBlueprintClarificationSweeperStarted = true;
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of pendingBlueprintClarifications.entries()) {
      if (entry.expiresAt < now) {
        pendingBlueprintClarifications.delete(id);
        try { entry.resolve([]); } catch {}
      }
    }
    for (const [id, entry] of pendingBlueprintTestRuns.entries()) {
      if (entry.expiresAt < now) {
        pendingBlueprintTestRuns.delete(id);
        try { entry.resolve({ status: 'warn', detail: 'No probe runner responded in time. Treat as not yet verified.' }); } catch {}
      }
    }
  }, 30_000);
  sweeper.unref?.();
}

type BlueprintTestRunStatus = 'pass' | 'fail' | 'warn' | 'unsupported';
type BlueprintTestRunResult = { status: BlueprintTestRunStatus; detail?: string };
type VerifiedBlueprintProbeFact = {
  probe: BotBlueprintProbeName | string;
  label?: string;
  args?: Record<string, any>;
  status: BlueprintTestRunStatus;
  detail: string;
};
type PendingBlueprintTestRun = {
  resolve: (result: BlueprintTestRunResult) => void;
  probe: string;
  args: Record<string, any> | undefined;
  label: string;
  expiresAt: number;
};
const pendingBlueprintTestRuns = new Map<string, PendingBlueprintTestRun>();

type BotBlueprintResponse = z.infer<typeof BotBlueprintResponseSchema>;

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const LAUNCHER_SUGGESTIONS_CACHE_TTL_MS = readPositiveIntegerEnv('LAUNCHER_SUGGESTIONS_CACHE_TTL_MS', 30 * 60 * 1000);
const LAUNCHER_SUGGESTIONS_CACHE_MAX_ENTRIES = readPositiveIntegerEnv('LAUNCHER_SUGGESTIONS_CACHE_MAX_ENTRIES', 1000);
const LAUNCHER_SUGGESTIONS_MODEL_ID = 'google/gemini-3.1-flash-lite';

type LauncherSuggestionsResult = {
  suggestions: string[];
  text: string;
};

type LauncherSuggestionsCacheEntry = LauncherSuggestionsResult & {
  expiresAt: number;
};

const launcherSuggestionsCache = new Map<string, LauncherSuggestionsCacheEntry>();
const launcherSuggestionsInFlight = new Map<string, Promise<LauncherSuggestionsResult>>();

function compactText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hashLauncherSuggestionsContext(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function createLauncherSuggestionsServerCacheKey(args: {
  userId: string | null;
  prompt: string;
  name: string;
  memories: string[];
  count: number;
}): string {
  return hashLauncherSuggestionsContext({
    userId: args.userId || 'anonymous',
    prompt: args.prompt.trim(),
    name: args.name.trim().toLowerCase(),
    memories: args.memories.map((m) => String(m || '').trim()).filter(Boolean),
    count: args.count,
  });
}

function getCachedLauncherSuggestions(cacheKey: string, now = Date.now()): LauncherSuggestionsCacheEntry | null {
  const cached = launcherSuggestionsCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= now) {
    launcherSuggestionsCache.delete(cacheKey);
    return null;
  }
  return cached;
}

function cacheLauncherSuggestionsResult(cacheKey: string, result: LauncherSuggestionsResult, now = Date.now()): LauncherSuggestionsCacheEntry {
  const cached = {
    ...result,
    expiresAt: now + LAUNCHER_SUGGESTIONS_CACHE_TTL_MS,
  };
  launcherSuggestionsCache.set(cacheKey, cached);

  if (launcherSuggestionsCache.size > LAUNCHER_SUGGESTIONS_CACHE_MAX_ENTRIES) {
    const oldestKey = launcherSuggestionsCache.keys().next().value;
    if (oldestKey) launcherSuggestionsCache.delete(oldestKey);
  }

  return cached;
}

export function parseLauncherSuggestionsText(text: string, suggestionCount: number): string[] {
  let suggestions: string[] = [];
  const trimmed = String(text || '').trim();

  try {
    const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : trimmed;
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      suggestions = parsed.map((s) => String(s || '').trim()).filter(Boolean).slice(0, suggestionCount);
    }
  } catch {
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1));
        if (Array.isArray(parsed)) {
          suggestions = parsed.map((s) => String(s || '').trim()).filter(Boolean).slice(0, suggestionCount);
        }
      } catch { /* ignore */ }
    }
  }

  return suggestions.filter((s) => !s.toLowerCase().startsWith('help me with'));
}

function isInternalBotBlueprintTool(name: string): boolean {
  return BOT_BLUEPRINT_INTERNAL_TOOLS.has(name)
    || name.startsWith('proactive_task_')
    || name.startsWith('bot_memory_');
}

function isBlockedBotBlueprintTool(name: string): boolean {
  return !name || isInternalBotBlueprintTool(name) || (name.startsWith('browser_') && !name.startsWith('browser_use_'));
}

function normalizeAvailableToolNames(value: unknown): string[] {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((toolName) => String(toolName || '').trim())
      .filter(Boolean)
  )).slice(0, 500);
}

type BotBlueprintPreflightStep = z.infer<typeof BotBlueprintPreflightStepSchema>;

// Keyword-driven inference helpers used to live here (interval, tool needs,
// clarifying questions, setup checks). They were removed because they pattern-
// matched on a specific user example and produced wrong picks for everything
// else. The model now drives interval, tools, questions, and checks via the
// builder tools and final JSON. See feedback_no_example_hardcoding.md.

function extractEmailAddress(text: string): string {
  return compactText(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
}

function clarificationAnswerFromVerifiedFacts(question: string, facts: VerifiedBlueprintProbeFact[]): string {
  const q = compactText(question).toLowerCase();
  if (!q) return '';
  const passedFacts = facts.filter((fact) => fact.status === 'pass');

  const asksForFolder = /\b(folder|directory|path|where|watch|recording|recordings|video|videos|camera roll|saved)\b/i.test(q);
  if (asksForFolder) {
    const folderFact = passedFacts.find((fact) => fact.probe === 'folder_access' && compactText(fact.args?.path));
    const folderPath = compactText(folderFact?.args?.path);
    if (folderPath) return folderPath;
  }

  const asksForEmail = /\b(email|mail|gmail|recipient|send to|account|address)\b/i.test(q);
  if (asksForEmail) {
    const oauthFact = passedFacts.find((fact) => fact.probe === 'oauth_connected' && /^(google|gmail)$/i.test(compactText(fact.args?.provider)));
    const email = extractEmailAddress(oauthFact?.detail || '');
    if (email) return email;
    if (oauthFact) return 'Use the connected Gmail account verified by the desktop probe.';
  }

  return '';
}

export function resolveClarificationsFromVerifiedFacts(
  questions: string[],
  facts: VerifiedBlueprintProbeFact[],
): { answered: Array<{ question: string; answer: string }>; unanswered: string[] } {
  const answered: Array<{ question: string; answer: string }> = [];
  const unanswered: string[] = [];
  for (const rawQuestion of questions) {
    const question = compactText(rawQuestion);
    if (!question) continue;
    const answer = clarificationAnswerFromVerifiedFacts(question, facts);
    if (answer) answered.push({ question, answer });
    else unanswered.push(question);
  }
  return { answered, unanswered };
}

function parseJsonObjectFromText(text: string): any | null {
  const normalized = tryNormalizeJsonLikeText(text);
  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function sanitizeBotBlueprint(raw: unknown, args: {
  goal: string;
  preferredName?: string;
  availableTools: string[];
  discoveredTools: Array<{ name: string; description: string; category: string }>;
  builderClarifyingQuestions?: string[];
  clarifyingAnswers?: Array<{ question: string; answer: string }>;
  registeredPreflightSteps?: Array<BotBlueprintPreflightStep>;
}): BotBlueprintResponse {
  const cleanedGoal = compactText(args.goal);
  const fallbackName = compactText(args.preferredName)
    || cleanedGoal
      .replace(/^(create|make|build|set up|setup|add)\s+(a|an)?\s*/i, '')
      .replace(/\b(bot|agent)\b/gi, '')
      .split(/\s+/)
      .slice(0, 4)
      .map((word) => word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : '')
      .filter(Boolean)
      .join(' ')
    || 'Proactive Agent';

  const available = new Set(args.availableTools);
  const discovered = new Set(args.discoveredTools.map((entry) => entry.name));
  const hasAvailableFilter = available.size > 0;
  const isAvailableTool = (toolName: string) => {
    if (isBlockedBotBlueprintTool(toolName)) return false;
    if (hasAvailableFilter && !available.has(toolName)) return false;
    return true;
  };
  // Only used for the zero-tools fallback below. The model's OWN picks must NOT
  // be gated on `discovered`: the model can legitimately surface a tool via
  // agent_test_run (e.g. an oauth_connected/dry_run_tool probe on
  // gmail_send_message) without ever calling agent_tool_search for it, and those
  // probed-but-not-searched tools were getting silently dropped — leaving an
  // agent with only the one tool it happened to search for. `isAvailableTool`
  // already guarantees the name is a real, non-blocked registry tool, which is
  // the actual anti-hallucination guarantee we need.
  const canUseDiscoveredTool = (toolName: string) => {
    if (!isAvailableTool(toolName)) return false;
    if (discovered.size > 0 && !discovered.has(toolName)) return false;
    return true;
  };

  const candidate = raw && typeof raw === 'object' ? raw as any : {};
  const pickedTools: string[] = Array.from(new Set<string>(
    (Array.isArray(candidate.allowedTools) ? candidate.allowedTools : [])
      .map((toolName: any) => String(toolName || '').trim())
      .filter(isAvailableTool)
  )).slice(0, 12);

  // When the model returned zero tools, fall back to whatever it discovered via
  // semantic search. This is generic (the discovery happens against the live
  // catalog), so it doesn't lean on any keyword pattern from a specific user
  // example. We deliberately do NOT mix keyword-derived guesses into the model's
  // own picks anymore — that produced the "always pick capture_media on record"
  // misfires.
  const fallbackTools: string[] = args.discoveredTools
    .map((entry) => entry.name)
    .filter(canUseDiscoveredTool)
    .slice(0, 8);

  // Trust the model's tool picks. Keyword-derived inferredToolNeeds and discovered
  // fallback tools only kick in when the model returned zero tools, so we don't
  // silently inject example-coupled picks (e.g. forcing capture_media on "record").
  const registeredPreflightProbes = new Set<string>(
    (Array.isArray(args.registeredPreflightSteps) ? args.registeredPreflightSteps : [])
      .map((step) => String(step?.probe || ''))
      .filter(Boolean),
  );
  const captureProbeRan = registeredPreflightProbes.has('capture_devices_available');
  // Generic rule: any tool whose name starts with `capture_` or `stop_capture` is
  // a desktop capture primitive. Allowing the agent to use one without first
  // verifying capture devices is what produces the "user records on their phone
  // → agent shouldn't capture anything itself" misfire. The check is by name
  // prefix, not by a hardcoded list, so future capture tools are covered too.
  const stripCaptureTools = (tools: string[]) => tools.filter((tool) => {
    if (captureProbeRan) return true;
    return !(tool.startsWith('capture_') || tool.startsWith('stop_capture'));
  });
  const primaryTools = stripCaptureTools(pickedTools);
  const allowedTools: string[] = primaryTools.length > 0
    ? primaryTools.slice(0, 12)
    : stripCaptureTools(fallbackTools).slice(0, 12);
  const description = compactText(candidate.description) || cleanedGoal;
  const name = compactText(candidate.name) || (fallbackName.endsWith('Agent') ? fallbackName : `${fallbackName} Agent`);
  let systemPrompt = String(candidate.systemPrompt || '').trim();
  if (systemPrompt && description) {
    const descNeedle = description.toLowerCase().slice(0, 80);
    if (descNeedle && !systemPrompt.toLowerCase().includes(descNeedle)) {
      systemPrompt = `${systemPrompt}\n\nDescription:\n- ${description}`;
    }
  }
  systemPrompt = systemPrompt || [
    `You are ${name}, a proactive background agent running inside Stuard.`,
    '',
    `Description: ${description}`,
    '',
    `Objective: ${cleanedGoal}`,
    '',
    'Operating rules:',
    '- Check trigger context, agent memory, and relevant tools before acting.',
    '- Use granted tools to verify facts or complete actions before notifying the user.',
    '- Keep work tightly scoped to the objective.',
    '- Record durable findings or next steps in agent memory when useful.',
    '- Notify only for completed work, meaningful changes, risks, or decisions the user should see.',
  ].join('\n');
  const instructions = compactText(candidate.instructions) || 'At each wake-up, inspect the trigger payload and recent agent memory, use the allowed tools for the next useful step, update memory when relevant, and notify only when there is something worth the user seeing.';
  // Trust the model's interval choice. If the model didn't return a recognized
  // one, default to a safe middle value (30 minutes) instead of running a
  // keyword-driven heuristic against the user's goal text. The model can pick
  // "random"/"manual"/"10m"/"15m"/etc. directly when warranted.
  const interval = (BOT_BLUEPRINT_INTERVALS as readonly string[]).includes(String(candidate.interval || ''))
    ? candidate.interval
    : '30m';

  const toolRationale = Array.from(new Map(
    (Array.isArray(candidate.toolRationale) ? candidate.toolRationale : [])
      .map((entry: any) => ({
        tool: String(entry?.tool || '').trim(),
        reason: compactText(entry?.reason),
      }))
      .filter((entry: { tool: string; reason: string }) => allowedTools.includes(entry.tool) && entry.reason)
      .map((entry: { tool: string; reason: string }) => [entry.tool, entry] as const),
  ).values()).slice(0, 12);

  const clarifyingAnswers = Array.from(new Map<string, { question: string; answer: string }>(
    (Array.isArray(args.clarifyingAnswers) ? args.clarifyingAnswers : [])
      .map((entry) => ({
        question: compactText(entry?.question),
        answer: compactText(entry?.answer),
      }))
      .filter((entry) => entry.question && entry.answer)
      .map((entry) => [entry.question.toLowerCase(), entry] as const),
  ).values()).slice(0, 10);
  const answeredQuestionKeys = new Set(clarifyingAnswers.map((entry) => entry.question.toLowerCase()));
  const clarifyingQuestions = Array.from(new Set<string>([
    ...(Array.isArray(args.builderClarifyingQuestions) ? args.builderClarifyingQuestions : [])
      .map((question: any) => compactText(question))
      .filter(Boolean),
    ...(Array.isArray(candidate.clarifyingQuestions) ? candidate.clarifyingQuestions : [])
      .map((question: any) => compactText(question))
      .filter(Boolean),
  ])).filter((question) => !answeredQuestionKeys.has(question.toLowerCase())).slice(0, 5);
  const setupChecks = Array.from(new Set<string>(
    (Array.isArray(candidate.setupChecks) ? candidate.setupChecks : [])
      .map((check: any) => compactText(check))
      .filter(Boolean),
  )).slice(0, 6);

  const validProbeNames = new Set<string>(BOT_BLUEPRINT_PROBES);
  const coerceStep = (step: any, index: number): BotBlueprintPreflightStep | null => {
    const probe = String(step?.probe || '').trim();
    if (!validProbeNames.has(probe)) return null;
    const label = compactText(step?.label) || compactText(step?.id) || probe.replace(/_/g, ' ');
    const rationale = compactText(step?.rationale).slice(0, 280) || undefined;
    const id = compactText(step?.id) || `step-${index + 1}`;
    const argsValue = step?.args && typeof step.args === 'object' && !Array.isArray(step.args)
      ? step.args
      : undefined;
    return { id, probe: probe as BotBlueprintProbeName, label, rationale, args: argsValue };
  };
  const modelPreflight: BotBlueprintPreflightStep[] = (Array.isArray(candidate.preflightSteps) ? candidate.preflightSteps : [])
    .map(coerceStep)
    .filter((step: BotBlueprintPreflightStep | null): step is BotBlueprintPreflightStep => step !== null);
  const registeredPreflight: BotBlueprintPreflightStep[] = (Array.isArray(args.registeredPreflightSteps) ? args.registeredPreflightSteps : [])
    .map((step, index) => coerceStep(step, index))
    .filter((step): step is BotBlueprintPreflightStep => step !== null);
  const preflightSteps: BotBlueprintPreflightStep[] = [];
  const preflightSeen = new Set<string>();
  const pushPreflight = (step: BotBlueprintPreflightStep) => {
    const key = `${step.probe}:${JSON.stringify(step.args || {})}`;
    if (preflightSeen.has(key)) return;
    preflightSeen.add(key);
    preflightSteps.push(step);
  };
  for (const step of registeredPreflight) pushPreflight(step);
  for (const step of modelPreflight) pushPreflight(step);

  // A folder path the user/probe already verified. Used to backfill an fs.watch
  // trigger when the model picked the watch but forgot to copy the path across.
  const verifiedFolderPath = compactText(
    preflightSteps.find((step) => step.probe === 'folder_access' && compactText(step.args?.path))?.args?.path,
  );

  const validTriggerTypes = new Set<string>(BOT_BLUEPRINT_TRIGGER_TYPES);
  const coerceTrigger = (raw: any): BotBlueprintTrigger | null => {
    const type = String(raw?.type || '').trim();
    if (!validTriggerTypes.has(type)) return null;
    const argsValue = raw?.args && typeof raw.args === 'object' && !Array.isArray(raw.args)
      ? { ...raw.args }
      : {};
    // For a folder watch with no path, fall back to the verified one so the
    // trigger isn't dead on arrival. Desktop seeds remaining defaults on create.
    if (type === 'fs.watch' && !compactText(argsValue.path) && verifiedFolderPath) {
      argsValue.path = verifiedFolderPath;
    }
    const label = compactText(raw?.label).slice(0, 80) || undefined;
    const rationale = compactText(raw?.rationale).slice(0, 280) || undefined;
    return { type: type as BotBlueprintTriggerType, args: argsValue, label, rationale };
  };
  const triggers: BotBlueprintTrigger[] = [];
  const triggerSeen = new Set<string>();
  for (const raw of (Array.isArray(candidate.triggers) ? candidate.triggers : [])) {
    const trigger = coerceTrigger(raw);
    if (!trigger) continue;
    // v1 invariant mirrors the desktop: at most one schedule.interval trigger.
    const key = trigger.type === 'schedule.interval' ? 'schedule.interval' : `${trigger.type}:${JSON.stringify(trigger.args || {})}`;
    if (triggerSeen.has(key)) continue;
    triggerSeen.add(key);
    triggers.push(trigger);
  }
  // Always guarantee at least one trigger. If the model returned none (or only
  // unusable ones), synthesize the interval trigger so the agent still runs.
  if (triggers.length === 0) {
    triggers.push({ type: 'schedule.interval', args: { every: interval } });
  }

  return BotBlueprintResponseSchema.parse({
    name,
    emoji: compactText(candidate.emoji) || '🤖',
    description,
    systemPrompt,
    instructions,
    allowedTools,
    interval,
    toolRationale,
    clarifyingQuestions,
    clarifyingAnswers,
    setupChecks,
    preflightSteps: preflightSteps.slice(0, 8),
    triggers: triggers.slice(0, 5),
  });
}

export async function handleInferenceRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = String(parsedUrl.pathname || '');

  const corsOrigin = getCorsOrigin(req);

  // CORS preflight
  if (req.method === 'OPTIONS' && path.startsWith('/inference/')) {
    const headers: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    };
    if (corsOrigin) {
      headers['Access-Control-Allow-Origin'] = corsOrigin;
      headers['Vary'] = 'Origin';
    }
    res.writeHead(204, headers);
    res.end();
    return true;
  }

  if (req.method === 'POST' && path === '/inference/ai/bot-blueprint') {
    let sseStarted = false;
    const sseHeaders = (): Record<string, string | number> => {
      const h: Record<string, string | number> = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
        'X-Accel-Buffering': 'no',
      };
      if (corsOrigin) { h['Access-Control-Allow-Origin'] = corsOrigin; h['Vary'] = 'Origin'; }
      return h;
    };
    const send = (obj: any) => {
      try {
        if (!sseStarted) { res.writeHead(200, sseHeaders()); sseStarted = true; }
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
      } catch {}
    };
    const heartbeat = setInterval(() => {
      try { if (sseStarted && !res.writableEnded) res.write(`: ping ${Date.now()}\n\n`); } catch {}
    }, 15_000);
    // Abort only on real response-side disconnect, NOT on req's 'close' (which
    // can fire after the request body is fully consumed even if the client is
    // still listening for SSE events). res.on('close') before res.end() is the
    // reliable disconnect signal.
    const controller = new AbortController();
    let finished = false;
    const onResClose = () => { if (!finished) { try { controller.abort(); } catch {} } };
    try { res.on('close', onResClose); } catch {}
    const clarifyIdsToCleanup: string[] = [];
    const testRunIdsToCleanup: string[] = [];
    const verifiedProbeKeys = new Set<string>();
    const finish = () => {
      finished = true;
      try { clearInterval(heartbeat); } catch {}
      try { res.off('close', onResClose); } catch {}
      for (const id of clarifyIdsToCleanup) {
        const entry = pendingBlueprintClarifications.get(id);
        if (entry) {
          pendingBlueprintClarifications.delete(id);
          try { entry.resolve([]); } catch {}
        }
      }
      for (const id of testRunIdsToCleanup) {
        const entry = pendingBlueprintTestRuns.get(id);
        if (entry) {
          pendingBlueprintTestRuns.delete(id);
          try { entry.resolve({ status: 'warn', detail: 'Builder session closed before result returned.' }); } catch {}
        }
      }
      try { if (!res.writableEnded) res.end(); } catch {}
    };

    try {
      const { userId: blueprintUserId, isAuthed } = await validateAuth(req);
      if (!isAuthed) { send({ type: 'error', error: 'unauthorized' }); finish(); return true; }
      const creditErr = await requireCredits(blueprintUserId);
      if (creditErr) { send({ type: 'error', error: creditErr }); finish(); return true; }

      const body = await readJsonBody(req);
      const goal = compactText(body?.goal);
      const preferredName = compactText(body?.preferredName);
      const availableTools = normalizeAvailableToolNames(body?.availableTools);
      if (!goal) { send({ type: 'error', error: 'goal_required' }); finish(); return true; }

      ensurePendingBlueprintClarificationSweeper();
      const availableSet = new Set(availableTools);
      const discovered = new Map<string, { name: string; description: string; category: string }>();
      const builderClarifyingQuestions: string[] = [];
      const collectedClarifyingAnswers: Array<{ question: string; answer: string }> = [];
      const registeredPreflightSteps: BotBlueprintPreflightStep[] = [];
      const clarifySessionPrefix = `bp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      let clarifyCounter = 0;
      const hasAvailableFilter = availableSet.size > 0;
      const filterTool = (entry: any) => {
        const name = String(entry?.name || '').trim();
        if (isBlockedBotBlueprintTool(name)) return false;
        return !hasAvailableFilter || availableSet.has(name);
      };

      // Builder model: configurable so it's easy to swap when picks degrade.
      // Defaults to Gemini 3 Flash via OpenRouter — fast and strong enough for
      // the builder loop (agent_tool_search + agent_clarify_user + agent_test_run
      // + structured JSON output).
      const BOT_BLUEPRINT_MODEL_ID = String(process.env.BOT_BLUEPRINT_MODEL_ID || 'openrouter/google/gemini-3-flash-preview').trim();
      let model: any = buildProviderModel(BOT_BLUEPRINT_MODEL_ID);
      let modelId = BOT_BLUEPRINT_MODEL_ID;
      let prov: ReturnType<typeof pickModelProvider> | null = null;
      if (!model) {
        prov = pickModelProvider();
        model = prov.kind === 'openai' ? openai(prov.model) : google(prov.model);
        modelId = `${prov.kind}/${prov.model}`;
      }

      send({ type: 'start', goal, model: modelId, availableToolCount: availableTools.length });

      const semanticToolSearch = tool({
        description: 'Semantic search over the Stuard tool catalog. Use this to find real tool names for the agent, such as search, browser, email, calendar, GitHub, files, sheets, messaging, or social tools.',
        inputSchema: z.object({
          query: z.string().min(1).describe('Natural-language description of the capability needed.'),
          category: z.string().optional().describe('Optional tool category filter when known.'),
        }),
        execute: async ({ query, category }) => {
          send({ type: 'tool_search.start', query, category: category || null });
          const result = await (search_tools as any).execute({
            query,
            category,
          });
          const tools = (Array.isArray((result as any)?.tools) ? (result as any).tools : [])
            .filter(filterTool)
            .slice(0, 8)
            .map((entry: any) => ({
              name: String(entry?.name || ''),
              description: String(entry?.description || '').slice(0, 300),
              category: String(entry?.category || ''),
            }));
          for (const entry of tools) discovered.set(entry.name, entry);
          send({ type: 'tool_search.results', query, tools });
          return { tools };
        },
      });

      const clarifyUser = tool({
        description: 'Pause the agent-builder flow to ask the user concise blocking questions when missing details would make the agent unreliable, unsafe, or impossible to set up correctly. Use this for paths/folders, recipients, accounts, schedules/quiet hours, permissions, deployment target, or required sample inputs. The user will answer in the tool result; use those answers to refine the toolset, system prompt, and setup checks.',
        inputSchema: z.object({
          questions: z.array(z.string().min(1).max(220)).min(1).max(5)
            .describe('Concrete questions the user should answer before unattended launch.'),
          reason: z.string().max(300).optional()
            .describe('Short reason these answers matter.'),
          blocking: z.boolean().optional()
            .describe('True when launch should require review or an explicit first-run ask.'),
        }),
        execute: async ({ questions, reason, blocking }) => {
          const cleaned = Array.from(new Set(
            (Array.isArray(questions) ? questions : [])
              .map((question) => compactText(question))
              .filter(Boolean)
          )).slice(0, 5);
          const cleanReason = compactText(reason);
          for (const question of cleaned) {
            if (!builderClarifyingQuestions.includes(question)) builderClarifyingQuestions.push(question);
          }
          const clarifyId = `${clarifySessionPrefix}-${++clarifyCounter}`;
          clarifyIdsToCleanup.push(clarifyId);
          send({
            type: 'clarify_user',
            clarifyId,
            questions: cleaned,
            reason: cleanReason || null,
            blocking: blocking !== false,
          });
          const answers = await new Promise<Array<{ question: string; answer: string }>>((resolveAnswers) => {
            const expiresAt = Date.now() + 5 * 60_000;
            const entry: PendingBlueprintClarification = {
              resolve: (incoming) => {
                resolveAnswers(Array.isArray(incoming) ? incoming : []);
              },
              questions: cleaned,
              expiresAt,
            };
            pendingBlueprintClarifications.set(clarifyId, entry);
            const onAbort = () => {
              if (pendingBlueprintClarifications.get(clarifyId) === entry) {
                pendingBlueprintClarifications.delete(clarifyId);
                resolveAnswers([]);
              }
            };
            try { controller.signal.addEventListener('abort', onAbort, { once: true }); } catch {}
          });
          for (const item of answers) {
            const question = compactText(item?.question);
            const answer = compactText(item?.answer);
            if (!question || !answer) continue;
            const existing = collectedClarifyingAnswers.findIndex((e) => e.question.toLowerCase() === question.toLowerCase());
            if (existing >= 0) collectedClarifyingAnswers[existing] = { question, answer };
            else collectedClarifyingAnswers.push({ question, answer });
          }
          send({
            type: 'clarify_received',
            clarifyId,
            answers: answers.map((item) => ({
              question: compactText(item?.question),
              answer: compactText(item?.answer),
            })).filter((entry) => entry.question),
          });
          if (answers.length === 0) {
            return {
              ok: true,
              skipped: true,
              note: 'The user did not answer these questions. Defer them to the agent runtime via clarifyingQuestions in the final blueprint.',
              questions: cleaned,
            };
          }
          return {
            ok: true,
            answered: true,
            answers: answers.map((item) => ({
              question: compactText(item?.question),
              answer: compactText(item?.answer),
            })).filter((entry) => entry.question && entry.answer),
            note: 'Incorporate these answers when choosing tools, writing the system prompt, and listing setup checks. Drop any clarifyingQuestions the user already answered.',
          };
        },
      });

      const availableToolsBrief = availableTools.length > 0
        ? `The desktop says these non-internal tools may be added to agents. Choose only from this set after semantic search confirms relevance:\n${availableTools.slice(0, 260).join(', ')}`
        : 'No desktop allow-list was supplied; choose only real tools returned by semantic search.';

      const schemaExample = {
        name: 'string',
        emoji: 'short emoji',
        description: 'one sentence',
        systemPrompt: 'multi-paragraph agent identity, objective, scope, operating rules, and success criteria',
        instructions: '2-4 concrete run instructions',
        allowedTools: ['tool_name'],
        interval: '10m | 15m | 30m | 1h | 2h | random | manual',
        triggers: [
          { type: 'fs.watch', args: { path: 'C:/verified/folder', pattern: '**/*.mp4' }, rationale: 'why this trigger fits the run' },
        ],
        toolRationale: [{ tool: 'tool_name', reason: 'why it belongs' }],
        clarifyingQuestions: ['only important missing details the user did NOT answer during setup'],
        setupChecks: ['short human-readable reminders, only when no preflightSteps probe covers it'],
      };

      const prompt = [
        'Create a ready-to-run proactive agent blueprint for Stuard. Your job is to make sure the agent will actually work in production, not just look correct on paper.',
        '',
        'Before searching for anything, think step by step through the agent\'s ENTIRE run, end to end, and do not leave any part out: (1) WHAT WAKES IT — the event or schedule that should start a run; (2) OBSERVE — what it reads or fetches first; (3) PROCESS — how it transforms, analyzes, or decides; (4) ACT — the external action it takes (send, post, write, create); (5) NOTIFY — what, if anything, the user is told. Map each stage to a concrete tool or trigger. If any stage has no tool, search for one or ask the user. A blueprint that covers wake + observe but skips process/act/notify is incomplete and unacceptable.',
        '',
        'You have three builder-only tools: agent_tool_search, agent_clarify_user, and agent_test_run.',
        'Use agent_tool_search to discover real tool names before choosing allowedTools. Search separately for observation/research tools and for action/integration tools when relevant. Do not invent tool names.',
        'Use agent_clarify_user the moment a missing detail would make the agent unreliable (folder/path to watch, recipient, account, quiet hours, permissions). The tool result returns the user\'s real answers (or skipped:true). Drop any clarifyingQuestions the user answers; only leave items in the final clarifyingQuestions field that the user did NOT answer.',
        'Use agent_test_run SPARINGLY — you have a hard budget of 6 probes total. After 6 calls the tool refuses. Spend your budget on the highest-risk assumptions only: the OAuth account (one probe), the user-provided folder path (one probe), the critical binary (ffmpeg/git/python — one probe), and the 1-2 most important action tools. Do NOT probe every tool in allowedTools. Read each pass/fail/warn result and ADAPT: if a probe fails, swap to a different tool, ask a clarifying question, or document the fallback path in systemPrompt. If a probe passes, fold the verified fact into systemPrompt (e.g., "Recording folder verified at <path>"). Successful probes are recorded as preflightSteps that re-run before each launch. Once you have your critical probes back, STOP probing and emit the final JSON blueprint.',
        'The final systemPrompt MUST reflect what you verified: list the verified resources, accounts, and paths; spell out what to do on first-run if something was not verifiable; and tell the agent how to recover if a runtime tool call fails (retry, notify the user, skip and continue).',
        'Decompose the request into every required capability. Do not stop after finding only one tool for a multi-step path. When the user describes content arriving from somewhere outside Stuard (their phone, a co-worker, a webhook, a folder synced by another app), pick tools that READ what exists; do not pick tools that have the agent itself capture, record, or scrape unless the user explicitly asks Stuard to do that. When in doubt, ask via agent_clarify_user.',
        'Do not include internal agent plumbing tools in allowedTools: search_tools, get_tool_schema, execute_tool, get_skill_info, choose_notification_channel, write_session_summary, search_past_conversations, get_conversation_context, proactive_task_*, bot_memory_*.',
        'The agent will always have internal memory, kanban, notification-channel, and tool-discovery tools. allowedTools should contain only extra non-internal tools the agent truly needs.',
        '',
        availableToolsBrief,
        '',
        `User goal: ${goal}`,
        preferredName ? `Preferred name: ${preferredName}` : '',
        '',
        'Return only a valid JSON object matching this shape:',
        JSON.stringify(schemaExample),
        '',
        'Write the systemPrompt as the durable agent identity and description. It should be specific enough that the agent knows what to watch, what to do, which boundaries to keep, and when to notify.',
        '',
        'TRIGGERS — decide WHAT WAKES the agent from stage (1) and put it in the triggers array. Choose the trigger that matches how work actually arrives; do not default to a timer when something more precise fits:',
        '- fs.watch: a file/folder changes. args: { path (use the folder you verified), pattern (glob like "**/*.mp4"), events (["add","change"]) }. Best when the user drops/records files into a folder.',
        '- schedule.cron: a specific calendar time. args: { expr } (5-field cron, e.g. "0 9 * * 2" = Tue 9am). Best for "every Tuesday 9am", "weekdays at noon".',
        '- schedule.interval: poll on a fixed cadence. args: { every: one of 10m/15m/30m/1h/2h/random }. Best for "check periodically"; use "random" for "random day / at-least-weekly".',
        '- webhook: an external system POSTs a URL. args: {} (the desktop generates the URL). Best for "when Zapier/my script/another app fires".',
        '- command.watch: a long-running script emits output. args: { cmd, args:[...] }. Best for custom watchers.',
        '- x.new_comment: someone replies to the user\'s post on X (Twitter). args (all optional): { post_id (limit to one post/thread), from_username, contains_text }. THIS is the right trigger for "reply to comments on my posts" / engagement bots — not a timer.',
        '- x.new_mention: someone @-mentions the user on X. args: {}.',
        '- x.new_dm: a new X direct message. args: {}.',
        '- x.new_follower: the user gains a new follower on X. args: {}.',
        '- x.user_post: the user publishes a new post on X. args: {}.',
        'X triggers are event-driven (the X webhook wakes the agent the instant the event arrives — no polling) and require the user\'s X account to be connected in Settings > Integrations. When you pick an X trigger, add a setupCheck reminding the user to connect their X account so events can flow.',
        '- manual: only when the user presses Run. args: {}. Use only for on-demand agents.',
        'Pick the smallest set of triggers that covers the real wake conditions (usually one). ANY trigger firing wakes the agent. If unsure which wake condition the user wants, ask via agent_clarify_user rather than guessing a timer. Always set "interval" too (it is the fallback cadence), but the triggers array is what actually gets wired up.',
      ].filter(Boolean).join('\n');

      send({ type: 'phase', phase: 'generate' });

      // Gemini 3.x defaults thinkingLevel to 'high', which makes a structured
      // blueprint task take 30–60s+. 'low' keeps quality fine here and cuts
      // latency dramatically. Only applies when the chosen provider is Google.
      const googleProviderOptions = prov?.kind === 'google'
        ? { google: { thinkingConfig: { thinkingLevel: 'low' as const } } }
        : undefined;

      let testRunCounter = 0;
      // Cap probes so the model can't loop indefinitely. ~6 covers the common
      // multi-tool agent (1 OAuth + 1 folder + 2-3 tools + 1 binary). Past that,
      // the tool returns a budget-exhausted result that pushes the model to
      // finalize the blueprint instead of probing more.
      const MAX_TEST_RUNS = 6;
      const testRunTool = tool({
        description: 'Run a single probe on the user\'s desktop right now to verify the agent will work in production. Probes are budgeted — you have AT MOST 6 calls total. Spend them on the highest-risk assumptions only (one OAuth account, one folder path, the critical binary, the destination action tool). Don\'t probe every tool you allow. After each result, fold what you learned into systemPrompt and clarifyingQuestions, then FINALIZE the blueprint JSON instead of probing more.',
        inputSchema: z.object({
          probe: z.enum(BOT_BLUEPRINT_PROBES).describe('Which probe to run. tool_available checks the desktop tool registry. binary_available shells out to a CLI binary like ffmpeg/git/python. folder_access checks a filesystem path. oauth_connected checks a third-party account (args.provider: google/microsoft/github/slack/...). capture_devices_available enumerates cameras/mics/screens. dry_run_tool invokes a real tool with safe sample args.'),
          label: z.string().min(1).max(120).describe('Short human-readable label, e.g. "FFmpeg installed", "Recording folder readable".'),
          args: z.record(z.string(), z.any()).optional().describe('Probe arguments. e.g. { tool: "gmail_send_message" } or { path: "C:/Users/me/Recordings" } or { provider: "google" } or { binary: "ffmpeg" }.'),
          rationale: z.string().max(280).optional().describe('Why this probe matters for this agent.'),
        }),
        execute: async ({ probe, label, args, rationale }) => {
          testRunCounter += 1;
          const argsValue = args && typeof args === 'object' && !Array.isArray(args) ? args : undefined;
          const labelClean = compactText(label) || probe.replace(/_/g, ' ');
          // If the model validates a concrete tool via a probe (e.g. tool_available
          // or dry_run_tool on gmail_send_message), treat that as discovery too.
          // Otherwise a tool the model probed but never ran through agent_tool_search
          // would be dropped by the discovered-gated fallback later on.
          const probedToolName = typeof (argsValue as any)?.tool === 'string'
            ? String((argsValue as any).tool).trim()
            : '';
          if (probedToolName && !discovered.has(probedToolName) && filterTool({ name: probedToolName })) {
            discovered.set(probedToolName, { name: probedToolName, description: '', category: '' });
          }
          if (testRunCounter > MAX_TEST_RUNS) {
            return {
              ok: false,
              status: 'unsupported' as BlueprintTestRunStatus,
              detail: `Probe budget exhausted (${MAX_TEST_RUNS} probes already run). Stop probing and produce the final blueprint JSON now.`,
              note: `You have already run ${MAX_TEST_RUNS} probes. Do NOT call agent_test_run again. Finalize the blueprint JSON immediately using what you already verified.`,
              budgetExhausted: true,
            };
          }
          const runId = `${clarifySessionPrefix}-tr-${testRunCounter}`;
          testRunIdsToCleanup.push(runId);
          const rationaleClean = compactText(rationale).slice(0, 280) || undefined;
          send({
            type: 'test_run.start',
            runId,
            probe,
            label: labelClean,
            rationale: rationaleClean || null,
            args: argsValue || null,
            index: testRunCounter,
            budget: MAX_TEST_RUNS,
          });
          const result = await new Promise<BlueprintTestRunResult>((resolveResult) => {
            const entry: PendingBlueprintTestRun = {
              resolve: (incoming) => resolveResult(incoming),
              probe,
              args: argsValue,
              label: labelClean,
              expiresAt: Date.now() + 60_000,
            };
            pendingBlueprintTestRuns.set(runId, entry);
            const onAbort = () => {
              if (pendingBlueprintTestRuns.get(runId) === entry) {
                pendingBlueprintTestRuns.delete(runId);
                resolveResult({ status: 'warn', detail: 'Probe canceled before the desktop responded.' });
              }
            };
            try { controller.signal.addEventListener('abort', onAbort, { once: true }); } catch {}
          });
          send({
            type: 'test_run.result',
            runId,
            probe,
            status: result.status,
            detail: result.detail || null,
            index: testRunCounter,
            budget: MAX_TEST_RUNS,
          });
          if (result.status === 'pass' || result.status === 'warn') {
            const step: BotBlueprintPreflightStep = {
              id: `tr-${testRunCounter}-${probe}`,
              probe: probe as BotBlueprintProbeName,
              label: labelClean,
              rationale: rationaleClean,
              args: argsValue,
            };
            const key = `${step.probe}:${JSON.stringify(step.args || {})}`;
            if (!verifiedProbeKeys.has(key)) {
              verifiedProbeKeys.add(key);
              registeredPreflightSteps.push(step);
            }
          }
          return {
            ok: true,
            status: result.status,
            detail: result.detail || '',
            note: result.status === 'pass'
              ? 'Probe passed. Record this in systemPrompt so the agent knows the dependency is verified.'
              : result.status === 'fail'
                ? 'Probe failed. Either pick a different tool, add a clarifyingQuestion to recover the missing input, or document the fallback in systemPrompt.'
                : result.status === 'unsupported'
                  ? 'Probe not supported on this build of the desktop. Treat as unverified.'
                  : 'Probe could not confirm pass/fail. Treat as unverified and address in systemPrompt or clarifyingQuestions.',
          };
        },
      });

      const stream = streamText({
        model: model as any,
        tools: {
          agent_tool_search: semanticToolSearch,
          agent_clarify_user: clarifyUser,
          agent_test_run: testRunTool,
        },
        stopWhen: stepCountIs(12),
        prompt,
        temperature: 0.2,
        abortSignal: controller.signal,
        ...(googleProviderOptions ? { providerOptions: googleProviderOptions } : {}),
        onStepFinish: (step: any) => {
          try {
            const toolCalls = Array.isArray(step?.toolCalls)
              ? step.toolCalls.map((c: any) => ({ tool: String(c?.toolName || ''), input: c?.input ?? c?.args ?? null }))
              : [];
            const textPreview = typeof step?.text === 'string' ? step.text.slice(0, 280) : '';
            send({
              type: 'step',
              finishReason: step?.finishReason ?? null,
              toolCalls,
              textPreview,
            });
          } catch {}
        },
      });

      // Drain the full stream to drive tool calls + onStepFinish to completion.
      // Awaiting `.text` alone isn't sufficient with a tools loop in AI SDK v6.
      await stream.consumeStream();
      const fullText = await stream.text;
      let usage: any = undefined;
      try { usage = await stream.totalUsage; } catch { try { usage = await stream.usage; } catch {} }
      await logInferenceUsage(blueprintUserId, modelId, usage, 'Agent Blueprint Generator');

      let parsed = parseJsonObjectFromText(fullText);
      if (!parsed) {
        send({ type: 'phase', phase: 'repair' });
        const repair = await generateText({
          model: model as any,
          prompt: [
            'Repair this model output into only a valid JSON object for a Stuard agent blueprint.',
            'Do not add tools that are not present in the original output.',
            `Schema shape: ${JSON.stringify(schemaExample)}`,
            '',
            fullText,
          ].join('\n'),
          temperature: 0,
          abortSignal: controller.signal,
          ...(googleProviderOptions ? { providerOptions: googleProviderOptions } : {}),
        });
        await logInferenceUsage(blueprintUserId, modelId, repair.usage, 'Agent Blueprint JSON Repair');
        parsed = parseJsonObjectFromText(repair.text);
      }

      if (!parsed) { send({ type: 'error', error: 'invalid_blueprint_json' }); finish(); return true; }

      if (discovered.size === 0) {
        try {
          send({ type: 'tool_search.start', query: goal, category: null, fallback: true });
          const result = await (search_tools as any).execute({ query: goal });
          for (const entry of (Array.isArray((result as any)?.tools) ? (result as any).tools : []).filter(filterTool)) {
            const toolEntry = {
              name: String(entry?.name || ''),
              description: String(entry?.description || '').slice(0, 300),
              category: String(entry?.category || ''),
            };
            if (toolEntry.name) discovered.set(toolEntry.name, toolEntry);
          }
          send({ type: 'tool_search.results', query: goal, tools: Array.from(discovered.values()), fallback: true });
        } catch {}
      }

      const blueprint = sanitizeBotBlueprint(parsed, {
        goal,
        preferredName,
        availableTools,
        discoveredTools: Array.from(discovered.values()),
        builderClarifyingQuestions,
        clarifyingAnswers: collectedClarifyingAnswers,
        registeredPreflightSteps,
      });

      send({
        type: 'blueprint',
        blueprint,
        discoveredTools: Array.from(discovered.values()).slice(0, 30),
      });
      send({ type: 'done' });
      finish();
      return true;
    } catch (e: any) {
      const summary = summarizeModelError(e);
      console.error(`[inference] bot-blueprint error: ${summary}`);
      try { send({ type: 'error', error: e?.message || 'bot_blueprint_failed', detail: summary }); } catch {}
      finish();
      return true;
    }
  }

  if (req.method === 'POST' && path === '/inference/ai/bot-blueprint/test-run-result') {
    const { isAuthed } = await validateAuth(req);
    if (!isAuthed) { writeJson(res, 401, { ok: false, error: 'unauthorized' }, corsOrigin); return true; }
    const body = await readJsonBody(req);
    const runId = compactText(body?.runId);
    const status = compactText(body?.status);
    const detail = compactText(body?.detail).slice(0, 400);
    if (!runId) { writeJson(res, 400, { ok: false, error: 'run_id_required' }, corsOrigin); return true; }
    const validStatuses: BlueprintTestRunStatus[] = ['pass', 'fail', 'warn', 'unsupported'];
    const normalizedStatus = (validStatuses.includes(status as BlueprintTestRunStatus) ? status : 'warn') as BlueprintTestRunStatus;
    const entry = pendingBlueprintTestRuns.get(runId);
    if (!entry) { writeJson(res, 404, { ok: false, error: 'test_run_expired_or_unknown' }, corsOrigin); return true; }
    pendingBlueprintTestRuns.delete(runId);
    try { entry.resolve({ status: normalizedStatus, detail }); } catch {}
    writeJson(res, 200, { ok: true }, corsOrigin);
    return true;
  }

  if (req.method === 'POST' && path === '/inference/ai/bot-blueprint/clarify') {
    const { isAuthed } = await validateAuth(req);
    if (!isAuthed) { writeJson(res, 401, { ok: false, error: 'unauthorized' }, corsOrigin); return true; }
    const body = await readJsonBody(req);
    const clarifyId = compactText(body?.clarifyId);
    const rawAnswers = Array.isArray(body?.answers) ? body.answers : [];
    if (!clarifyId) { writeJson(res, 400, { ok: false, error: 'clarify_id_required' }, corsOrigin); return true; }
    const entry = pendingBlueprintClarifications.get(clarifyId);
    if (!entry) { writeJson(res, 404, { ok: false, error: 'clarify_expired_or_unknown' }, corsOrigin); return true; }
    pendingBlueprintClarifications.delete(clarifyId);
    const known = entry.questions.map((q) => q.toLowerCase());
    const answers = rawAnswers
      .map((item: any) => ({
        question: compactText(item?.question),
        answer: compactText(item?.answer),
      }))
      .filter((item: { question: string; answer: string }) => item.question && item.answer)
      .filter((item: { question: string; answer: string }) =>
        known.length === 0 || known.includes(item.question.toLowerCase()),
      )
      .slice(0, 5);
    try { entry.resolve(answers); } catch {}
    writeJson(res, 200, { ok: true, accepted: answers.length }, corsOrigin);
    return true;
  }

  if (req.method === 'POST' && path === '/inference/workflow/next') {
    try {
      // Workflow routing - requires Supabase auth in production
      const { userId, isAuthed } = await validateAuth(req);
      if (!isAuthed) {
        writeJson(res, 401, { ok: false, error: 'unauthorized' }, corsOrigin);
        return true;
      }
      const creditErr = await requireCredits(userId);
      if (creditErr) {
        writeJson(res, 403, { ok: false, error: creditErr }, corsOrigin);
        return true;
      }
      const body = await readJsonBody(req);
      const ctx = body?.context || {};
      const step = ctx.step || {};
      const options = Array.isArray(ctx.options) ? ctx.options : [];
      const instruction = typeof ctx.instruction === 'string' ? ctx.instruction : '';
      const produceArgs = !!ctx.produceArgs;
      const state = ctx.ctx || {};

      if (!options.length) {
        writeJson(res, 400, { ok: false, error: 'no_options' }, corsOrigin);
        return true;
      }

      const prov = pickModelProvider();
      const schema = z.object({
        next: z.string(),
        argsPatch: z.record(z.string(), z.any()).optional(),
        reason: z.string().optional(),
      });

      const limited = (s: any) => {
        try { const t = typeof s === 'string' ? s : JSON.stringify(s); return t.length > 8000 ? t.slice(0, 8000) : t; } catch { return ''; }
      };

      const optionsBrief = options.map((o: any) => ({ to: String(o?.to || ''), label: String(o?.label || '') }));
      const prompt = [
        'You are a routing function for a workflow engine. Choose the best next step from the provided options.',
        'Return strict JSON { "next": string, "argsPatch"?: object }.',
        'If you cannot determine, choose the first option.',
        instruction ? `Instruction: ${instruction}` : '',
        `Step: ${limited(step?.id || step?.name || 'current')}`,
        `Options: ${limited(JSON.stringify(optionsBrief))}`,
        `State excerpt: ${limited(state)}`,
      ].filter(Boolean).join('\n');

      let result: { next: string; argsPatch?: any } | null = null;
      try {
        const model = prov.kind === 'openai' ? openai(prov.model) : google(prov.model);
        const modelId = `${prov.kind}/${prov.model}`;
        const out = await generateText({
          model: model as any,
          prompt: `${prompt}\n\nRespond with a valid JSON object matching this schema: ${JSON.stringify(schema.shape)}`,
          temperature: 0.2
        });
        await logInferenceUsage(userId, modelId, out.usage, 'Workflow Router');
        const obj = JSON.parse(out.text) as any;
        if (obj && typeof obj.next === 'string') result = { next: obj.next, argsPatch: obj.argsPatch };
      } catch {}

      if (!result) {
        writeJson(res, 400, { ok: false, error: 'no_routing_decision' }, corsOrigin);
      } else {
        writeJson(res, 200, { ok: true, ...result }, corsOrigin);
      }
      return true;
    } catch (e: any) {
      writeJson(res, 500, { ok: false, error: e?.message || 'failed' }, corsOrigin);
      return true;
    }
  }

  if (req.method === 'POST' && path === '/inference/ai/embed_many') {
    try {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const authed = token ? await verifyToken(token) : null;
      const embUserId = authed?.userId || null;
      if (!authed) {
        writeJson(res, 401, { ok: false, error: 'unauthorized' }, corsOrigin);
        return true;
      }
      const body = await readJsonBody(req);
      const texts = Array.isArray(body?.texts) ? body.texts : [];
      const modelId = String(body?.model || 'google/gemini-embedding-2-preview').trim() || 'google/gemini-embedding-2-preview';

      const values = texts
        .map((t: any) => String(t || '').trim())
        .filter(Boolean)
        .map((t: string) => t.slice(0, 12000));

      if (values.length === 0) {
        writeJson(res, 400, { ok: false, error: 'missing_texts' }, corsOrigin);
        return true;
      }

      const embModel = buildProviderEmbeddingModel(modelId);
      if (!embModel) {
        writeJson(res, 400, { ok: false, error: `unknown_embedding_model: ${modelId}` }, corsOrigin);
        return true;
      }

      const out = await embedMany({
        model: embModel,
        values,
      });

      await logInferenceUsage(embUserId, modelId, out.usage, 'Embedding (batch)', {
        sourceType: 'embedding',
        billingExcluded: true,
      });
      writeJson(res, 200, { ok: true, embeddings: out.embeddings, model: modelId }, corsOrigin);
      return true;
    } catch (e: any) {
      console.error('[inference] ai/embed_many error:', e);
      writeJson(res, 500, { ok: false, error: e?.message || 'embed_many_failed' }, corsOrigin);
      return true;
    }
  }

  // Workflow agent endpoints removed - workflow editing handled by stuard agent with workflow tools

  // Analyze media (audio, video, images) - used by workflow engine
  if (req.method === 'POST' && path === '/inference/ai/analyze-media') {
    try {
      // Media analysis - requires Supabase auth in production
      const { userId: mediaUserId, isAuthed } = await validateAuth(req);
      if (!isAuthed) {
        writeJson(res, 401, { ok: false, error: 'unauthorized' }, corsOrigin);
        return true;
      }
      const creditErr = await requireCredits(mediaUserId);
      if (creditErr) {
        writeJson(res, 403, { ok: false, error: creditErr }, corsOrigin);
        return true;
      }
      const body = await readJsonBody(req);
      const task = String(body?.task || 'Analyze this media and provide a summary.');
      const media = Array.isArray(body?.media) ? body.media : [];
      const requestedModel = String(body?.model || '').trim();
      const callerLabel = typeof body?.source_label === 'string' ? body.source_label.trim() : '';
      
      if (media.length === 0) {
        writeJson(res, 400, { ok: false, error: 'no_media_provided' }, corsOrigin);
        return true;
      }
      
      try {
        // Resolve the AI model: honour custom model from the request, fall back to defaults
        let model: any;
        let mediaModelId: string;
        if (requestedModel && requestedModel !== 'fast') {
          // Normalise bare model names (e.g. "gemini-3-flash-preview") to provider-prefixed IDs
          const fullId = requestedModel.includes('/') ? requestedModel : `google/${requestedModel}`;
          const customModel = buildProviderModel(fullId);
          if (customModel) {
            model = customModel;
            mediaModelId = fullId;
          } else {
            model = google('gemini-3.1-flash-lite');
            mediaModelId = 'google/gemini-3.1-flash-lite';
          }
        } else {
          model = google('gemini-3.1-flash-lite');
          mediaModelId = 'google/gemini-3.1-flash-lite';
        }

        const contentParts: any[] = [{ type: 'text', text: task }];

        for (const m of media) {
          const data = String(m?.data || '');
          const mediaType = String(m?.mimeType || 'application/octet-stream');
          if (!data) continue;

          contentParts.push({
            type: 'file',
            data,
            mediaType: mediaType,
          });
        }

        const isProModel = mediaModelId.includes('pro');
        const out = await generateText({
          model: model as any,
          messages: [{ role: 'user' as const, content: contentParts }],
          temperature: 0.2,
          ...(isProModel && {
            providerOptions: {
              google: { thinkingConfig: { thinkingBudget: 8192 } },
            },
          }),
        });
        await logInferenceUsage(mediaUserId, mediaModelId, out.usage, callerLabel || 'Analyze Media');

        const summary = out.text?.trim() || '';
        writeJson(res, 200, { ok: true, summary, text: summary }, corsOrigin);
        return true;
      } catch (e: any) {
        console.error('[inference] analyze-media error:', e);
        writeJson(res, 500, { ok: false, error: e?.message || 'ai_failed' }, corsOrigin);
        return true;
      }
    } catch (e: any) {
      writeJson(res, 500, { ok: false, error: e?.message || 'failed' }, corsOrigin);
      return true;
    }
  }

  if (req.method === 'POST' && path === '/inference/ai/vision-structured') {
    try {
      // Vision inference consumes provider credits; require auth in production.
      const { userId: visionUserId, isAuthed } = await validateAuth(req);
      if (!isAuthed) {
        writeJson(res, 401, { ok: false, error: 'unauthorized' }, corsOrigin);
        return true;
      }
      const creditErr = await requireCredits(visionUserId);
      if (creditErr) {
        writeJson(res, 403, { ok: false, error: creditErr }, corsOrigin);
        return true;
      }

      const body = await readJsonBody(req);
      const shapeField = z.object({
        type: z.enum(['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]']),
      });
      const shapeSchema = z.object({
        type: z.literal('object'),
        properties: z.record(z.string(), shapeField),
      });
      const inputSchema = z.object({
        prompt: z.string().min(1),
        imageB64: z.string().min(16),
        mimeType: z.string().optional(),
        schema: shapeSchema,
      });

      const parsed = inputSchema.safeParse(body || {});
      if (!parsed.success) {
        writeJson(res, 400, { ok: false, error: 'invalid_body', details: parsed.error.flatten() }, corsOrigin);
        return true;
      }

      const { prompt, imageB64, mimeType, schema } = parsed.data;
      const visionCallerLabel = typeof (body as any)?.source_label === 'string' ? (body as any).source_label.trim() : '';

      const prov = pickModelProvider();

      const buildZodObject = (shape: z.infer<typeof shapeSchema>) => {
        const entries: Record<string, any> = {};
        for (const [k, spec] of Object.entries(shape.properties || {})) {
          let base: any;
          switch ((spec as any).type) {
            case 'string': base = z.string(); break;
            case 'number': base = z.number(); break;
            case 'boolean': base = z.boolean(); break;
            case 'string[]': base = z.array(z.string()); break;
            case 'number[]': base = z.array(z.number()); break;
            case 'boolean[]': base = z.array(z.boolean()); break;
            default: base = z.any(); break;
          }
          entries[k] = base;
        }
        return z.object(entries);
      };

      const objSchema = buildZodObject(schema);

      const parts: any[] = [
        { type: 'text', text: prompt },
        { type: 'image', image: imageB64, mimeType: mimeType || 'image/jpeg' },
      ];

      const messages = [{ role: 'user' as const, content: parts }];

      let object: any = null;
      try {
        const model = prov.kind === 'openai' ? openai(prov.model) : google(prov.model);
        const visionModelId = `${prov.kind}/${prov.model}`;
        const textPrompt = `${prompt}\n\nRespond with a valid JSON object matching this schema: ${JSON.stringify(objSchema.shape)}`;
        const out = await generateText({ model: model as any, messages: [{ role: 'user', content: textPrompt }], temperature: 0.2 });
        await logInferenceUsage(visionUserId, visionModelId, out.usage, visionCallerLabel || 'Vision Structured');
        object = JSON.parse(out.text);
      } catch {}

      if (!object || typeof object !== 'object') {
        writeJson(res, 400, { ok: false, error: 'ai_failed' }, corsOrigin);
        return true;
      }

      writeJson(res, 200, { ok: true, object }, corsOrigin);
      return true;
    } catch (e: any) {
      writeJson(res, 500, { ok: false, error: e?.message || 'failed' }, corsOrigin);
      return true;
    }
  }

  // Launcher suggestion chips — free for users (billing excluded), gemini-3.1-flash-lite
  if (req.method === 'POST' && path === '/inference/ai/launcher-suggestions') {
    try {
      const { userId, isAuthed } = await validateAuth(req);
      if (!isAuthed) {
        writeJson(res, 401, { ok: false, error: 'unauthorized' }, corsOrigin);
        return true;
      }

      const body = await readJsonBody(req);
      const prompt = String(body?.prompt || '').trim();
      const memories: string[] = Array.isArray(body?.memories)
        ? body.memories.map((m: unknown) => String(m || '').trim()).filter(Boolean).slice(0, 12)
        : [];
      const name = body?.name ? String(body.name).trim() : '';
      const suggestionCount = Math.min(6, Math.max(3, Number(body?.count) || 4));

      if (!prompt && memories.length === 0 && !name) {
        writeJson(res, 400, { ok: false, error: 'prompt_or_context_required' }, corsOrigin);
        return true;
      }

      const cacheKey = createLauncherSuggestionsServerCacheKey({
        userId,
        prompt,
        name,
        memories,
        count: suggestionCount,
      });
      const cached = getCachedLauncherSuggestions(cacheKey);
      if (cached) {
        writeJson(res, 200, {
          ok: true,
          suggestions: cached.suggestions,
          text: cached.text,
          model: LAUNCHER_SUGGESTIONS_MODEL_ID,
          cached: true,
          expiresAt: cached.expiresAt,
        }, corsOrigin);
        return true;
      }

      const modelId = LAUNCHER_SUGGESTIONS_MODEL_ID;
      const model = google('gemini-3.1-flash-lite');

      const userPrompt = prompt || [
        'You write launcher suggestion chips for a desktop AI assistant.',
        'Each chip must be a natural first message the user would send — a question or request.',
        '',
        'Rules:',
        `- Return exactly ${suggestionCount} suggestions`,
        '- Max 10 words each',
        '- Make them diverse: each chip should draw from a different memory theme when possible (preference, project, workflow, recent activity)',
        '- Do NOT start with "Help me with"',
        '- Do NOT copy memory titles verbatim — infer the next useful action',
        '- Vary the tone: one reflective, one action-oriented, one exploratory when you can',
        '',
        name ? `User name: ${name}` : 'User name: unknown',
        '',
        'Memory notes (typed — use the variety, not just the first lines):',
        ...(memories.length ? memories.map((m) => `- ${m}`) : ['- (none yet)']),
        '',
        `Return ONLY a JSON array of ${suggestionCount} strings. No markdown.`,
      ].join('\n');

      let pending = launcherSuggestionsInFlight.get(cacheKey);
      if (!pending) {
        pending = (async () => {
          const result = await generateText({
            model: model as any,
            messages: [{ role: 'user', content: userPrompt }],
            temperature: 0.7,
          });

          await logInferenceUsage(userId, modelId, result.usage, 'Launcher suggestions', {
            billingExcluded: true,
          });

          const text = result.text?.trim() || '';
          const suggestions = parseLauncherSuggestionsText(text, suggestionCount);
          return { suggestions, text };
        })();
        launcherSuggestionsInFlight.set(cacheKey, pending);
      }

      let generated: LauncherSuggestionsResult;
      try {
        generated = await pending;
      } finally {
        launcherSuggestionsInFlight.delete(cacheKey);
      }

      const fresh = cacheLauncherSuggestionsResult(cacheKey, generated);

      writeJson(res, 200, {
        ok: true,
        suggestions: fresh.suggestions,
        text: fresh.text,
        model: modelId,
        cached: false,
        expiresAt: fresh.expiresAt,
      }, corsOrigin);
      return true;
    } catch (e: any) {
      console.error('[inference] launcher-suggestions error:', e);
      writeJson(res, 500, { ok: false, error: e?.message || 'launcher_suggestions_failed' }, corsOrigin);
      return true;
    }
  }

  // AI Text Inference - text in, text or JSON out
  if (req.method === 'POST' && path === '/inference/ai/text') {
    try {
      // Text inference - requires Supabase auth in production
      const { userId: textUserId, isAuthed } = await validateAuth(req);
      if (!isAuthed) {
        writeJson(res, 401, { ok: false, error: 'unauthorized' }, corsOrigin);
        return true;
      }
      const body = await readJsonBody(req);
      const prompt = String(body?.prompt || '');
      const input = body?.input ? String(body.input) : undefined;
      const mode = body?.mode === 'json' ? 'json' : body?.mode === 'embedding' ? 'embedding' : 'text';
      const schema = body?.schema as Record<string, any> | undefined;
      const modelChoice = body?.model === 'quality' ? 'quality' : 'fast';
      const temperature = typeof body?.temperature === 'number' ? body.temperature : 0.3;
      const systemPrompt = body?.systemPrompt ? String(body.systemPrompt) : undefined;
      const textCallerLabel = typeof body?.source_label === 'string' ? body.source_label.trim() : '';

      if (!prompt) {
        writeJson(res, 400, { ok: false, error: 'prompt_required' }, corsOrigin);
        return true;
      }

      if (mode !== 'embedding') {
        const creditErr = await requireCredits(textUserId);
        if (creditErr) {
          writeJson(res, 403, { ok: false, error: creditErr }, corsOrigin);
          return true;
        }
      }

      if (mode === 'embedding') {
        const embeddingModelId = body?.model || 'google/gemini-embedding-2-preview';
        const aiEmbeddingModel = buildProviderEmbeddingModel(embeddingModelId);
        
        if (!aiEmbeddingModel) {
          writeJson(res, 400, { ok: false, error: `Failed to initialize embedding model: ${embeddingModelId}` }, corsOrigin);
          return true;
        }

        const textToEmbed = input ? `${prompt}\n${input}` : prompt;

        try {
          const embResult = await embed({
            model: aiEmbeddingModel,
            value: textToEmbed,
          });
          await logInferenceUsage(textUserId, embeddingModelId, embResult.usage, textCallerLabel || 'Embedding', {
            sourceType: 'embedding',
            billingExcluded: true,
          });

          writeJson(res, 200, { ok: true, embedding: embResult.embedding, model: embeddingModelId }, corsOrigin);
          return true;
        } catch (e: any) {
          console.error('[inference] ai/embedding error:', e);
          writeJson(res, 500, { ok: false, error: e?.message || 'embedding_failed', model: embeddingModelId }, corsOrigin);
          return true;
        }
      }

      // Select model
      const modelId = modelChoice === 'quality' ? 'gpt-4.1-mini' : 'gemini-2.5-flash';
      const FALLBACK_MODEL_ID = 'gemini-3-flash-preview';

      // Build full prompt
      const fullPrompt = input ? `${prompt}\n\n---\nInput:\n${input}` : prompt;

      const runInference = async (model: any, mId: string) => {
        if (mode === 'json' && schema) {
          const schemaDesc = JSON.stringify(schema);
          const jsonPrompt = `${fullPrompt}\n\nRespond with a valid JSON object matching this schema: ${schemaDesc}\nOutput ONLY the JSON, no markdown or explanation.`;
          const messages: any[] = systemPrompt
            ? [{ role: 'system', content: systemPrompt }, { role: 'user', content: jsonPrompt }]
            : [{ role: 'user', content: jsonPrompt }];
          const result = await generateText({ model: model as any, messages, temperature });
          await logInferenceUsage(textUserId, mId, result.usage, textCallerLabel || 'AI Inference (JSON)');
          let jsonResult: any;
          try {
            const text = result.text.trim();
            // Handle markdown code blocks
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            const jsonStr = jsonMatch ? jsonMatch[1].trim() : text;
            jsonResult = JSON.parse(jsonStr);
          } catch {
            // Try to extract JSON object
            const text = result.text.trim();
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start >= 0 && end > start) {
              jsonResult = JSON.parse(text.slice(start, end + 1));
            } else {
              throw new Error('Failed to parse JSON from response');
            }
          }
          writeJson(res, 200, { ok: true, json: jsonResult, model: mId }, corsOrigin);
        } else {
          const messages: any[] = systemPrompt
            ? [{ role: 'system', content: systemPrompt }, { role: 'user', content: fullPrompt }]
            : [{ role: 'user', content: fullPrompt }];
          const result = await generateText({ model: model as any, messages, temperature });
          await logInferenceUsage(textUserId, mId, result.usage, textCallerLabel || 'AI Inference (text)');
          const text = result.text?.trim() || '';
          writeJson(res, 200, { ok: true, text, model: mId }, corsOrigin);
        }
      };

      const aiModel = modelChoice === 'quality' ? openai(modelId) : google(modelId);
      try {
        await runInference(aiModel, modelId);
        return true;
      } catch (e: any) {
        const isOverloaded = e?.reason === 'maxRetriesExceeded' &&
          Array.isArray(e?.errors) && e.errors.some((err: any) => err?.statusCode === 503);
        if (isOverloaded && modelChoice !== 'quality') {
          try {
            await runInference(google(FALLBACK_MODEL_ID), FALLBACK_MODEL_ID);
            return true;
          } catch (e2: any) {
            console.error('[inference] ai/text error (fallback):', e2);
            writeJson(res, 500, { ok: false, error: e2?.message || 'ai_inference_failed', model: FALLBACK_MODEL_ID }, corsOrigin);
            return true;
          }
        }
        console.error('[inference] ai/text error:', e);
        writeJson(res, 500, { ok: false, error: e?.message || 'ai_inference_failed', model: modelId }, corsOrigin);
        return true;
      }
    } catch (e: any) {
      writeJson(res, 500, { ok: false, error: e?.message || 'failed' }, corsOrigin);
      return true;
    }
  }

  if (req.method === 'POST' && path === '/inference/ai/embed') {
    try {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const authed = token ? await verifyToken(token) : null;
      const singleEmbUserId = authed?.userId || null;
      if (!authed) {
        writeJson(res, 401, { ok: false, error: 'unauthorized' }, corsOrigin);
        return true;
      }
      const body = await readJsonBody(req);
      const text = String(body?.text || '').trim();
      const modelId = String(body?.model || 'google/gemini-embedding-2-preview').trim() || 'google/gemini-embedding-2-preview';
      if (!text) {
        writeJson(res, 400, { ok: false, error: 'missing_text' }, corsOrigin);
        return true;
      }

      const embModel = buildProviderEmbeddingModel(modelId);
      if (!embModel) {
        writeJson(res, 400, { ok: false, error: `unknown_embedding_model: ${modelId}` }, corsOrigin);
        return true;
      }

      // Callers (e.g. file-search) can pin the output dimensionality so their
      // query vectors match how the documents were embedded. Without this,
      // gemini-embedding-2 returns its 768-dim default and any caller that
      // stored a different size gets zero cosine matches.
      const reqDim = Number(body?.outputDimensionality);
      const outputDimensionality = Number.isFinite(reqDim) && reqDim > 0 ? Math.floor(reqDim) : undefined;

      const out = await embed({
        model: embModel,
        value: text.slice(0, 12000),
        ...(outputDimensionality && modelId.toLowerCase().startsWith('google/')
          ? { providerOptions: { google: { outputDimensionality } } }
          : {}),
      });
      await logInferenceUsage(singleEmbUserId, modelId, out.usage, 'Embedding', {
        sourceType: 'embedding',
        billingExcluded: true,
      });

      writeJson(res, 200, { ok: true, embedding: out.embedding, model: modelId }, corsOrigin);
      return true;
    } catch (e: any) {
      console.error('[inference] ai/embed error:', e);
      writeJson(res, 500, { ok: false, error: e?.message || 'embed_failed' }, corsOrigin);
      return true;
    }
  }

  // Multimodal file summarization - supports images, audio, video, PDF as attachments
  if (req.method === 'POST' && path === '/inference/ai/summarize-file') {
    try {
      // Summarization consumes provider credits; require auth in production.
      const { userId: sumUserId, isAuthed } = await validateAuth(req);
      if (!isAuthed) {
        writeJson(res, 401, { ok: false, error: 'unauthorized' }, corsOrigin);
        return true;
      }
      const creditErr = await requireCredits(sumUserId);
      if (creditErr) {
        writeJson(res, 403, { ok: false, error: creditErr }, corsOrigin);
        return true;
      }

      const body = await readJsonBody(req);
      const filename = String(body?.filename || 'file');
      const mimeType = String(body?.mimeType || 'application/octet-stream');
      const base64Data = body?.data as string | undefined;  // Base64 encoded file
      const textContent = body?.text as string | undefined;  // For text-based files

      if (!base64Data && !textContent) {
        writeJson(res, 400, { ok: false, error: 'Either data (base64) or text content required' }, corsOrigin);
        return true;
      }

      const summaryPrompt = `You are a file summarizer. Analyze this file and generate:
1. A concise summary (2-4 sentences) describing what this file contains
2. A comma-separated list of relevant keywords (5-15 keywords)

Format your response EXACTLY as:
SUMMARY: [your summary here]
KEYWORDS: [keyword1, keyword2, keyword3, ...]

Filename: ${filename}`;

      let content: any[];

      if (base64Data) {
        // Multimodal: send as attachment
        content = [
          { type: 'text', text: summaryPrompt },
          mimeType.startsWith('image/') 
            ? { type: 'image', image: base64Data, mimeType }
            : { type: 'file', data: base64Data, mimeType },
        ];
      } else {
        // Text content
        content = [
          { type: 'text', text: `${summaryPrompt}\n\nContent:\n${textContent?.slice(0, 15000)}` },
        ];
      }

      const result = await generateText({
        model: google('gemini-2.5-flash') as any,
        messages: [{ role: 'user', content }],
        temperature: 0.3,
      });
      await logInferenceUsage(sumUserId, 'google/gemini-2.5-flash', result.usage, 'File Summary');

      const text = result.text?.trim() || '';
      const summaryMatch = text.match(/SUMMARY:\s*(.+?)(?=KEYWORDS:|$)/is);
      const keywordsMatch = text.match(/KEYWORDS:\s*(.+?)$/is);

      writeJson(res, 200, {
        ok: true,
        summary: summaryMatch?.[1]?.trim() || `File: ${filename}`,
        keywords: keywordsMatch?.[1]?.trim() || filename.replace(/[._-]/g, ', '),
        model: 'gemini-2.5-flash',
      }, corsOrigin);
      return true;
    } catch (e: any) {
      console.error('[inference] ai/summarize-file error:', e);
      writeJson(res, 500, { ok: false, error: e?.message || 'summarize_failed' }, corsOrigin);
      return true;
    }
  }

  // ─── OpenAI-compatible /v1/chat/completions proxy ─────────────────────────
  // Used by the browser-use Python agent to call LLMs through our cloud
  // without leaking API keys to user machines.
  if (req.method === 'POST' && path === '/v1/chat/completions') {
    try {
      // Strict auth for cloud LLM proxy.
      // We do not allow development-mode bypass on this endpoint.
      const { userId: chatUserId, isAuthed: chatAuthed } = await validateStrictBearerAuth(req);
      if (!chatAuthed) {
        writeJson(res, 401, { error: { message: 'unauthorized', type: 'auth_error' } }, corsOrigin);
        return true;
      }
      const body = await readJsonBody(req);
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      const modelRaw = String(body?.model || 'gemini-3-flash-preview').trim();
      const modelSource = typeof body?.modelSource === 'string' ? String(body.modelSource).trim() : undefined;
      const temperature = typeof body?.temperature === 'number' ? body.temperature : 0.3;

      // Credit gate AFTER parsing modelSource so BYOK / subscription requests
      // backed by a real user credential bypass the Stuard credit balance.
      const creditErr = await requireCredits(chatUserId, modelSource);
      if (creditErr) {
        writeJson(res, 403, { error: { message: creditErr, type: 'credit_error' } }, corsOrigin);
        return true;
      }

      if (messages.length === 0) {
        writeJson(res, 400, { error: { message: 'messages is required', type: 'invalid_request_error' } }, corsOrigin);
        return true;
      }

      const modelCandidates = buildProxyModelCandidates(modelRaw);

      const normalizedMessages: Array<{ role: string; content: string }> = messages.map((m: any) => ({
        role: String(m?.role || 'user'),
        content: normalizeOpenAIContentToText(m?.content),
      }));
      const nonEmptyMessages = normalizedMessages.filter((m) => m.content.trim().length > 0);
      if (nonEmptyMessages.length === 0) {
        writeJson(res, 400, { error: { message: 'messages content is empty', type: 'invalid_request_error' } }, corsOrigin);
        return true;
      }
      const totalChars = nonEmptyMessages.reduce((sum, m) => sum + m.content.length, 0);
      if (totalChars > 400_000) {
        writeJson(res, 400, { error: { message: 'messages too large', type: 'invalid_request_error' } }, corsOrigin);
        return true;
      }

      const proxyMessages = nonEmptyMessages.map((m) => {
        const role = m.role === 'system' || m.role === 'assistant' || m.role === 'tool' ? m.role : 'user';
        return { role, content: m.content } as any;
      });
      const hasSupportedModel = modelCandidates.some((id) => !!buildProviderModel(id));
      if (!hasSupportedModel) {
        writeJson(res, 400, { error: { message: `unsupported model: ${modelCandidates[0]}`, type: 'invalid_request_error' } }, corsOrigin);
        return true;
      }

      let result: any = null;
      let usedModelId = '';
      let usedSource: 'byok' | 'friendly' | 'subscription' = 'friendly';
      let lastError: any = null;
      for (const candidateId of modelCandidates) {
        const resolved = await buildProviderModelForUser(chatUserId, candidateId, modelSource);
        if (!resolved) continue;
        try {
          result = await generateText({
            model: resolved.model as any,
            messages: proxyMessages,
            temperature,
          });
          usedModelId = candidateId;
          usedSource = resolved.source;
          break;
        } catch (e: any) {
          lastError = e;
          console.warn(`[inference] chat proxy model failed (${candidateId}): ${summarizeModelError(e)}`);
        }
      }
      if (!result) throw lastError || new Error('no_available_model');
      await logInferenceUsage(
        chatUserId,
        usedModelId || modelCandidates[0],
        result.usage,
        'Chat Proxy (browser-use)',
        { billingExcluded: usedSource === 'byok' || usedSource === 'subscription' },
      );

      const wantsJson = shouldNormalizeJsonOutput(nonEmptyMessages);
      const rawText = result.text?.trim() || '';
      const text = wantsJson ? tryNormalizeJsonLikeText(rawText) : rawText;
      const usage = result.usage || {};

      // Return OpenAI-compatible format
      writeJson(res, 200, {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: usedModelId || modelCandidates[0],
        choices: [{
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: (usage as any)?.promptTokens || 0,
          completion_tokens: (usage as any)?.completionTokens || 0,
          total_tokens: ((usage as any)?.promptTokens || 0) + ((usage as any)?.completionTokens || 0),
        },
      }, corsOrigin);
      return true;
    } catch (e: any) {
      console.error(`[inference] v1/chat/completions error: ${summarizeModelError(e)}`);
      writeJson(res, 500, { error: { message: 'internal_error', type: 'server_error' } }, corsOrigin);
      return true;
    }
  }

  return false;
}
