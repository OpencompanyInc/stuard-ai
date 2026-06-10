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

// Text-like attachments are inlined as plain text parts rather than `file`
// parts. Pasted long text (source `clipboard-text`) and any text/* upload would
// otherwise be sent as a file attachment, which many models (especially
// non-Anthropic/Gemini routes via OpenRouter) silently ignore — the content
// becomes invisible to the model. Inlining keeps it readable everywhere.
const TEXT_LIKE_MIME_RE = /^(text\/|application\/(json|xml|x-ndjson|javascript|x-javascript|x-yaml|yaml|csv|x-www-form-urlencoded))/i;
// Cap inlined text so a giant paste can't blow the context window. Generous
// enough for typical documents; truncation is flagged so the model knows.
const INLINE_TEXT_MAX_CHARS = 200_000;

function isTextLikeAttachment(source: string | undefined, mimeType: string | undefined): boolean {
  if (source === 'clipboard-text') return true;
  return TEXT_LIKE_MIME_RE.test(String(mimeType || ''));
}

function decodeTextPart(buffer: Buffer | null, name: string | undefined): any | null {
  if (!buffer || buffer.length === 0) return null;
  let text = buffer.toString('utf-8');
  if (!text.trim()) return null;
  const truncated = text.length > INLINE_TEXT_MAX_CHARS;
  if (truncated) text = text.slice(0, INLINE_TEXT_MAX_CHARS);
  const label = name ? `Attached document: ${name}` : 'Attached document';
  const suffix = truncated ? '\n\n[…document truncated]' : '';
  return { type: 'text', text: `[${label}]\n${text}${suffix}` };
}

export function buildAttachmentParts(atts: any[]): any[] {
  const parts: any[] = [];
  try {
    for (const a of Array.isArray(atts) ? atts : []) {
      const type = String(a?.type || '');
      const name = typeof a?.name === 'string' ? a.name : undefined;
      const mimeType = typeof a?.mimeType === 'string' ? a.mimeType : undefined;
      const source = typeof a?.source === 'string' ? a.source : undefined;
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
        // Inline text-like files (pasted text, .txt/.md/.json/.csv, etc.) as a
        // text part so every model can actually read them.
        if (isTextLikeAttachment(source, mt)) {
          const textPart = decodeTextPart(buffer, name);
          if (textPart) {
            parts.push(textPart);
            continue;
          }
        }
        if (buffer && buffer.length > 0) parts.push({ type: 'file', data: buffer, mediaType: mt, filename: name });
      }
    }
  } catch {}
  return parts;
}
