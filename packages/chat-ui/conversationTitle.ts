const PLACEHOLDER_TITLES = new Set([
  'untitled',
  'untitled chat',
  'untitled conversation',
  'new chat',
  'new conversation',
  'chat',
]);

/** Derive a short title from the user's first message. */
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

export function isPlaceholderConversationTitle(title: unknown): boolean {
  const normalized = String(title ?? '').trim().toLowerCase();
  return !normalized || PLACEHOLDER_TITLES.has(normalized);
}

/**
 * Resolve the title shown in UI/history. Uses stored title when real, otherwise
 * the first words of the user's prompt until LLM title generation completes.
 */
export function displayConversationTitle(
  title: unknown,
  firstMessage?: unknown,
  fallback = 'New chat',
): string {
  if (!isPlaceholderConversationTitle(title)) {
    return String(title).trim();
  }
  const fromMessage = fallbackTitleFromMessage(firstMessage);
  if (fromMessage) return fromMessage;
  return fallback;
}
