import { convertLatexDelims, escapeCurrencyDollars } from '../../../../../../utils/text';

// Strip markdown formatting from text (for GenUI component labels)
export function stripMarkdown(text: string): string {
  if (typeof text !== 'string') return text;
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold** → bold
    .replace(/\*([^*]+)\*/g, '$1')      // *italic* → italic
    .replace(/__([^_]+)__/g, '$1')      // __bold__ → bold
    .replace(/_([^_]+)_/g, '$1')        // _italic_ → italic
    .replace(/~~([^~]+)~~/g, '$1')      // ~~strike~~ → strike
    .replace(/`([^`]+)`/g, '$1')        // `code` → code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // [text](url) → text
}

// Recursively strip markdown from all string values in an object
export function stripMarkdownFromArgs(args: any): any {
  if (typeof args === 'string') return stripMarkdown(args);
  if (Array.isArray(args)) return args.map(stripMarkdownFromArgs);
  if (args && typeof args === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(args)) {
      result[key] = stripMarkdownFromArgs(value);
    }
    return result;
  }
  return args;
}

export function normalizeMarkdownSpacing(input: string): string {
  const raw = String(input || '').replace(/\r\n/g, '\n');
  const parts = raw.split('```');
  const normalized = parts.map((part, idx) => {
    if (idx % 2 === 1) return part;
    return part
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  });
  return normalized.join('```');
}

// Process text for custom markdown extensions (==highlight==, ++underline++)
export function processCustomMarkdown(text: string): string {
  return convertLatexDelims(
    escapeCurrencyDollars(
      normalizeMarkdownSpacing(text)
        .replace(/==([\s\S]*?)==/g, '[$1](#highlight)')
        .replace(/\+\+([\s\S]*?)\+\+/g, '[$1](#underline)')
    )
  );
}
