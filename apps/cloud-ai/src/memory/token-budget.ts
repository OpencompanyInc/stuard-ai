import { ALL_MODELS, getDefaultModelForCategory } from '../pricing';

interface HistoryMessage {
  role: string;
  content: any;
}

export interface ContextBudget {
  contextWindow: number;
  outputReserve: number;
  compactionReserve: number;
  systemReserve: number;
  historyBudget: number;
  compactionTriggerTokens: number;
  compactionTargetTokens: number;
}

export interface TokenEstimate {
  totalTokens: number;
  messageTokens: number[];
  toolResultTokens: number;
}

type ModelBucket = 'fast' | 'balanced' | 'smart' | 'research';

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function clampFraction(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value <= 0) return fallback;
  if (value >= 1) return fallback;
  return value;
}

function roundTokens(value: number): number {
  return Math.max(0, Math.round(value));
}

function charsPerToken(): number {
  return Math.max(1, envNumber('COMPACTION_CHARS_PER_TOKEN', 3.5));
}

function estimateStringTokens(text: string): number {
  if (!text) return 0;
  return roundTokens(text.length / charsPerToken());
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isModelBucket(value: string): value is ModelBucket {
  return value === 'fast' || value === 'balanced' || value === 'smart' || value === 'research';
}

function resolveModelId(modelId: string): string {
  const raw = String(modelId || '').trim();
  if (isModelBucket(raw)) return getDefaultModelForCategory(raw);
  return raw;
}

function estimatePartTokens(part: any): { total: number; toolResult: number } {
  if (typeof part === 'string') {
    return { total: estimateStringTokens(part), toolResult: 0 };
  }
  if (!part || typeof part !== 'object') {
    const tokens = estimateStringTokens(String(part ?? ''));
    return { total: tokens, toolResult: 0 };
  }

  const partType = String(part.type || '').toLowerCase();

  if (partType === 'text' || partType === 'reasoning') {
    return { total: estimateStringTokens(String(part.text || '')), toolResult: 0 };
  }

  if (partType === 'tool-call') {
    const toolNameTokens = estimateStringTokens(String(part.toolName || ''));
    const argsTokens = estimateStringTokens(stringifyValue(part.args));
    return { total: 50 + toolNameTokens + argsTokens, toolResult: 0 };
  }

  if (partType === 'tool-result') {
    const resultTokens = 20 + estimateStringTokens(stringifyValue(part.result));
    return { total: resultTokens, toolResult: resultTokens };
  }

  if (
    partType.includes('image') ||
    partType === 'file' ||
    partType === 'audio' ||
    partType === 'video' ||
    String(part.mediaType || part.mimeType || '').startsWith('image/') ||
    String(part.mediaType || part.mimeType || '').startsWith('audio/') ||
    String(part.mediaType || part.mimeType || '').startsWith('video/')
  ) {
    return { total: 1000, toolResult: 0 };
  }

  const fallbackTokens = estimateStringTokens(stringifyValue(part));
  return { total: fallbackTokens, toolResult: 0 };
}

function estimateContentTokens(content: any): { total: number; toolResult: number } {
  if (typeof content === 'string') {
    return { total: estimateStringTokens(content), toolResult: 0 };
  }
  if (Array.isArray(content)) {
    return content.reduce(
      (acc, part) => {
        const estimate = estimatePartTokens(part);
        acc.total += estimate.total;
        acc.toolResult += estimate.toolResult;
        return acc;
      },
      { total: 0, toolResult: 0 },
    );
  }
  if (content && typeof content === 'object') {
    const tokens = estimateStringTokens(stringifyValue(content));
    return { total: tokens, toolResult: 0 };
  }
  return { total: 0, toolResult: 0 };
}

export function getContextWindow(modelId: string): number {
  const fallbackContext = roundTokens(envNumber('COMPACTION_FALLBACK_CONTEXT', 128000));
  const resolvedModelId = resolveModelId(modelId);
  if (!resolvedModelId) return fallbackContext;
  const model = ALL_MODELS.find((entry) => entry.id === resolvedModelId);
  const contextWindow = Number(model?.contextWindow || 0);
  return contextWindow > 0 ? contextWindow : fallbackContext;
}

export function computeBudget(modelId: string): ContextBudget {
  const contextWindow = getContextWindow(modelId);
  const outputReserveFraction = clampFraction(envNumber('COMPACTION_OUTPUT_RESERVE', 0.15), 0.15);
  const outputReserveMin = roundTokens(envNumber('COMPACTION_OUTPUT_RESERVE_MIN', 8192));
  const compactionReserve = roundTokens(envNumber('COMPACTION_CALL_RESERVE', 4096));
  const systemReserve = roundTokens(envNumber('COMPACTION_SYSTEM_RESERVE', 10000));
  const outputReserve = Math.max(outputReserveMin, roundTokens(contextWindow * outputReserveFraction));
  const historyBudget = Math.max(0, contextWindow - outputReserve - compactionReserve - systemReserve);
  const triggerFraction = clampFraction(envNumber('COMPACTION_TRIGGER_FRACTION', 0.80), 0.80);
  const targetFraction = clampFraction(envNumber('COMPACTION_TARGET_FRACTION', 0.50), 0.50);

  return {
    contextWindow,
    outputReserve,
    compactionReserve,
    systemReserve,
    historyBudget,
    compactionTriggerTokens: roundTokens(historyBudget * triggerFraction),
    compactionTargetTokens: roundTokens(historyBudget * targetFraction),
  };
}

export function estimateTokens(messages: HistoryMessage[]): TokenEstimate {
  const messageTokens: number[] = [];
  let totalTokens = 0;
  let toolResultTokens = 0;

  for (const msg of Array.isArray(messages) ? messages : []) {
    const estimate = estimateContentTokens(msg?.content);
    const framingOverhead = 4;
    const roleOverhead = estimateStringTokens(String(msg?.role || ''));
    const messageTokenCount = framingOverhead + roleOverhead + estimate.total;
    messageTokens.push(messageTokenCount);
    totalTokens += messageTokenCount;
    toolResultTokens += estimate.toolResult;
  }

  return {
    totalTokens,
    messageTokens,
    toolResultTokens,
  };
}

export function shouldCompact(messages: HistoryMessage[], modelId: string): {
  shouldCompact: boolean;
  currentTokens: number;
  budget: ContextBudget;
} {
  const budget = computeBudget(modelId);
  const estimate = estimateTokens(messages);
  const keepRecentMin = Math.max(1, roundTokens(envNumber('COMPACTION_KEEP_RECENT_MIN', 4)));
  return {
    shouldCompact: Array.isArray(messages) && messages.length >= keepRecentMin && estimate.totalTokens >= budget.compactionTriggerTokens,
    currentTokens: estimate.totalTokens,
    budget,
  };
}
