/**
 * System message for LLM thread-title generation (websocket stream, serverless).
 */
export const THREAD_TITLE_SYSTEM = [
  'You name chat threads.',
  'Reply with only the title: at most 6 words.',
  'No quotation marks and no trailing sentence punctuation (., !, ?).',
  'Do not write Title:, Thread:, or any label — output nothing but the title words.',
].join(' ');

/**
 * Strip labels and noise from model output so stored/UI titles are raw title text only.
 */
export function normalizeThreadTitle(raw: unknown, maxLen = 80): string {
  let title = String(raw ?? '').trim();
  if (!title) return '';
  title = title.replace(/\r\n/g, '\n');
  title = title
    .replace(/^(?:[*_`#\s]+)*(?:title|thread\s*title|conversation\s*title)\s*:\s*/i, '')
    .trim();
  title = title.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
  title = title.replace(/[\.\!?]+$/g, '').trim();
  return title.slice(0, maxLen);
}

/**
 * Derive a sensible immediate title from the user's first message so we never
 * persist an "Untitled" conversation while the LLM title is still being
 * generated. The LLM-generated title (when it arrives) overwrites this.
 */
export function fallbackTitleFromMessage(message: unknown, maxWords = 6, maxLen = 60): string {
  const cleaned = String(message ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const words = cleaned.split(' ');
  let title = words.slice(0, maxWords).join(' ');
  if (words.length > maxWords) title += '…';
  if (title.length > maxLen) title = title.slice(0, maxLen - 1).trimEnd() + '…';
  title = title.replace(/[\.\!?,;:]+(?=…?$)/, '').trim();
  return title;
}
