// ─── Audio transcription ────────────────────────────────────────────────────
// Two providers are supported, dispatched by model slug prefix:
//  • `elevenlabs/*`     → ElevenLabs /v1/speech-to-text (Scribe v1, Scribe v2)
//  • everything else    → OpenRouter /v1/audio/transcriptions
//    (Whisper variants, GPT-4o transcribe, Chirp 3, Voxtral, Qwen3 ASR Flash, …)

const OPENROUTER_STT_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';
const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
export const DEFAULT_STT_MODEL = process.env.OPENROUTER_STT_MODEL || 'openai/whisper-1';

/** Map MIME type to an OpenRouter STT format string */
function formatFromMime(mime: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('webm')) return 'webm';
  if (m.includes('flac')) return 'flac';
  if (m.includes('wav')) return 'wav';
  if (m.includes('aac')) return 'aac';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  return 'mp3'; // safe default — covers audio/mpeg and most compressed audio
}

/** Map MIME type to a sensible filename extension for multipart uploads */
function extFromMime(mime: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('webm')) return 'webm';
  if (m.includes('flac')) return 'flac';
  if (m.includes('wav')) return 'wav';
  if (m.includes('aac')) return 'aac';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  return 'mp3';
}

export interface TranscriptionUsage {
  seconds?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
}

export interface TranscriptionResult {
  transcript: string;
  language?: string;
  duration?: number;
  model: string;
  usage?: TranscriptionUsage;
}

function isElevenLabsModel(model: string): boolean {
  return /^elevenlabs\//i.test(model || '');
}

async function transcribeViaElevenLabs(
  buffer: Buffer,
  mimeType: string,
  language: string | undefined,
  model: string,
): Promise<TranscriptionResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY || '';
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured for ElevenLabs STT');

  // Strip the `elevenlabs/` prefix — the API expects the bare model id.
  const modelId = model.replace(/^elevenlabs\//i, '');

  const form = new FormData();
  const ext = extFromMime(mimeType);
  const blob = new Blob([buffer], { type: mimeType || 'audio/mpeg' });
  form.append('file', blob, `audio.${ext}`);
  form.append('model_id', modelId);
  if (language) form.append('language_code', language);

  const res = await fetch(ELEVENLABS_STT_URL, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`ElevenLabs STT failed (${res.status}): ${err.slice(0, 200)}`);
  }

  const json = await res.json() as {
    text?: string;
    language_code?: string;
    words?: { start?: number; end?: number }[];
  };
  // Derive duration from the last word's `end` timestamp when available.
  const lastWord = Array.isArray(json.words) && json.words.length
    ? json.words[json.words.length - 1]
    : null;
  const duration = typeof lastWord?.end === 'number' ? lastWord.end : undefined;
  return {
    transcript: String(json.text || '').trim(),
    language: json.language_code || language,
    duration,
    model,
    usage: duration ? { seconds: duration } : undefined,
  };
}

async function transcribeViaOpenRouter(
  buffer: Buffer,
  mimeType: string,
  language: string | undefined,
  model: string,
): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured for transcription');

  const format = formatFromMime(mimeType);
  const body: Record<string, unknown> = {
    model,
    input_audio: {
      data: buffer.toString('base64'),
      format,
    },
  };
  if (language) body.language = language;

  const res = await fetch(OPENROUTER_STT_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`OpenRouter STT failed (${res.status}): ${err.slice(0, 200)}`);
  }

  const json = await res.json() as { text?: string; usage?: TranscriptionUsage };
  return {
    transcript: String(json.text || '').trim(),
    language,
    duration: json.usage?.seconds,
    model,
    usage: json.usage,
  };
}

/**
 * Transcribe an audio buffer. Dispatches by model slug prefix:
 *   `elevenlabs/*` → ElevenLabs direct API, anything else → OpenRouter.
 */
export async function transcribeAudio(
  buffer: Buffer,
  mimeType: string,
  language?: string,
  model?: string,
): Promise<TranscriptionResult> {
  const chosen = model || DEFAULT_STT_MODEL;
  if (isElevenLabsModel(chosen)) {
    return transcribeViaElevenLabs(buffer, mimeType, language, chosen);
  }
  return transcribeViaOpenRouter(buffer, mimeType, language, chosen);
}
