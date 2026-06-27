/** Markdown/LaTeX prep for run detail rendering (mirrors @stuardai/chat-ui/text). */

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function looksLikeInlineMath(rawContent: string): boolean {
  if (!rawContent) return false;
  if (rawContent.trim() !== rawContent) return false;
  if (/[,:;.]$/.test(rawContent)) return false;
  if (/[+\-*/=<>]$/.test(rawContent)) return false;
  if (/\b(and|or|to|not|from|for|around|about|between)\b/i.test(rawContent) && !/\\[a-zA-Z]+/.test(rawContent)) {
    return false;
  }
  return true;
}

function findInlineMathClosingDollar(text: string, startIndex: number): number {
  for (let i = startIndex + 1; i < text.length; i += 1) {
    if (text[i] === '\n' || text[i] === '`' || text.startsWith('```', i)) break;
    if (text[i] !== '$' || isEscaped(text, i)) continue;
    if (text[i - 1] === '$' || text[i + 1] === '$') continue;
    if (looksLikeInlineMath(text.slice(startIndex + 1, i))) return i;
  }
  return -1;
}

export function convertLatexDelims(md: string): string {
  let i = 0;
  let out = '';
  let inFence = false;
  let inInline = false;
  while (i < md.length) {
    if (!inInline && md.startsWith('```', i)) {
      inFence = !inFence;
      out += '```';
      i += 3;
      continue;
    }
    if (!inFence && md[i] === '`') {
      inInline = !inInline;
      out += md[i++];
      continue;
    }
    if (!inFence && !inInline) {
      if (md.startsWith('\\[', i)) { out += '$$'; i += 2; continue; }
      if (md.startsWith('\\]', i)) { out += '$$'; i += 2; continue; }
      if (md.startsWith('\\(', i)) { out += '$'; i += 2; continue; }
      if (md.startsWith('\\)', i)) { out += '$'; i += 2; continue; }
    }
    out += md[i++];
  }
  return out;
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

export function escapeCurrencyDollars(text: string): string {
  let i = 0;
  let out = '';
  let inFence = false;
  let inInline = false;

  while (i < text.length) {
    if (!inInline && text.startsWith('```', i)) {
      inFence = !inFence;
      out += '```';
      i += 3;
      continue;
    }

    if (!inFence && text[i] === '`') {
      inInline = !inInline;
      out += text[i++];
      continue;
    }

    if (
      !inFence &&
      !inInline &&
      text[i] === '$' &&
      !isEscaped(text, i) &&
      /\d/.test(text[i + 1] || '') &&
      text[i + 1] !== '$'
    ) {
      if (findInlineMathClosingDollar(text, i) === -1) {
        out += '\\$';
        i += 1;
        continue;
      }
    }

    out += text[i++];
  }

  return out;
}

export function prepareMarkdownForDisplay(text: string): string {
  return normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(text)));
}
