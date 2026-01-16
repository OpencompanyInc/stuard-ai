export function normalizeMessages(input: any): Array<{ role: 'user' | 'assistant' | 'system'; content: any }> {
  const msgs = Array.isArray(input?.messages) ? input.messages : undefined;
  if (
    msgs &&
    msgs.every(
      (m: any) => m && typeof m.role === 'string' && (typeof m.content === 'string' || Array.isArray(m.content))
    )
  ) {
    return msgs as any;
  }
  const text = String(input?.text ?? '').trim();
  return text ? [{ role: 'user', content: text }] : [];
}

export function contentToText(content: any): string {
  try {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const p of content) {
        if (p && typeof p === 'object' && p.type === 'text' && typeof p.text === 'string') {
          texts.push(p.text);
        }
      }
      return texts.join(' ').slice(0, 2000);
    }
  } catch {}
  return '';
}

export function dataStringToBuffer(data: string): { buffer: Buffer | null; mediaTypeHint?: string } {
  try {
    if (typeof data !== 'string' || !data) return { buffer: null };
    if (data.startsWith('data:')) {
      const m = data.match(/^data:([^;]+);base64,(.*)$/);
      if (m) {
        const mime = m[1];
        const b64 = m[2];
        return { buffer: Buffer.from(b64, 'base64'), mediaTypeHint: mime };
      }
    }
    return { buffer: Buffer.from(data, 'base64') };
  } catch {
    return { buffer: null };
  }
}

export function buildAttachmentParts(atts: any[]): any[] {
  const parts: any[] = [];
  try {
    for (const a of Array.isArray(atts) ? atts : []) {
      const type = String(a?.type || '');
      const name = typeof a?.name === 'string' ? a.name : undefined;
      const mimeType = typeof a?.mimeType === 'string' ? a.mimeType : undefined;
      const dataStr = typeof a?.data === 'string' ? a.data : '';
      if (!type) continue;
      if (type === 'image') {
        if (dataStr.startsWith('http://') || dataStr.startsWith('https://')) {
          parts.push({ type: 'image', image: dataStr });
          continue;
        }
        const { buffer, mediaTypeHint } = dataStringToBuffer(dataStr);
        const mt = mimeType || mediaTypeHint || 'image/png';
        if (buffer && buffer.length > 0) parts.push({ type: 'image', image: buffer, mediaType: mt });
      } else if (type === 'file') {
        if (dataStr.startsWith('http://') || dataStr.startsWith('https://')) {
          parts.push({ type: 'file', data: dataStr, mediaType: mimeType || 'application/octet-stream', filename: name });
          continue;
        }
        const { buffer, mediaTypeHint } = dataStringToBuffer(dataStr);
        const mt = mimeType || mediaTypeHint || 'application/octet-stream';
        if (buffer && buffer.length > 0) parts.push({ type: 'file', data: buffer, mediaType: mt, filename: name });
      }
    }
  } catch {}
  return parts;
}
