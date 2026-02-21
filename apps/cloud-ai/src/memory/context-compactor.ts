/**
 * Context Compactor
 *
 * Auto-compacts conversation history to keep the active context window
 * small and token-efficient while preserving important information.
 *
 * Strategy:
 * 1. Keep the most recent N messages raw (they contain fresh context)
 * 2. Summarize older messages into a dense "conversation summary" system message
 * 3. Truncate large tool results inline (>TOOL_RESULT_MAX_CHARS)
 *
 * The compactor runs after each turn and replaces older messages with a summary,
 * keeping total history bounded without losing critical facts.
 */

import { generateText } from 'ai';
import { buildProviderModel } from '../utils/models';
import { getDefaultModelForCategory } from '../pricing';

// ─── Configuration ───────────────────────────────────────────────────────────

/** Number of recent messages to keep raw (not summarized) */
const KEEP_RECENT_RAW = 10;

/** When history exceeds this count, trigger compaction */
const COMPACTION_THRESHOLD = 20;

/** Max characters for a tool result before truncation */
const TOOL_RESULT_MAX_CHARS = 2000;

/** Prefix used to identify our summary messages */
const SUMMARY_PREFIX = '[CONVERSATION SUMMARY]';

// ─── Types ───────────────────────────────────────────────────────────────────

interface HistoryMessage {
  role: string;
  content: any;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Extract text from a message's content field, handling both string and
 * structured (multi-part) content.
 */
function messageToText(msg: HistoryMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        if (part?.type === 'tool-call') return `[Called ${part.toolName}]`;
        if (part?.type === 'tool-result') {
          const result = typeof part.result === 'string' ? part.result : JSON.stringify(part.result ?? '');
          return `[${part.toolName} result: ${result.slice(0, 200)}...]`;
        }
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  return String(msg.content || '');
}

/**
 * Truncate large tool results in-place to save tokens.
 * Modifies the message content array directly.
 */
export function truncateToolResults(messages: HistoryMessage[]): void {
  for (const msg of messages) {
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.type === 'tool-result' && typeof part.result === 'string') {
          if (part.result.length > TOOL_RESULT_MAX_CHARS) {
            part.result = part.result.slice(0, TOOL_RESULT_MAX_CHARS - 100) +
              `\n...[truncated, ${part.result.length} chars total]`;
          }
        }
      }
    }
    // Also truncate assistant text content if extremely long (e.g., code dumps)
    if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.length > 8000) {
      msg.content = msg.content.slice(0, 7500) +
        `\n...[truncated, ${msg.content.length} chars total]`;
    }
  }
}

/**
 * Check if a message is our injected summary message
 */
function isSummaryMessage(msg: HistoryMessage): boolean {
  if (msg.role !== 'system') return false;
  const text = typeof msg.content === 'string' ? msg.content : '';
  return text.startsWith(SUMMARY_PREFIX);
}

// ─── Core Compactor ──────────────────────────────────────────────────────────

/**
 * Compact conversation history in-place.
 *
 * If history.length > COMPACTION_THRESHOLD:
 * 1. Take the oldest messages (everything except the last KEEP_RECENT_RAW)
 * 2. Summarize them with a fast model
 * 3. Replace them with a single system message containing the summary
 * 4. Return the compacted history
 *
 * If under threshold, just truncates tool results and returns as-is.
 *
 * @returns The compacted history array (same reference, mutated in place)
 */
export async function compactHistory(history: HistoryMessage[]): Promise<HistoryMessage[]> {
  // Always truncate large tool results
  truncateToolResults(history);

  if (history.length <= COMPACTION_THRESHOLD) {
    return history;
  }

  // Find how many messages to summarize (everything except the recent ones)
  const summarizeCount = history.length - KEEP_RECENT_RAW;
  if (summarizeCount <= 2) return history; // Not enough to bother

  const toSummarize = history.slice(0, summarizeCount);
  const toKeep = history.slice(summarizeCount);

  // Check if there's already a summary message — extract and include it
  let existingSummary = '';
  const existingSummaryIdx = toSummarize.findIndex(isSummaryMessage);
  if (existingSummaryIdx >= 0) {
    existingSummary = messageToText(toSummarize[existingSummaryIdx]);
    // Remove the prefix for re-summarization
    existingSummary = existingSummary.replace(SUMMARY_PREFIX, '').trim();
  }

  // Build text for summarization
  const conversationText = toSummarize
    .filter(m => !isSummaryMessage(m))
    .map(m => {
      const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : m.role === 'tool' ? 'Tool' : m.role;
      return `${role}: ${messageToText(m)}`;
    })
    .join('\n')
    .slice(0, 6000); // Cap input to avoid excessive cost

  try {
    const modelId = getDefaultModelForCategory('fast');
    const model = buildProviderModel(modelId);

    const prompt = existingSummary
      ? `Previous summary:\n${existingSummary}\n\nNew messages to incorporate:\n${conversationText}`
      : conversationText;

    const { text: summary } = await generateText({
      model: model as any,
      system: `You are a conversation summarizer. Produce a dense, factual summary of the conversation.
Include:
- Key decisions and outcomes
- Important facts, names, files, URLs, or code references
- Tool actions taken and their results (briefly)
- User preferences or instructions established
Keep it under 300 words. Use bullet points. Omit greetings and filler.`,
      prompt,
      temperature: 0.2,
    });

    const summaryText = `${SUMMARY_PREFIX}\n${summary.trim()}`;

    // Mutate history in-place: remove old messages, prepend summary
    history.splice(0, summarizeCount, { role: 'system', content: summaryText });

    console.log(`[compactor] Compacted ${summarizeCount} messages → 1 summary (${history.length} total)`);
  } catch (err) {
    // On failure, just do a naive trim instead of losing everything
    console.warn('[compactor] Summarization failed, falling back to naive trim:', err);
    if (history.length > 40) {
      history.splice(0, history.length - 40);
    }
  }

  return history;
}
