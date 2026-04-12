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
