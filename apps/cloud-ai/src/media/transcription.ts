// ─── Audio transcription via OpenRouter STT ─────────────────────────────────

const OPENROUTER_STT_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';
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

/**
 * Transcribe an audio buffer using OpenRouter's STT endpoint.
 * Returns the transcript text, requested language (if any), and audio duration.
 */
export async function transcribeAudio(
  buffer: Buffer,
  mimeType: string,
  language?: string,
  model?: string,
): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured for transcription');

  const format = formatFromMime(mimeType);
  const body: Record<string, unknown> = {
    model: model || DEFAULT_STT_MODEL,
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
  const usedModel = String(body.model);
  return {
    transcript: String(json.text || '').trim(),
    language,
    duration: json.usage?.seconds,
    model: usedModel,
    usage: json.usage,
  };
}
