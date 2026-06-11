import { generateText } from 'ai';
import { getDefaultModelForCategory } from '../pricing';
import { buildNativeProviderModel } from '../utils/models';
import {
  computeBudget,
  estimateTokens,
  shouldCompact,
  type ContextBudget,
} from './token-budget';

export interface HistoryMessage {
  role: string;
  content: any;
}

export const SUMMARY_PREFIX = '[CONVERSATION SUMMARY]';

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function keepRecentMin(): number {
  return Math.max(1, Math.round(envNumber('COMPACTION_KEEP_RECENT_MIN', 4)));
}

function pruneProtectTokens(): number {
  return Math.max(0, Math.round(envNumber('COMPACTION_PRUNE_PROTECT', 40000)));
}

function pruneMinimumTokens(): number {
  return Math.max(0, Math.round(envNumber('COMPACTION_PRUNE_MINIMUM', 20000)));
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

export function messageToText(msg: HistoryMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        if (part?.type === 'reasoning') return part.text || '';
        if (part?.type === 'tool-call') return `[Called ${part.toolName}]`;
        if (part?.type === 'tool-result') {
          const result = stringifyValue(part.result);
          return `[${part.toolName} result: ${result.slice(0, 200)}...]`;
        }
        if (part?.type === 'image' || part?.type === 'file') return `[${part.type}]`;
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  return String(msg.content || '');
}

export function isSummaryMessage(msg: HistoryMessage): boolean {
  if (msg.role !== 'system' && msg.role !== 'user') return false;
  const text = typeof msg.content === 'string' ? msg.content : '';
  return text.startsWith(SUMMARY_PREFIX);
}

function buildPrunedMarker(originalLength: number): string {
  return `\n...[pruned, ${originalLength} chars total]`;
}

function truncateToolResultValue(value: unknown): string {
  const text = stringifyValue(value);
  if (text.length > 2000) {
    return text.slice(0, 100) + buildPrunedMarker(text.length);
  }
  if (text.length > 500) {
    return text.slice(0, 200) + buildPrunedMarker(text.length);
  }
  return text;
}

function truncateAssistantTextValue(value: string): string {
  if (value.length <= 8000) return value;
  return value.slice(0, 7500) + `\n...[truncated, ${value.length} chars total]`;
}

function getLeadingSystemCount(messages: HistoryMessage[]): number {
  let count = 0;
  for (const msg of messages) {
    if (msg?.role !== 'system') break;
    count += 1;
  }
  return count;
}

/**
 * Messages that must never be summarized away: the leading system prompt(s)
 * and the first user message (the original task/objective). Leading summary
 * messages from prior compactions are NOT protected so they get merged into
 * the next summary instead of stacking up.
 */
function getProtectedPrefixCount(messages: HistoryMessage[]): number {
  let count = 0;
  for (const msg of messages) {
    if (msg?.role !== 'system' || isSummaryMessage(msg)) break;
    count += 1;
  }
  const next = messages[count];
  if (next && next.role === 'user' && !isSummaryMessage(next)) {
    count += 1;
  }
  return count;
}

/**
 * A kept window must never start with a tool message — providers reject a
 * tool result whose originating tool call was summarized away. Pull the
 * boundary back so the assistant message holding the tool call stays kept.
 */
function snapToSafeBoundary(messages: HistoryMessage[], index: number, floor: number): number {
  let snapped = index;
  while (snapped > floor && messages[snapped]?.role === 'tool') snapped -= 1;
  return snapped;
}

function stripSummaryPrefix(text: string): string {
  return text.startsWith(SUMMARY_PREFIX)
    ? text.slice(SUMMARY_PREFIX.length).trim()
    : text.trim();
}

function buildSummaryText(summary: string): string {
  return `${SUMMARY_PREFIX}\n${summary.trim()}`;
}

function collectExistingSummary(messages: HistoryMessage[]): string {
  return messages
    .filter(isSummaryMessage)
    .map((msg) => stripSummaryPrefix(typeof msg.content === 'string' ? msg.content : ''))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function renderMessagesForSummary(messages: HistoryMessage[]): string {
  return messages
    .filter((msg) => !isSummaryMessage(msg))
    .map((msg) => {
      const role =
        msg.role === 'user'
          ? 'User'
          : msg.role === 'assistant'
            ? 'Assistant'
            : msg.role === 'tool'
              ? 'Tool'
              : msg.role === 'system'
                ? 'System'
                : String(msg.role || 'Message');
      return `${role}: ${messageToText(msg)}`;
    })
    .filter(Boolean)
    .join('\n');
}

const STRUCTURED_SUMMARY_SYSTEM_PROMPT = `You compress conversation history into a durable working summary.

Return only the updated summary using exactly these sections, and omit any section that would be empty:

## TASK
[One sentence: user's overall objective]

## KEY INSTRUCTIONS
- [standing user preferences or constraints]

## DISCOVERIES
- [facts, file paths, URLs, code references, results]

## ACCOMPLISHED
1. [completed action and outcome]

## CURRENT STATE
[One sentence describing where things stand now]

## OPEN ITEMS
- [pending unresolved item]

Rules:
- Keep it under 400 words.
- Preserve exact technical details, including file paths, model IDs, env vars, URLs, commands, and identifiers.
- Merge prior summary content into the new summary instead of nesting or repeating headings.
- Be factual and compact. No filler, greetings, or commentary about summarization.`;

async function generateStructuredSummary(messages: HistoryMessage[]): Promise<string> {
  const existingSummary = collectExistingSummary(messages);
  const renderedConversation = renderMessagesForSummary(messages);

  if (!renderedConversation.trim()) {
    if (existingSummary) return buildSummaryText(existingSummary);
    throw new Error('no_messages_to_summarize');
  }

  const prompt = [
    existingSummary
      ? `Existing structured summary to update:\n${existingSummary}`
      : 'No prior summary exists yet.',
    `Conversation entries to incorporate:\n${renderedConversation}`,
  ].join('\n\n');

  const fastModelId = getDefaultModelForCategory('fast');
  const model = buildNativeProviderModel(fastModelId);
  if (!model) {
    throw new Error(`missing_compaction_model:${fastModelId}`);
  }

  const { text } = await generateText({
    model: model as any,
    system: STRUCTURED_SUMMARY_SYSTEM_PROMPT,
    prompt,
    temperature: 0.1,
  });

  const summary = String(text || '').trim();
  if (!summary) {
    throw new Error('empty_summary');
  }

  return buildSummaryText(summary);
}

export function pruneToolOutputs(messages: HistoryMessage[], _budget: ContextBudget): HistoryMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const estimate = estimateTokens(messages);
  if (estimate.toolResultTokens < pruneMinimumTokens()) {
    return messages;
  }

  const protectThreshold = pruneProtectTokens();
  let suffixTokens = 0;

  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    suffixTokens += estimate.messageTokens[idx] ?? 0;
    if (suffixTokens <= protectThreshold) continue;

    const msg = messages[idx];
    if (!msg) continue;

    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.type === 'tool-result') {
          part.result = truncateToolResultValue(part.result);
        }
      }
    }

    if (msg.role === 'assistant' && typeof msg.content === 'string') {
      msg.content = truncateAssistantTextValue(msg.content);
    }
  }

  return messages;
}

export function truncateToolResults(messages: HistoryMessage[]): void {
  pruneToolOutputs(messages, computeBudget(getDefaultModelForCategory('balanced')));
}

export function getRecentWithinBudget(history: HistoryMessage[], budget: ContextBudget): HistoryMessage[] {
  if (!Array.isArray(history) || history.length === 0) return [];

  const messageEstimate = estimateTokens(history);
  const keepIndices = new Set<number>();
  const leadingSystemCount = getLeadingSystemCount(history);
  const keepRecent = keepRecentMin();
  let remainingBudget = budget.historyBudget;

  for (let idx = 0; idx < leadingSystemCount; idx += 1) {
    keepIndices.add(idx);
    remainingBudget -= messageEstimate.messageTokens[idx] ?? 0;
  }

  const recentStart = Math.max(leadingSystemCount, history.length - keepRecent);
  for (let idx = recentStart; idx < history.length; idx += 1) {
    if (keepIndices.has(idx)) continue;
    keepIndices.add(idx);
    remainingBudget -= messageEstimate.messageTokens[idx] ?? 0;
  }

  for (let idx = recentStart - 1; idx >= leadingSystemCount; idx -= 1) {
    const tokens = messageEstimate.messageTokens[idx] ?? 0;
    if (remainingBudget - tokens < 0) break;
    keepIndices.add(idx);
    remainingBudget -= tokens;
  }

  // The kept suffix must not start with a tool message whose tool call was
  // dropped — providers reject orphaned tool results. Trim them off the front.
  for (let idx = leadingSystemCount; idx < history.length; idx += 1) {
    if (!keepIndices.has(idx)) continue;
    if (history[idx]?.role !== 'tool') break;
    keepIndices.delete(idx);
  }

  const recentHistory = history.filter((_, idx) => keepIndices.has(idx));
  return recentHistory.length > 0 ? recentHistory : history.slice(-keepRecent);
}

function aggressivelyTrimProtectedMessages(history: HistoryMessage[]): void {
  for (const msg of history) {
    if (Array.isArray(msg?.content)) {
      for (const part of msg.content) {
        if (part?.type === 'tool-result') {
          const current = stringifyValue(part.result);
          if (current.length > 250) {
            part.result = current.slice(0, 80) + buildPrunedMarker(current.length);
          }
        }
      }
    }

    if (typeof msg?.content === 'string' && msg.content.length > 4000) {
      msg.content = msg.content.slice(0, 2500) + `\n...[truncated, ${msg.content.length} chars total]`;
    }
  }
}

export function emergencyTruncate(history: HistoryMessage[], budget: ContextBudget): HistoryMessage[] {
  if (!Array.isArray(history) || history.length === 0) return history;

  pruneToolOutputs(history, budget);

  const protectedCount = getProtectedPrefixCount(history);
  const keepRecent = keepRecentMin();
  let currentTokens = estimateTokens(history).totalTokens;

  if (currentTokens <= budget.historyBudget) return history;

  for (let idx = protectedCount; idx < history.length - keepRecent && currentTokens > budget.historyBudget;) {
    const msg = history[idx];
    if (!msg || msg.role === 'system') {
      idx += 1;
      continue;
    }
    // Drop trailing tool messages with their parent so no orphaned tool
    // results remain (even when they sit past the keepRecent boundary).
    let removeCount = 1;
    while (history[idx + removeCount]?.role === 'tool') removeCount += 1;
    history.splice(idx, removeCount);
    currentTokens = estimateTokens(history).totalTokens;
  }

  if (currentTokens > budget.historyBudget) {
    aggressivelyTrimProtectedMessages(history);
  }

  return history;
}

export async function generateMidTurnSummary(messages: HistoryMessage[]): Promise<string> {
  const budget = computeBudget(getDefaultModelForCategory('fast'));
  pruneToolOutputs(messages, budget);
  return generateStructuredSummary(messages);
}

export async function compactHistory(history: HistoryMessage[], modelId?: string): Promise<HistoryMessage[]> {
  if (!Array.isArray(history) || history.length === 0) return history;

  const resolvedModelId = modelId || getDefaultModelForCategory('balanced');
  const budget = computeBudget(resolvedModelId);
  pruneToolOutputs(history, budget);

  const compactionCheck = shouldCompact(history, resolvedModelId);
  if (!compactionCheck.shouldCompact) {
    return history;
  }

  const keepRecent = keepRecentMin();
  const estimate = estimateTokens(history);
  const keepRawTarget = Math.max(1, Math.round(compactionCheck.budget.compactionTargetTokens * 0.60));
  const protectedCount = getProtectedPrefixCount(history);

  let keepStartIndex = history.length;
  let keptTokens = 0;

  for (let idx = history.length - 1; idx >= 0; idx -= 1) {
    keptTokens += estimate.messageTokens[idx] ?? 0;
    keepStartIndex = idx;
    const keptCount = history.length - idx;
    if (keptCount >= keepRecent && keptTokens >= keepRawTarget) {
      break;
    }
  }

  keepStartIndex = Math.max(protectedCount, Math.min(keepStartIndex, history.length - keepRecent));
  keepStartIndex = snapToSafeBoundary(history, keepStartIndex, protectedCount);
  const toSummarize = history.slice(protectedCount, keepStartIndex);
  if (toSummarize.length === 0 || toSummarize.every(isSummaryMessage)) {
    return history;
  }

  const summaryText = await generateStructuredSummary(toSummarize);
  // A summary spliced after a protected user message can't be role 'system'
  // (several providers only accept system messages at the head).
  const summaryRole = protectedCount === 0 || history[protectedCount - 1]?.role === 'system' ? 'system' : 'user';
  history.splice(protectedCount, keepStartIndex - protectedCount, { role: summaryRole, content: summaryText });

  if (estimateTokens(history).totalTokens > budget.historyBudget) {
    emergencyTruncate(history, budget);
  }

  console.log(
    `[compactor] Compacted ${compactionCheck.currentTokens} -> ${estimateTokens(history).totalTokens} tokens`,
  );

  return history;
}
