
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

