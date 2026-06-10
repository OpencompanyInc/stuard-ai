import { modelSupportsMultimodal } from '../../routes/models';

export interface AttachmentSummary {
  hasImage: boolean;
  hasFile: boolean;
}

/**
 * Scan the model-bound input messages for binary image/file parts. Text-like
 * files are inlined as text parts upstream (see buildAttachmentParts), so this
 * only reports attachments that actually require multimodal model support.
 */
export function summarizeInputAttachments(inputMessages: any[]): AttachmentSummary {
  let hasImage = false;
  let hasFile = false;
  try {
    for (const message of Array.isArray(inputMessages) ? inputMessages : []) {
      const content = message?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        const type = String(part?.type || '');
        if (type === 'image') hasImage = true;
        else if (type === 'file') hasFile = true;
        if (hasImage && hasFile) return { hasImage, hasFile };
      }
    }
  } catch { }
  return { hasImage, hasFile };
}

function attachmentNoun(summary: AttachmentSummary): string {
  if (summary.hasImage && summary.hasFile) return 'images or files';
  if (summary.hasImage) return 'images';
  if (summary.hasFile) return 'files';
  return 'attachments';
}

function modelDisplayName(ctx: { modelLabel?: string | null; modelId?: string | null }): string {
  const label = (ctx.modelLabel || '').trim();
  if (label) return label;
  const id = (ctx.modelId || '').trim();
  if (id) {
    // Strip provider prefix (e.g. "openai/gpt-4o" -> "gpt-4o") for a cleaner name.
    const slash = id.lastIndexOf('/');
    return slash >= 0 ? id.slice(slash + 1) : id;
  }
  return 'This model';
}

export interface ErrorMessageContext {
  modelId?: string | null;
  modelLabel?: string | null;
  attachments: AttachmentSummary;
}

interface MappedError {
  /** Human-readable message shown to the user (no leading "Error:"). */
  message: string;
  /** Short machine code for logs/telemetry. */
  code: string;
}

/**
 * Map a raw provider/runtime error to a clear, user-facing explanation.
 * Returns null when the error doesn't match a known pattern so callers can
 * fall back to the raw message.
 */
export function mapStreamError(error: any, ctx: ErrorMessageContext): MappedError | null {
  const raw = `${error?.message || error?.error?.message || error || ''}`;
  const lower = raw.toLowerCase();
  const status = Number(error?.statusCode ?? error?.status ?? error?.response?.status ?? 0);
  const name = modelDisplayName(ctx);

  if (!raw && !status) return null;

  const mentionsImage = /image|vision|visual/.test(lower);
  const mentionsFile = /\bfile\b|\bpdf\b|document|attachment/.test(lower);
  const mentionsModality = /modalit|multimodal|input_modalit|content type|unsupported part|not support.*(image|file|pdf|input)/.test(lower);

  // Model can't accept the attachment type that was sent.
  if (mentionsModality || ((mentionsImage || mentionsFile) && /support|invalid|cannot|unsupported|not.*allowed|no.*support/.test(lower))) {
    if (mentionsImage && (ctx.attachments.hasImage || !mentionsFile)) {
      return {
        code: 'unsupported_image',
        message: `${name} can't read images. Remove the image or switch to a vision-capable model, then retry.`,
      };
    }
    if (mentionsFile) {
      return {
        code: 'unsupported_file',
        message: `${name} can't read this file type. Remove the file or switch to a model that supports document input, then retry.`,
      };
    }
    return {
      code: 'unsupported_modality',
      message: `${name} doesn't support the ${attachmentNoun(ctx.attachments)} you attached. Remove them or switch models, then retry.`,
    };
  }

  // Attachment / request payload too large.
  if (status === 413 || /payload too large|request entity too large|too large|exceeds.*size|file size/.test(lower)) {
    return {
      code: 'payload_too_large',
      message: 'Your attachment is too large for this model. Try a smaller file or compress the image, then retry.',
    };
  }

  // Context window exceeded.
  if (/context length|context window|maximum context|too many tokens|reduce the length|context_length_exceeded|prompt is too long/.test(lower)) {
    return {
      code: 'context_overflow',
      message: 'This conversation is too long for the model\'s context window. Start a new chat or remove large attachments, then retry.',
    };
  }

  // Rate limited / quota.
  if (status === 429 || /rate limit|too many requests|quota|insufficient_quota|capacity/.test(lower)) {
    return {
      code: 'rate_limited',
      message: 'The model is rate limited or at capacity right now. Wait a few seconds and retry.',
    };
  }

  // Content safety / policy.
  if (/content policy|content management policy|safety|moderation|flagged|responsible ai|blocked by/.test(lower)) {
    return {
      code: 'content_policy',
      message: 'This request was blocked by the model\'s content policy. Rephrase your message or remove the flagged content, then retry.',
    };
  }

  // Auth / key issues.
  if (status === 401 || status === 403 || /unauthorized|invalid api key|authentication|permission|forbidden|access denied/.test(lower)) {
    return {
      code: 'auth_error',
      message: 'The model provider rejected the request (authentication or access issue). This is on our side — please retry shortly.',
    };
  }

  // Model unavailable / not found / deprecated.
  if (status === 404 || /model not found|no such model|does not exist|deprecated|has been (removed|retired)|unavailable/.test(lower)) {
    return {
      code: 'model_unavailable',
      message: `${name} is currently unavailable or no longer supported. Pick a different model and retry.`,
    };
  }

  // Upstream timeout / network.
  if (/timeout|timed out|etimedout|econnreset|socket hang up|network|fetch failed|gateway/.test(lower) || status === 502 || status === 503 || status === 504) {
    return {
      code: 'upstream_timeout',
      message: 'The model provider didn\'t respond in time. Please retry — if it keeps happening, try a different model.',
    };
  }

  return null;
}

/**
 * Build the best message for the "model produced nothing" case. When the input
 * carried images/files and the model can't accept them, say so explicitly
 * instead of the generic "no output" message.
 */
export async function buildEmptyOutputMessage(ctx: ErrorMessageContext): Promise<MappedError> {
  const name = modelDisplayName(ctx);
  const { hasImage, hasFile } = ctx.attachments;

  if (hasImage || hasFile) {
    let multimodal = true;
    try {
      if (ctx.modelId) multimodal = await modelSupportsMultimodal(ctx.modelId);
    } catch { }
    if (!multimodal) {
      return {
        code: 'empty_unsupported_attachment',
        message: `${name} can't read the ${attachmentNoun(ctx.attachments)} you attached, so it returned nothing. Switch to a multimodal model or remove the ${attachmentNoun(ctx.attachments)}, then retry.`,
      };
    }
    return {
      code: 'empty_with_attachment',
      message: `${name} returned no output for the attached ${attachmentNoun(ctx.attachments)}. The file may be unreadable or unsupported — try a different file or model, then retry.`,
    };
  }

  return {
    code: 'empty',
    message: `${name} returned no output. This is usually temporary — please retry.`,
  };
}
