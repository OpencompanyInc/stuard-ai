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

/** Which attachment kinds the bound model can read inline. */
export interface AttachmentModalitySupport {
  image: boolean;
  file: boolean;
}

const FULL_SUPPORT: AttachmentModalitySupport = { image: true, file: true };

/**
 * Fallback text part for an attachment the model can't read inline. When the
 * attachment carries a local `path`, the agent can still reach it through its
 * file tools (read_file over the desktop/VM bridge) — so we pass the path as a
 * hidden reference instead of an opaque binary part the model would reject. The
 * client keeps showing the real preview; only the model-bound transport changes.
 */
function buildPathReferencePart(
  kind: 'image' | 'file',
  name: string | undefined,
  mimeType: string | undefined,
  path: string | undefined,
): any {
  const label = name ? `"${name}"` : `an ${kind}`;
  const typeNote = kind === 'image'
    ? "this model can't view images directly"
    : "this model can't read this file type inline";
  if (path) {
    return {
      type: 'text',
      text:
        `[Attached ${kind} ${label}${mimeType ? ` (${mimeType})` : ''} — ${typeNote}. `
        + `The file is on the user's device at: ${path}. `
        + `Use your file tools (e.g. read_file) to access its contents if you need them.]`,
    };
  }
  return {
    type: 'text',
    text:
      `[Attached ${kind} ${label}${mimeType ? ` (${mimeType})` : ''} — ${typeNote}, `
      + `and no local file path is available. Tell the user to switch to a `
      + `${kind === 'image' ? 'vision-capable' : 'document-capable'} model to analyze it.]`,
  };
}

/**
 * Convert client attachments into model-bound content parts.
 *
 * `support` gates native (binary) image/file parts on what the bound model can
 * actually read — checked against the live model registry by the caller. When a
 * model lacks a modality, the attachment is downgraded to a hidden file-path
 * reference (buildPathReferencePart) rather than sent as a part the provider
 * would reject. Omitting `support` keeps the legacy "embed everything" behavior.
 */
export function buildAttachmentParts(atts: any[], support: AttachmentModalitySupport = FULL_SUPPORT): any[] {
  const parts: any[] = [];
  try {
    for (const a of Array.isArray(atts) ? atts : []) {
      const type = String(a?.type || '');
      const name = typeof a?.name === 'string' ? a.name : undefined;
      const mimeType = typeof a?.mimeType === 'string' ? a.mimeType : undefined;
      const source = typeof a?.source === 'string' ? a.source : undefined;
      const path = typeof a?.path === 'string' ? a.path : undefined;
      const dataStr = typeof a?.data === 'string' ? a.data : '';
      if (!type) continue;
      if (type === 'image') {
        // Model can't see images → reference the file path instead of embedding.
        if (!support.image) {
          parts.push(buildPathReferencePart('image', name, mimeType, path));
          continue;
        }
        if (dataStr.startsWith('http://') || dataStr.startsWith('https://')) {
          parts.push({ type: 'image', image: dataStr });
          continue;
        }
        const { buffer, mediaTypeHint } = dataStringToBuffer(dataStr);
        const mt = mimeType || mediaTypeHint || 'image/png';
        if (buffer && buffer.length > 0) parts.push({ type: 'image', image: buffer, mediaType: mt });
      } else if (type === 'file') {
        const { buffer, mediaTypeHint } = dataStringToBuffer(dataStr);
        const mt = mimeType || mediaTypeHint || 'application/octet-stream';
        // Inline text-like files (pasted text, .txt/.md/.json/.csv, etc.) as a
        // text part so every model can actually read them — no modality needed.
        if (isTextLikeAttachment(source, mt)) {
          const textPart = decodeTextPart(buffer, name);
          if (textPart) {
            parts.push(textPart);
            continue;
          }
        }
        // Model can't read binary documents → reference the file path instead.
        if (!support.file) {
          parts.push(buildPathReferencePart('file', name, mt, path));
          continue;
        }
        if (dataStr.startsWith('http://') || dataStr.startsWith('https://')) {
          parts.push({ type: 'file', data: dataStr, mediaType: mimeType || 'application/octet-stream', filename: name });
          continue;
        }
        if (buffer && buffer.length > 0) parts.push({ type: 'file', data: buffer, mediaType: mt, filename: name });
      }
    }
  } catch {}
  return parts;
}
